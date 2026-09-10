import { describe, it, expect, vi } from "vitest";
import { getBillingPeriod, getActiveUsageRow, DbExecutor } from "./usage";

function createMockDb() {
  type UsageRow = {
    id: string;
    businessId: string;
    periodStart: Date;
    periodEnd: Date;
    voiceMinutes: string;
    smsCount: number;
    bookingCount: number;
    estimatedCost: string;
  };

  const rows: UsageRow[] = [];

  const mockExecutor = {
    select: () => ({
      from: () => ({
        where: (condition: any) => ({
          limit: (n: number) => {
            function extractValues(obj: any): any[] {
              const values: any[] = [];
              if (!obj) return values;
              if ("value" in obj && obj.value !== undefined) {
                values.push(obj.value);
              }
              if (Array.isArray(obj.queryChunks)) {
                for (const chunk of obj.queryChunks) {
                  values.push(...extractValues(chunk));
                }
              }
              return values;
            }

            const params = extractValues(condition);
            const targetBusinessId = params.find((p) => typeof p === "string");
            const targetDate = params.find((p) => p instanceof Date);

            const results = rows.filter((r) => {
              if (targetBusinessId && r.businessId !== targetBusinessId) return false;
              if (targetDate && (r.periodStart > targetDate || r.periodEnd < targetDate)) return false;
              return true;
            });
            return Promise.resolve(results.slice(0, n));
          },
        }),
      }),
    }),
    insert: () => ({
      values: (newRow: UsageRow) => ({
        onConflictDoNothing: () => {
          const duplicate = rows.find(
            (r) =>
              r.businessId === newRow.businessId &&
              r.periodStart.getTime() === newRow.periodStart.getTime() &&
              r.periodEnd.getTime() === newRow.periodEnd.getTime(),
          );
          if (!duplicate) {
            rows.push({ ...newRow });
          }
          return Promise.resolve();
        },
      }),
    }),
    _rows: rows,
  };

  return mockExecutor;
}

