import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import type { Request } from "express";
import { AgentAuthError, parseAgentToolRequest } from "./agentAuth";

const API_KEY = "test_retell_api_key";
process.env["RETELL_API_KEY"] = API_KEY;

function sign(body: string, timestampMs: number): string {
  const digest = crypto.createHmac("sha256", API_KEY).update(body + String(timestampMs)).digest("hex");
  return `v=${timestampMs},d=${digest}`;
}

function makeRequest(bodyObj: unknown, signatureHeader?: string): Request {
  const body = JSON.stringify(bodyObj);
  return {
    body: bodyObj,
    get: (header: string) => (header.toLowerCase() === "x-retell-signature" ? signatureHeader : undefined),
  } as unknown as Request;
}

describe("parseAgentToolRequest", () => {
  const validPayload = {
    name: "book_appointment",
    call: { call_id: "call_abc", metadata: { business_id: "biz_1", lead_id: "lead_1" } },
    args: { slot_start: "2026-09-10T15:00:00Z" },
  };

  it("parses a validly signed request and extracts business/lead/call from call.metadata, not args", () => {
    const body = JSON.stringify(validPayload);
    const now = Date.now();
    const sig = sign(body, now);
    const req = makeRequest(validPayload, sig);
    const result = parseAgentToolRequest(req, Buffer.from(body));
    expect(result).toEqual({
      businessId: "biz_1",
      leadId: "lead_1",
      callId: "call_abc",
      args: { slot_start: "2026-09-10T15:00:00Z" },
    });
  });

  it("throws AgentAuthError(401) on an invalid signature", () => {
    const body = JSON.stringify(validPayload);
    const req = makeRequest(validPayload, "v=123,d=deadbeef");
    expect(() => parseAgentToolRequest(req, Buffer.from(body))).toThrow(AgentAuthError);
    try {
      parseAgentToolRequest(req, Buffer.from(body));
    } catch (error) {
      expect(error).toBeInstanceOf(AgentAuthError);
      expect((error as AgentAuthError).statusCode).toBe(401);
    }
  });

  it("throws AgentAuthError(400) when metadata is missing business_id/lead_id", () => {
    const badPayload = { call: { call_id: "call_abc", metadata: {} } };
    const body = JSON.stringify(badPayload);
    const now = Date.now();
    const sig = sign(body, now);
    const req = makeRequest(badPayload, sig);
    try {
      parseAgentToolRequest(req, Buffer.from(body));
      expect.fail("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AgentAuthError);
      expect((error as AgentAuthError).statusCode).toBe(400);
    }
  });

  // The critical security property: even if a malicious or confused LLM
  // tool call includes its own business_id/lead_id inside `args`, those
  // are ignored — only call.metadata (set by LeadSprint itself, not the
  // model) is trusted.
  it("ignores business_id/lead_id if supplied inside args instead of call.metadata", () => {
    const spoofPayload = {
      call: { call_id: "call_abc", metadata: { business_id: "biz_real", lead_id: "lead_real" } },
      args: { business_id: "biz_SPOOFED", lead_id: "lead_SPOOFED", slot_start: "x" },
    };
    const body = JSON.stringify(spoofPayload);
    const sig = sign(body, Date.now());
    const req = makeRequest(spoofPayload, sig);
    const result = parseAgentToolRequest(req, Buffer.from(body));
    expect(result.businessId).toBe("biz_real");
    expect(result.leadId).toBe("lead_real");
    // args are passed through untouched for the route to use, but the
    // identity fields inside them were never read for auth purposes.
    expect(result.args.business_id).toBe("biz_SPOOFED");
  });
});
