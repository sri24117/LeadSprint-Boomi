import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { evaluateCallPolicy } from "./lib/policy";
import {
  startRetellCall,
  getCalAvailability,
  createCalBooking,
  hasRetellConfigForMarket,
} from "./lib/providers";

describe("Phase 3 Milestone 1 — Multi-Tenant Provider Binding & Usage Enforcement", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("A. Retell Tenant Phone Number Routing", () => {
    it("uses Business A's configured phone number as from_number", async () => {
      process.env["RETELL_API_KEY"] = "retell_api_key_test";
      process.env["RETELL_AGENT_ID"] = "retell_default_agent";
      process.env["RETELL_FROM_NUMBER_US"] = "+19999999999"; // Global fallback

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ call_id: "call_a_123" }),
      });
      global.fetch = fetchMock;

      const businessAPhone = "+12125550101";
      const result = await startRetellCall({
        toNumber: "+15551234567",
        market: "US",
        fromNumber: businessAPhone,
        agentId: "agent_alpha",
        metadata: { business_id: "biz_a", lead_id: "lead_a" },
      });

      expect(result.callId).toBe("call_a_123");
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const [url, requestInit] = fetchMock.mock.calls[0];
      expect(url).toBe("https://api.retellai.com/v2/create-phone-call");
      const body = JSON.parse(requestInit.body);
      expect(body.from_number).toBe(businessAPhone);
      expect(body.from_number).not.toBe("+19999999999");
      expect(body.agent_id).toBe("agent_alpha");
    });

    it("uses Business B's configured phone number as from_number", async () => {
      process.env["RETELL_API_KEY"] = "retell_api_key_test";
      process.env["RETELL_AGENT_ID"] = "retell_default_agent";
      process.env["RETELL_FROM_NUMBER_US"] = "+19999999999";

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ call_id: "call_b_456" }),
      });
      global.fetch = fetchMock;

      const businessBPhone = "+13125550202";
      const result = await startRetellCall({
        toNumber: "+15559876543",
        market: "US",
        fromNumber: businessBPhone,
        agentId: "agent_beta",
        metadata: { business_id: "biz_b", lead_id: "lead_b" },
      });

      expect(result.callId).toBe("call_b_456");
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.from_number).toBe(businessBPhone);
      expect(body.from_number).not.toBe("+19999999999");
      expect(body.agent_id).toBe("agent_beta");
    });

    it("hasRetellConfigForMarket recognizes tenant phone number", () => {
      process.env["RETELL_API_KEY"] = "test_key";
      process.env["RETELL_AGENT_ID"] = "test_agent";
      delete process.env["RETELL_FROM_NUMBER_US"];
      delete process.env["RETELL_FROM_NUMBER"];

      expect(hasRetellConfigForMarket("US")).toBe(false);
      expect(hasRetellConfigForMarket("US", "+12125550101")).toBe(true);
    });
  });

  describe("B. Cal.com Tenant Event Type Routing", () => {
    it("availability query sends tenant-specific event type", async () => {
      process.env["CALCOM_API_KEY"] = "cal_api_key_test";
      process.env["CALCOM_EVENT_TYPE_ID"] = "9999"; // Global default

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ slots: [] }),
      });
      global.fetch = fetchMock;

      const tenantAEventType = "101";
      await getCalAvailability({
        start: "2026-09-15T00:00:00.000Z",
        end: "2026-09-16T00:00:00.000Z",
        timeZone: "America/New_York",
        eventTypeId: tenantAEventType,
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const url = new URL(fetchMock.mock.calls[0][0]);
      expect(url.searchParams.get("eventTypeId")).toBe("101");
      expect(url.searchParams.get("eventTypeId")).not.toBe("9999");
    });

    it("booking creation sends tenant-specific event type", async () => {
      process.env["CALCOM_API_KEY"] = "cal_api_key_test";
      process.env["CALCOM_EVENT_TYPE_ID"] = "9999";

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ uid: "booking_b_uid_789" }),
      });
      global.fetch = fetchMock;

      const tenantBEventType = "202";
      const result = await createCalBooking({
        start: "2026-09-15T14:00:00.000Z",
        end: "2026-09-15T14:30:00.000Z",
        timeZone: "America/Chicago",
        attendee: { name: "Tenant B Lead", email: "lead@example.com" },
        metadata: { business_id: "biz_b", lead_id: "lead_b" },
        eventTypeId: tenantBEventType,
      });

      expect(result.bookingId).toBe("booking_b_uid_789");
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.eventTypeId).toBe(202);
      expect(body.eventTypeId).not.toBe(9999);
    });
  });

  describe("C. Usage Entitlement Pre-Dispatch Policy Gate", () => {
    it("blocks outbound call when voiceMinutes equals includedVoiceMinutes", () => {
      const decision = evaluateCallPolicy({
        business: {
          timezone: "America/New_York",
          quietHours: "21:00-08:00",
          maxCallAttempts: 2,
          includedVoiceMinutes: 300,
          currentVoiceMinutes: 300,
        },
        contact: {
          consentStatus: "valid",
          suppressedAt: null,
        },
        attemptsSoFar: 0,
        now: new Date("2026-09-11T14:00:00.000Z"), // 10:00 AM EDT (outside quiet hours)
      });

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe("usage_limit");
      expect(decision.message).toContain("Voice minutes entitlement (300m) exhausted");
    });

    it("blocks outbound call when voiceMinutes exceeds includedVoiceMinutes", () => {
      const decision = evaluateCallPolicy({
        business: {
          timezone: "America/New_York",
          quietHours: "21:00-08:00",
          maxCallAttempts: 2,
          includedVoiceMinutes: 300,
          currentVoiceMinutes: 300.5,
        },
        contact: {
          consentStatus: "valid",
          suppressedAt: null,
        },
        attemptsSoFar: 0,
        now: new Date("2026-09-11T14:00:00.000Z"),
      });

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe("usage_limit");
    });

    it("allows outbound call when voiceMinutes is below includedVoiceMinutes (e.g. 299)", () => {
      const decision = evaluateCallPolicy({
        business: {
          timezone: "America/New_York",
          quietHours: "21:00-08:00",
          maxCallAttempts: 2,
          includedVoiceMinutes: 300,
          currentVoiceMinutes: 299,
        },
        contact: {
          consentStatus: "valid",
          suppressedAt: null,
        },
        attemptsSoFar: 0,
        now: new Date("2026-09-11T14:00:00.000Z"),
      });

      expect(decision.allowed).toBe(true);
      expect(decision.reason).toBeUndefined();
    });
  });

  describe("D. Dynamic Unresolved Messages Evaluation Semantics", () => {
    it("identifies leads requiring callback across tenant boundaries", () => {
      const leads = [
        { businessId: "biz_a", nextAction: "Call back — requested human" },
        { businessId: "biz_a", nextAction: "Call lead" },
        { businessId: "biz_a", nextAction: "Appointment confirmed" },
        { businessId: "biz_b", nextAction: "Call back — transfer failed" },
        { businessId: "biz_b", nextAction: "No further calls" },
      ];

      function countUnresolved(bizId: string) {
        return leads.filter(
          (l) =>
            l.businessId === bizId &&
            l.nextAction.toLowerCase().includes("call back"),
        ).length;
      }

      expect(countUnresolved("biz_a")).toBe(1);
      expect(countUnresolved("biz_b")).toBe(1);
      expect(countUnresolved("biz_c")).toBe(0);
    });
  });
});