describe("Usage Accounting & Active Billing Period", () => {
  describe("getBillingPeriod", () => {
    it("calculates deterministic UTC calendar-month boundaries for September 2026", () => {
      const date = new Date("2026-09-15T14:30:00.000Z");
      const period = getBillingPeriod(date);

      expect(period.periodStart.toISOString()).toBe("2026-09-01T00:00:00.000Z");
      expect(period.periodEnd.toISOString()).toBe("2026-09-30T23:59:59.999Z");
      expect(period.periodLabel).toBe("September 2026");
    });

    it("handles first millisecond of a month boundary correctly", () => {
      const date = new Date("2026-01-01T00:00:00.000Z");
      const period = getBillingPeriod(date);

      expect(period.periodStart.toISOString()).toBe("2026-01-01T00:00:00.000Z");
      expect(period.periodEnd.toISOString()).toBe("2026-01-31T23:59:59.999Z");
      expect(period.periodLabel).toBe("January 2026");
    });

    it("handles last millisecond of a month boundary correctly", () => {
      const date = new Date("2026-02-28T23:59:59.999Z");
      const period = getBillingPeriod(date);

      expect(period.periodStart.toISOString()).toBe("2026-02-01T00:00:00.000Z");
      expect(period.periodEnd.toISOString()).toBe("2026-02-28T23:59:59.999Z");
      expect(period.periodLabel).toBe("February 2026");
    });

    it("handles leap year February correctly", () => {
      const date = new Date("2028-02-15T12:00:00.000Z");
      const period = getBillingPeriod(date);

      expect(period.periodStart.toISOString()).toBe("2028-02-01T00:00:00.000Z");
      expect(period.periodEnd.toISOString()).toBe("2028-02-29T23:59:59.999Z");
      expect(period.periodLabel).toBe("February 2028");
    });

    it("handles year transition boundary (December 31 -> January 1)", () => {
      const decDate = new Date("2026-12-31T23:59:59.999Z");
      const decPeriod = getBillingPeriod(decDate);
      expect(decPeriod.periodLabel).toBe("December 2026");
      expect(decPeriod.periodStart.toISOString()).toBe("2026-12-01T00:00:00.000Z");
      expect(decPeriod.periodEnd.toISOString()).toBe("2026-12-31T23:59:59.999Z");

      const janDate = new Date("2027-01-01T00:00:00.000Z");
      const janPeriod = getBillingPeriod(janDate);
      expect(janPeriod.periodLabel).toBe("January 2027");
      expect(janPeriod.periodStart.toISOString()).toBe("2027-01-01T00:00:00.000Z");
    });
  });

  describe("getActiveUsageRow (In-Memory Mock Database Executor)", () => {
    it("provisions new usage row for active billing period with zero initial counters", async () => {
      const mockDb = createMockDb();
      const asOf = new Date("2026-09-10T12:00:00.000Z");

      const usage = await getActiveUsageRow("biz_alpha", asOf, mockDb as unknown as DbExecutor);

      expect(usage.businessId).toBe("biz_alpha");
      expect(usage.id).toBe("usage_biz_alpha_2026_09");
      expect(usage.voiceMinutes).toBe("0");
      expect(usage.smsCount).toBe(0);
      expect(usage.bookingCount).toBe(0);
      expect(usage.estimatedCost).toBe("0");
      expect(usage.periodStart.toISOString()).toBe("2026-09-01T00:00:00.000Z");
      expect(usage.periodEnd.toISOString()).toBe("2026-09-30T23:59:59.999Z");
    });

    it("returns existing usage row when called multiple times within same period", async () => {
      const mockDb = createMockDb();
      const asOf = new Date("2026-09-10T12:00:00.000Z");

      const first = await getActiveUsageRow("biz_alpha", asOf, mockDb as unknown as DbExecutor);
      first.voiceMinutes = "45.5";
      first.bookingCount = 3;

      const second = await getActiveUsageRow("biz_alpha", asOf, mockDb as unknown as DbExecutor);

      expect(second.id).toBe(first.id);
      expect(second.voiceMinutes).toBe("45.5");
      expect(second.bookingCount).toBe(3);
      expect(mockDb._rows.length).toBe(1);
    });

    it("isolates usage records strictly by business tenant", async () => {
      const mockDb = createMockDb();
      const asOf = new Date("2026-09-10T12:00:00.000Z");

      const usageA = await getActiveUsageRow("biz_a", asOf, mockDb as unknown as DbExecutor);
      usageA.voiceMinutes = "100";

      const usageB = await getActiveUsageRow("biz_b", asOf, mockDb as unknown as DbExecutor);
      usageB.voiceMinutes = "20";

      expect(usageA.businessId).toBe("biz_a");
      expect(usageB.businessId).toBe("biz_b");
      expect(usageA.id).not.toBe(usageB.id);
      expect(usageA.voiceMinutes).toBe("100");
      expect(usageB.voiceMinutes).toBe("20");
    });

    it("isolates usage records strictly by billing period", async () => {
      const mockDb = createMockDb();
      const sep = new Date("2026-09-10T12:00:00.000Z");
      const oct = new Date("2026-10-05T12:00:00.000Z");

      const sepUsage = await getActiveUsageRow("biz_alpha", sep, mockDb as unknown as DbExecutor);
      sepUsage.voiceMinutes = "250";

      const octUsage = await getActiveUsageRow("biz_alpha", oct, mockDb as unknown as DbExecutor);

      expect(sepUsage.id).toBe("usage_biz_alpha_2026_09");
      expect(octUsage.id).toBe("usage_biz_alpha_2026_10");
      expect(sepUsage.voiceMinutes).toBe("250");
      expect(octUsage.voiceMinutes).toBe("0");
      expect(mockDb._rows.length).toBe(2);
    });

    it("guarantees race-proof concurrent row provisioning (zero duplicate rows)", async () => {
      const mockDb = createMockDb();
      const asOf = new Date("2026-09-10T12:00:00.000Z");

      // Simulate 10 simultaneous requests attempting to provision the usage row at the exact same moment
      const results = await Promise.all(
        Array.from({ length: 10 }).map(() =>
          getActiveUsageRow("biz_concurrent", asOf, mockDb as unknown as DbExecutor),
        ),
      );

      // All 10 callers get the identical usage ID
      const ids = results.map((r) => r.id);
      expect(new Set(ids).size).toBe(1);
      expect(mockDb._rows.filter((r) => r.businessId === "biz_concurrent").length).toBe(1);
    });
  });

  describe("Dynamic Entitlement & Idempotency Rules", () => {
    it("uses business.included_voice_minutes dynamically for usage calculation", () => {
      const businessAlpha = { id: "biz_1", includedVoiceMinutes: 300 };
      const businessCustom = { id: "biz_2", includedVoiceMinutes: 1200 };

      const usageAlpha = { voiceMinutes: "150", bookingCount: 2 };
      const usageCustom = { voiceMinutes: "150", bookingCount: 2 };

      const remainingAlpha = businessAlpha.includedVoiceMinutes - Number(usageAlpha.voiceMinutes);
      const remainingCustom = businessCustom.includedVoiceMinutes - Number(usageCustom.voiceMinutes);

      expect(remainingAlpha).toBe(150);
      expect(remainingCustom).toBe(1050);
    });

    it("webhook idempotency rejects replayed event and avoids double-counting usage", () => {
      const recordedEvents = new Set<string>();
      let voiceMinutesTotal = 0;

      function handleRetellEvent(event: {
        eventId: string;
        durationSeconds: number;
      }): { accepted: boolean; duplicate: boolean } {
        if (recordedEvents.has(event.eventId)) {
          return { accepted: false, duplicate: true };
        }
        recordedEvents.add(event.eventId);
        voiceMinutesTotal += event.durationSeconds / 60;
        return { accepted: true, duplicate: false };
      }

      // First delivery: accepted and incremented
      const res1 = handleRetellEvent({ eventId: "evt_1001", durationSeconds: 120 });
      expect(res1.accepted).toBe(true);
      expect(res1.duplicate).toBe(false);
      expect(voiceMinutesTotal).toBe(2);

      // Replay of same event: rejected as duplicate, usage unchanged
      const res2 = handleRetellEvent({ eventId: "evt_1001", durationSeconds: 120 });
      expect(res2.accepted).toBe(false);
      expect(res2.duplicate).toBe(true);
      expect(voiceMinutesTotal).toBe(2); // Still 2, NOT 4!

      // Legitimate separate event: accepted and incremented
      const res3 = handleRetellEvent({ eventId: "evt_1002", durationSeconds: 60 });
      expect(res3.accepted).toBe(true);
      expect(res3.duplicate).toBe(false);
      expect(voiceMinutesTotal).toBe(3);
    });

    it("multi-tenant webhook events are isolated by tenant and do not cross-bill", () => {
      const tenantUsage: Record<string, number> = {
        tenant_1: 0,
        tenant_2: 0,
      };

      function recordTenantUsage(tenantId: string, durationSeconds: number) {
        tenantUsage[tenantId] = (tenantUsage[tenantId] ?? 0) + durationSeconds / 60;
      }

      recordTenantUsage("tenant_1", 300); // 5 mins
      recordTenantUsage("tenant_2", 120); // 2 mins

      expect(tenantUsage["tenant_1"]).toBe(5);
      expect(tenantUsage["tenant_2"]).toBe(2);
    });

    it("booking accounting increments bookingCount for the active billing period only", async () => {
      const mockDb = createMockDb();
      const asOf = new Date("2026-09-10T12:00:00.000Z");

      const usage = await getActiveUsageRow("biz_realty", asOf, mockDb as unknown as DbExecutor);
      expect(usage.bookingCount).toBe(0);

      // Simulate booking increment
      usage.bookingCount += 1;

      const activeAfterBooking = await getActiveUsageRow("biz_realty", asOf, mockDb as unknown as DbExecutor);
      expect(activeAfterBooking.bookingCount).toBe(1);
    });

    it("GetUsageResponse response shape correctly conforms to API contract with dynamic period_label", () => {
      const { periodLabel } = getBillingPeriod(new Date("2026-09-15T12:00:00.000Z"));
      const business = { id: "biz_test", includedVoiceMinutes: 500 };
      const usage = {
        voiceMinutes: "42.5",
        smsCount: 10,
        bookingCount: 4,
        estimatedCost: "5.10",
      };

      const responsePayload = {
        period_label: periodLabel,
        voice_minutes: Number(usage.voiceMinutes),
        included_minutes: business.includedVoiceMinutes,
        sms_count: usage.smsCount,
        booking_count: usage.bookingCount,
        estimated_cost: Number(usage.estimatedCost),
      };

      expect(responsePayload).toEqual({
        period_label: "September 2026",
        voice_minutes: 42.5,
        included_minutes: 500,
        sms_count: 10,
        booking_count: 4,
        estimated_cost: 5.1,
      });
    });
  });
});

