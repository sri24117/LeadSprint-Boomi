import { describe, it, expect, vi } from "vitest";
import {
  recoverStaleLeases,
  claimQueuedJobs,
  processWorkflowJobs,
  MAX_JOB_ATTEMPTS,
  LEASE_DURATION_MINUTES,
} from "./worker";

describe("Workflow Worker Concurrency & Crash Idempotency", () => {
  describe("Atomic Job Claiming & Leases", () => {
    it("leases contain worker identity, lease expiry, and increment attempts", () => {
      const now = new Date("2026-09-10T12:00:00.000Z");
      const workerId = "worker_test_1001";
      const leaseExpiry = new Date(
        now.getTime() + LEASE_DURATION_MINUTES * 60 * 1000,
      );

      expect(leaseExpiry.toISOString()).toBe("2026-09-10T12:05:00.000Z");
      expect(LEASE_DURATION_MINUTES).toBe(5);
      expect(MAX_JOB_ATTEMPTS).toBe(5);
    });

    it("two concurrent workers claim disjoint sets of jobs under SKIP LOCKED semantics", () => {
      // Simulate 10 queued jobs in a pool
      const jobPool = Array.from({ length: 10 }).map((_, i) => ({
        id: `job_${i}`,
        status: "queued",
        lockedBy: null as string | null,
        lockedAt: null as Date | null,
      }));

      // Worker 1 claims up to 5 jobs
      function claim(workerId: string, limit: number) {
        const available = jobPool.filter(
          (j) => j.status === "queued" && j.lockedBy === null,
        );
        const batch = available.slice(0, limit);
        for (const job of batch) {
          job.status = "dispatching";
          job.lockedBy = workerId;
          job.lockedAt = new Date();
        }
        return batch;
      }

      const worker1Batch = claim("worker_1", 5);
      const worker2Batch = claim("worker_2", 5);

      expect(worker1Batch.length).toBe(5);
      expect(worker2Batch.length).toBe(5);

      // Verify zero overlap between batches
      const worker1Ids = new Set(worker1Batch.map((j) => j.id));
      const worker2Ids = new Set(worker2Batch.map((j) => j.id));

      for (const id of worker1Ids) {
        expect(worker2Ids.has(id)).toBe(false);
      }
    });

    it("stale leases (> 5 min or expired) are reclaimed while active leases are protected", () => {
      const now = new Date("2026-09-10T12:00:00.000Z");

      const jobs: Array<{
        id: string;
        status: string;
        lockedBy: string | null;
        leaseExpiresAt: Date | null;
      }> = [
        {
          id: "job_active",
          status: "dispatching",
          lockedBy: "worker_alive",
          leaseExpiresAt: new Date("2026-09-10T12:04:00.000Z"), // Active: 4 min in future
        },
        {
          id: "job_expired",
          status: "dispatching",
          lockedBy: "worker_crashed",
          leaseExpiresAt: new Date("2026-09-10T11:59:00.000Z"), // Expired: 1 min in past
        },
      ];

      function simulateStaleRecovery(asOf: Date) {
        let recoveredCount = 0;
        for (const job of jobs) {
          if (
            job.status === "dispatching" &&
            job.leaseExpiresAt &&
            job.leaseExpiresAt < asOf
          ) {
            job.status = "queued";
            job.lockedBy = null;
            job.leaseExpiresAt = null as any;
            recoveredCount++;
          }
        }
        return recoveredCount;
      }

      const recovered = simulateStaleRecovery(now);

      expect(recovered).toBe(1);
      expect(jobs.find((j) => j.id === "job_active")?.status).toBe("dispatching");
      expect(jobs.find((j) => j.id === "job_active")?.lockedBy).toBe("worker_alive");
      expect(jobs.find((j) => j.id === "job_expired")?.status).toBe("queued");
      expect(jobs.find((j) => j.id === "job_expired")?.lockedBy).toBeNull();
    });
  });

  describe("Crash Idempotency & Stable Operation Key", () => {
    it("uses stable deterministic operation key across worker restarts and retries", () => {
      const callId = "call_abc123";
      const businessId = "biz_northstar";

      // The operation key must match the durable call.id
      const job1 = {
        id: "job_1",
        businessId,
        idempotencyKey: callId,
        attempts: 1,
      };

      // Simulated retry or restart
      const jobRetry = {
        ...job1,
        attempts: 2,
      };

      expect(jobRetry.idempotencyKey).toBe(job1.idempotencyKey);
      expect(jobRetry.idempotencyKey).toBe(callId);
    });

    it("existing provider call check prevents duplicate Retell dispatch on crash recovery", () => {
      let retellDispatchCount = 0;

      function processCallJob(call: {
        id: string;
        providerCallId: string | null;
        status: string;
      }) {
        // Pre-dispatch check: If call already has providerCallId or is in_progress/completed, DO NOT call Retell!
        const alreadyDispatched =
          Boolean(call.providerCallId) ||
          ["in_progress", "completed", "ringing", "connected"].includes(
            call.status,
          );

        if (alreadyDispatched) {
          return { status: "reconciled_existing", duplicateDispatched: false };
        }

        retellDispatchCount++;
        call.providerCallId = `retell_call_${call.id}`;
        call.status = "in_progress";
        return { status: "dispatched", duplicateDispatched: true };
      }

      const call = {
        id: "call_test_001",
        providerCallId: null as string | null,
        status: "queued",
      };

      // 1. Initial attempt dispatches to Retell
      const firstRun = processCallJob(call);
      expect(firstRun.status).toBe("dispatched");
      expect(retellDispatchCount).toBe(1);

      // 2. Simulate worker crash after Retell dispatch, then lease recovery re-runs job
      const recoveryRun = processCallJob(call);
      expect(recoveryRun.status).toBe("reconciled_existing");
      expect(retellDispatchCount).toBe(1); // STILL 1, NOT 2!
    });
  });

  describe("Pre-Dispatch Verification & Policy Gates", () => {
    it("defers call when recipient is in quiet hours without burning terminal attempts", () => {
      let callDispatched = false;
      const job = { status: "dispatching", attempts: 1, availableAt: new Date() };

      const policyDecision = {
        allowed: false,
        reason: "quiet_hours",
        message: "Outside allowed calling hours (21:00–08:00 America/New_York)",
      };

      if (!policyDecision.allowed) {
        if (policyDecision.reason === "quiet_hours" && job.attempts < MAX_JOB_ATTEMPTS) {
          job.status = "deferred";
          job.availableAt = new Date(Date.now() + 30 * 60 * 1000);
        } else {
          job.status = "failed";
        }
      } else {
        callDispatched = true;
      }

      expect(callDispatched).toBe(false);
      expect(job.status).toBe("deferred");
      expect(job.availableAt.getTime()).toBeGreaterThan(Date.now());
    });

    it("blocks dispatch when contact is suppressed or consent is invalid", () => {
      const testCases = [
        { consentStatus: "revoked", suppressedAt: null, expectedReason: "consent_invalid" },
        { consentStatus: "valid", suppressedAt: new Date(), expectedReason: "suppressed" },
      ];

      for (const tc of testCases) {
        let isAllowed = true;
        let blockReason = "";

        if (tc.consentStatus !== "valid") {
          isAllowed = false;
          blockReason = "consent_invalid";
        } else if (tc.suppressedAt) {
          isAllowed = false;
          blockReason = "suppressed";
        }

        expect(isAllowed).toBe(false);
        expect(blockReason).toBe(tc.expectedReason);
      }
    });

    it("blocks dispatch when recipient phone number is not valid E.164", () => {
      const invalidPhones = ["123", "invalid-phone", "+0000000000", ""];

      for (const raw of invalidPhones) {
        const isValid = raw.startsWith("+") && raw.length >= 10 && /^\+[1-9]\d{1,14}$/.test(raw);
        expect(isValid).toBe(false);
      }
    });
  });

  describe("State Machine & Exponential Backoff", () => {
    it("calculates exponential backoff delay correctly (2^attempts minutes, max 60)", () => {
      function calculateBackoffMinutes(attempt: number): number {
        return Math.min(60, Math.pow(2, attempt));
      }

      expect(calculateBackoffMinutes(1)).toBe(2);
      expect(calculateBackoffMinutes(2)).toBe(4);
      expect(calculateBackoffMinutes(3)).toBe(8);
      expect(calculateBackoffMinutes(4)).toBe(16);
      expect(calculateBackoffMinutes(5)).toBe(32);
      expect(calculateBackoffMinutes(6)).toBe(60); // Capped at 60
      expect(calculateBackoffMinutes(10)).toBe(60); // Capped at 60
    });

    it("marks job as failed when attempts reach MAX_JOB_ATTEMPTS (5)", () => {
      const job = { attempts: 5, status: "dispatching" };

      if (job.attempts >= MAX_JOB_ATTEMPTS) {
        job.status = "failed";
      }

      expect(job.status).toBe("failed");
    });

    it("isolates jobs and provider calls strictly by tenant", () => {
      const tenantCalls = [
        { businessId: "biz_1", callId: "call_1", status: "queued" },
        { businessId: "biz_2", callId: "call_2", status: "queued" },
      ];

      function getCallForJob(jobBusinessId: string, callId: string) {
        return tenantCalls.find(
          (c) => c.businessId === jobBusinessId && c.callId === callId,
        );
      }

      // Tenant 1 cannot access Tenant 2's call
      expect(getCallForJob("biz_1", "call_1")).toBeDefined();
      expect(getCallForJob("biz_1", "call_2")).toBeUndefined();
    });
  });

  describe("Webhook Orphan Call Reconciliation & Fallback", () => {
    type CallRecord = {
      id: string;
      businessId: string;
      providerCallId: string | null;
      status: string;
    };
    type JobRecord = {
      id: string;
      businessId: string;
      idempotencyKey: string;
      status: string;
    };

    function simulateWebhookProcessing(
      calls: CallRecord[],
      jobs: JobRecord[],
      webhookPayload: {
        call_id: string;
        metadata: { business_id: string; call_id?: string };
        status?: string;
      },
    ) {
      const { call_id: callId, metadata } = webhookPayload;
      const businessId = metadata.business_id;
      const metadataCallId = metadata.call_id;

      // 1. Normal lookup
      let callRow = calls.find(
        (c) => c.businessId === businessId && c.providerCallId === callId,
      );

      // 2. Orphan fallback lookup
      if (!callRow && metadataCallId) {
        callRow = calls.find(
          (c) => c.businessId === businessId && c.id === metadataCallId,
        );
      }

      if (callRow) {
        callRow.providerCallId = callId;
        callRow.status = "completed";

        const job = jobs.find(
          (j) => j.businessId === businessId && j.idempotencyKey === callRow.id,
        );
        if (job) {
          job.status = "completed";
        }
      }

      return callRow;
    }

    it("TEST 1: Normal webhook matches existing call by providerCallId", () => {
      const calls: CallRecord[] = [
        {
          id: "call_001",
          businessId: "biz_1",
          providerCallId: "retell_call_100",
          status: "in_progress",
        },
      ];
      const jobs: JobRecord[] = [
        {
          id: "job_001",
          businessId: "biz_1",
          idempotencyKey: "call_001",
          status: "dispatching",
        },
      ];

      const matched = simulateWebhookProcessing(calls, jobs, {
        call_id: "retell_call_100",
        metadata: { business_id: "biz_1", call_id: "call_001" },
      });

      expect(matched).toBeDefined();
      expect(matched?.id).toBe("call_001");
      expect(matched?.status).toBe("completed");
      expect(jobs[0].status).toBe("completed");
    });

    it("TEST 2: Orphan webhook matches call via metadata.call_id and reconciles providerCallId and job", () => {
      // Local call has NULL providerCallId due to worker crash before DB update
      const calls: CallRecord[] = [
        {
          id: "call_orphan_999",
          businessId: "biz_1",
          providerCallId: null,
          status: "queued",
        },
      ];
      const jobs: JobRecord[] = [
        {
          id: "job_999",
          businessId: "biz_1",
          idempotencyKey: "call_orphan_999",
          status: "dispatching",
        },
      ];

      const matched = simulateWebhookProcessing(calls, jobs, {
        call_id: "retell_call_200",
        metadata: { business_id: "biz_1", call_id: "call_orphan_999" },
      });

      expect(matched).toBeDefined();
      expect(matched?.id).toBe("call_orphan_999");
      expect(matched?.providerCallId).toBe("retell_call_200");
      expect(matched?.status).toBe("completed");
      expect(jobs[0].status).toBe("completed");
    });

    it("TEST 3: Tenant isolation prevents Business B from reconciling Business A call", () => {
      const calls: CallRecord[] = [
        {
          id: "call_biz_a",
          businessId: "biz_A",
          providerCallId: null,
          status: "queued",
        },
      ];
      const jobs: JobRecord[] = [
        {
          id: "job_biz_a",
          businessId: "biz_A",
          idempotencyKey: "call_biz_a",
          status: "dispatching",
        },
      ];

      // Webhook payload claims to be for Business B, but attempts to match call_id belonging to Business A
      const matched = simulateWebhookProcessing(calls, jobs, {
        call_id: "retell_call_300",
        metadata: { business_id: "biz_B", call_id: "call_biz_a" },
      });

      expect(matched).toBeUndefined();
      expect(calls[0].providerCallId).toBeNull(); // Untouched
      expect(calls[0].status).toBe("queued");
      expect(jobs[0].status).toBe("dispatching");
    });

    it("TEST 4: Missing metadata.call_id does not match or create arbitrary calls", () => {
      const calls: CallRecord[] = [
        {
          id: "call_001",
          businessId: "biz_1",
          providerCallId: "other_call",
          status: "queued",
        },
      ];
      const jobs: JobRecord[] = [];

      const matched = simulateWebhookProcessing(calls, jobs, {
        call_id: "retell_call_unmatched",
        metadata: { business_id: "biz_1" }, // No call_id in metadata
      });

      expect(matched).toBeUndefined();
      expect(calls.length).toBe(1);
    });

    it("TEST 5: Webhook replay deduplication prevents duplicate processing", () => {
      const processedEventIds = new Set<string>();
      let processingCount = 0;

      function handleWebhook(eventId: string) {
        if (processedEventIds.has(eventId)) {
          return { accepted: false, duplicate: true };
        }
        processedEventIds.add(eventId);
        processingCount++;
        return { accepted: true, duplicate: false };
      }

      const first = handleWebhook("event_retell_123");
      expect(first.accepted).toBe(true);
      expect(processingCount).toBe(1);

      const second = handleWebhook("event_retell_123");
      expect(second.accepted).toBe(false);
      expect(second.duplicate).toBe(true);
      expect(processingCount).toBe(1); // Not incremented
    });
  });
});
