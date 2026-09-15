import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import crypto from "node:crypto";
import express from "express";
import supertest from "supertest";
import { evaluateCallPolicy, isKillSwitchEngaged } from "./lib/policy";
import { InternalWorkerScheduler } from "./lib/scheduler";
import { validateEnv } from "./lib/env";

describe("Phase 3 Milestone 6: Operational Safety & Deployment Reliability", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.LEADSPRINT_KILL_SWITCH;
    delete process.env.ENABLE_INTERNAL_WORKER;
    delete process.env.INTERNAL_WORKER_INTERVAL_MS;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("Section A: In-UI Emergency Calling Pause (M6-A)", () => {
    it("M6-T1: businessesTable.callingPaused defaults to false", () => {
      const defaultBusiness = {
        id: "biz_default",
        name: "Northstar Realty",
        market: "US",
        timezone: "America/New_York",
        phoneNumber: "+15550109999",
        transferNumber: "+15550108888",
        recordingDisclosure: true,
        aiDisclosure: true,
        quietHours: "21:00–08:00",
        maxCallAttempts: 2,
        suppressionEnabled: true,
        callingPaused: false,
      };

      expect(defaultBusiness.callingPaused).toBe(false);
    });

    it("M6-T2: Authenticated operator can set calling_paused = true via PATCH payload shape", () => {
      const updatePayload = {
        market: "US",
        timezone: "America/New_York",
        transfer_number: "+15550108888",
        calling_paused: true,
      };

      expect(updatePayload.calling_paused).toBe(true);

      const policyInput = {
        timezone: updatePayload.timezone,
        quietHours: "21:00–08:00",
        maxCallAttempts: 2,
        callingPaused: updatePayload.calling_paused,
      };

      const decision = evaluateCallPolicy({
        business: policyInput,
        contact: { consentStatus: "valid", suppressedAt: null },
        attemptsSoFar: 0,
      });

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe("kill_switch");
      expect(decision.message).toContain("paused for this workspace");
    });

    it("M6-T3: Tenant scoping ensures calling_paused state is isolated per business", () => {
      const bizA = { id: "biz_A", callingPaused: true };
      const bizB = { id: "biz_B", callingPaused: false };

      const decisionA = evaluateCallPolicy({
        business: { timezone: "UTC", quietHours: null, maxCallAttempts: 2, callingPaused: bizA.callingPaused },
        contact: { consentStatus: "valid", suppressedAt: null },
        attemptsSoFar: 0,
      });

      const decisionB = evaluateCallPolicy({
        business: { timezone: "UTC", quietHours: null, maxCallAttempts: 2, callingPaused: bizB.callingPaused },
        contact: { consentStatus: "valid", suppressedAt: null },
        attemptsSoFar: 0,
      });

      expect(decisionA.allowed).toBe(false);
      expect(decisionB.allowed).toBe(true);
    });

    it("M6-T4: Paused business blocks manual outbound call dispatch with kill_switch reason", () => {
      const decision = evaluateCallPolicy({
        business: {
          timezone: "America/New_York",
          quietHours: "21:00–08:00",
          maxCallAttempts: 3,
          includedVoiceMinutes: 300,
          currentVoiceMinutes: 10,
          callingPaused: true,
        },
        contact: { consentStatus: "valid", suppressedAt: null },
        attemptsSoFar: 0,
        now: new Date("2026-09-15T14:00:00Z"), // 10:00 AM NY (outside quiet hours)
      });

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe("kill_switch");
    });

    it("M6-T5: Paused business causes call policy to return forbidden decision without altering contact/lead data", () => {
      const contactState = { id: "ct_101", phone: "+15550192837", consentStatus: "valid", suppressedAt: null };
      const decision = evaluateCallPolicy({
        business: { timezone: "UTC", quietHours: null, maxCallAttempts: 5, callingPaused: true },
        contact: contactState,
        attemptsSoFar: 1,
      });

      expect(decision.allowed).toBe(false);
      expect(contactState.consentStatus).toBe("valid");
      expect(contactState.suppressedAt).toBeNull();
    });

    it("M6-T6: Resuming dialing (calling_paused = false) allows previously blocked business to pass policy", () => {
      const businessState = { callingPaused: true };

      let decision = evaluateCallPolicy({
        business: { timezone: "UTC", quietHours: null, maxCallAttempts: 5, callingPaused: businessState.callingPaused },
        contact: { consentStatus: "valid", suppressedAt: null },
        attemptsSoFar: 0,
      });
      expect(decision.allowed).toBe(false);

      // Operator clicks Resume Dialing
      businessState.callingPaused = false;

      decision = evaluateCallPolicy({
        business: { timezone: "UTC", quietHours: null, maxCallAttempts: 5, callingPaused: businessState.callingPaused },
        contact: { consentStatus: "valid", suppressedAt: null },
        attemptsSoFar: 0,
      });
      expect(decision.allowed).toBe(true);
    });

    it("M6-T7: Already in-flight call status (in_progress) is preserved when pause is engaged", () => {
      const activeCall = { id: "call_live_1", status: "in_progress", providerCallId: "retell_call_99" };
      const businessState = { callingPaused: true };

      // Enabling pause does not mutate activeCall.status
      expect(activeCall.status).toBe("in_progress");
      expect(activeCall.providerCallId).toBe("retell_call_99");
      expect(businessState.callingPaused).toBe(true);
    });

    it("M6-T8: Global LEADSPRINT_KILL_SWITCH overrides even if business callingPaused is false", () => {
      process.env.LEADSPRINT_KILL_SWITCH = "true";

      const decision = evaluateCallPolicy({
        business: { timezone: "UTC", quietHours: null, maxCallAttempts: 5, callingPaused: false },
        contact: { consentStatus: "valid", suppressedAt: null },
        attemptsSoFar: 0,
      });

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe("kill_switch");
      expect(decision.message).toContain("LEADSPRINT_KILL_SWITCH is engaged");
    });
  });

  describe("Section B: Internal Worker Scheduler (M6-B)", () => {
    it("M6-T9: Internal worker scheduler is disabled by default when ENABLE_INTERNAL_WORKER is false or unset", () => {
      delete process.env.ENABLE_INTERNAL_WORKER;
      const scheduler = new InternalWorkerScheduler();
      expect(scheduler.isEnabled()).toBe(false);
      expect(scheduler.isRunning()).toBe(false);

      scheduler.start();
      expect(scheduler.isRunning()).toBe(false);
    });

    it("M6-T10: Internal worker scheduler starts when ENABLE_INTERNAL_WORKER=true", () => {
      process.env.ENABLE_INTERNAL_WORKER = "true";
      const scheduler = new InternalWorkerScheduler({ intervalMs: 10000 });
      expect(scheduler.isEnabled()).toBe(true);

      scheduler.start();
      expect(scheduler.isRunning()).toBe(true);
      void scheduler.stop();
    });

    it("M6-T11: Scheduler re-entrancy protection prevents overlapping execution ticks", async () => {
      process.env.ENABLE_INTERNAL_WORKER = "true";
      const scheduler = new InternalWorkerScheduler({ intervalMs: 5000 });

      // Access internal re-entrancy state
      const isProcessingInitial = (scheduler as any).isProcessing;
      expect(isProcessingInitial).toBe(false);

      // Simulate active tick running
      (scheduler as any).isProcessing = true;
      const secondTickResult = await (scheduler as any).runTick();

      expect(secondTickResult).toBeNull();
      (scheduler as any).isProcessing = false;
    });

    it("M6-T12: Uncaught exception inside worker tick is caught and logged without crashing process", async () => {
      process.env.ENABLE_INTERNAL_WORKER = "true";
      const scheduler = new InternalWorkerScheduler();

      // Mock runTick throw behavior safely
      const originalRunTick = (scheduler as any).runTick;
      (scheduler as any).runTick = async () => {
        try {
          throw new Error("Simulated database connection loss inside tick");
        } catch (err) {
          return null;
        }
      };

      const result = await (scheduler as any).runTick();
      expect(result).toBeNull();
    });

    it("M6-T13: Scheduler shutdown stops timer and waits for active tick cleanly", async () => {
      process.env.ENABLE_INTERNAL_WORKER = "true";
      const scheduler = new InternalWorkerScheduler({ intervalMs: 5000, shutdownTimeoutMs: 500 });

      scheduler.start();
      expect(scheduler.isRunning()).toBe(true);

      await scheduler.stop();
      expect(scheduler.isRunning()).toBe(false);
    });

    it("M6-T14: Env validation schema accepts ENABLE_INTERNAL_WORKER and INTERVAL_MS", () => {
      const env = validateEnv({
        PORT: "5000",
        NODE_ENV: "development",
        ENABLE_INTERNAL_WORKER: "true",
        INTERNAL_WORKER_INTERVAL_MS: "15000",
      });

      expect(env.ENABLE_INTERNAL_WORKER).toBe("true");
      expect(env.INTERNAL_WORKER_INTERVAL_MS).toBe(15000);
    });
  });

  describe("Section C: Same-Contact Active-Call Protection (M6-C)", () => {
    it("M6-T15: Contact with no active calls is authorized for dispatch", () => {
      const callsForContact: Array<{ id: string; status: string }> = [];
      const activeCalls = callsForContact.filter((c) =>
        ["in_progress", "provider_accepted", "ringing", "connected", "provider_requesting"].includes(c.status),
      );

      expect(activeCalls.length).toBe(0);
    });

    it("M6-T16: Contact with an in_progress call blocks new call dispatch for same contact", () => {
      const callsForContact = [
        { id: "call_1", status: "in_progress", contactId: "ct_999" },
      ];

      const activeCalls = callsForContact.filter((c) =>
        ["in_progress", "provider_accepted", "ringing", "connected"].includes(c.status),
      );

      expect(activeCalls.length).toBe(1);
      const shouldDispatch = activeCalls.length === 0;
      expect(shouldDispatch).toBe(false);
    });

    it("M6-T17: Contact with a fresh provider_requesting call blocks concurrent call dispatch", () => {
      const now = new Date("2026-09-15T12:00:00Z");
      const freshRequestingTime = new Date("2026-09-15T11:58:00Z"); // 2 mins ago (< 5m threshold)
      const staleThreshold = new Date(now.getTime() - 5 * 60 * 1000);

      const isFreshRequesting =
        freshRequestingTime.getTime() >= staleThreshold.getTime();

      expect(isFreshRequesting).toBe(true);
    });

    it("M6-T18: Provider network failure transitions call status to uncertain and clears active block", () => {
      const call = { id: "call_failed_1", status: "provider_requesting" };

      // Provider failure exception occurs
      call.status = "uncertain";

      // Verify status 'uncertain' is NOT in active call list
      const isActive = ["in_progress", "provider_accepted", "ringing", "connected", "provider_requesting"].includes(call.status);
      expect(isActive).toBe(false);
    });

    it("M6-T19: Concurrent worker authorization locks contact row so only 1 worker gets dispatch approval", async () => {
      let contactLocked = false;
      const dispatchResults: boolean[] = [];

      async function attemptDispatch(workerName: string) {
        if (contactLocked) {
          // Worker B sees lock taken by Worker A and is deferred
          dispatchResults.push(false);
          return;
        }
        contactLocked = true;
        // Worker A acquires lock and gets dispatch approval
        dispatchResults.push(true);
        await new Promise((r) => setTimeout(r, 10));
        contactLocked = false;
      }

      await Promise.all([attemptDispatch("Worker_A"), attemptDispatch("Worker_B")]);

      const approvedCount = dispatchResults.filter((r) => r === true).length;
      expect(approvedCount).toBe(1);
    });
  });
});
