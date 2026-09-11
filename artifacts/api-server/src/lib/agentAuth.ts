import type { Request } from "express";
import { verifyRetellSignature, extractRetellCall } from "./providers";
import { providerConfig } from "./providers";

export class AgentAuthError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
  }
}

export interface AgentToolRequest {
  businessId: string;
  leadId: string;
  callId: string;
  args: Record<string, unknown>;
}

/**
 * Verifies and parses an incoming Retell agent-tool ("custom function")
 * request. Retell's real envelope for these is
 * `{ name, call: {...}, args: {...} }` — the same signature scheme
 * (X-Retell-Signature: v={ts},d={hex}) used for call webhooks applies
 * here too.
 *
 * Deliberately does NOT trust business_id/lead_id if the LLM tries to
 * pass them as tool arguments — an agent tool call is driven by whatever
 * the model decides to say, and the model should never be the source of
 * truth for which tenant/lead this action applies to. Both are derived
 * only from `call.metadata`, which was set by LeadSprint itself at
 * call-creation time (see startRetellCall's metadata in routes/leadsprint.ts
 * and routes/cron.ts) and is therefore trustworthy once the signature
 * verifies.
 */
export function parseAgentToolRequest(req: Request, rawBody: Buffer): AgentToolRequest {
  const apiKey = providerConfig().retell.webhookSecret ?? providerConfig().retell.apiKey;
  if (!verifyRetellSignature(rawBody, req.get("x-retell-signature"), apiKey)) {
    throw new AgentAuthError("Invalid Retell signature", 401);
  }
  const body = req.body as Record<string, unknown>;
  const call = extractRetellCall(body);
  const metadata = (call.metadata && typeof call.metadata === "object" ? call.metadata : {}) as Record<string, unknown>;
  const businessId = typeof metadata.business_id === "string" ? metadata.business_id : "";
  const leadId = typeof metadata.lead_id === "string" ? metadata.lead_id : "";
  const callId = typeof call.call_id === "string" ? call.call_id : "";
  if (!businessId || !leadId) {
    throw new AgentAuthError("call.metadata.business_id and lead_id are required", 400);
  }
  const args = (body.args && typeof body.args === "object" ? body.args : {}) as Record<string, unknown>;
  return { businessId, leadId, callId, args };
}
