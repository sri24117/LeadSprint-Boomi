/**
 * What startRetellCall actually puts on the wire to Retell.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startRetellCall } from "./providers";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubEnv("RETELL_API_KEY", "key_test");
  vi.stubEnv("RETELL_AGENT_ID", "agent_test");
  vi.stubEnv("RETELL_FROM_NUMBER_US", "+12125550100");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ call_id: "call_abc" }), { status: 201 }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function sentBody(): Record<string, unknown> {
  return JSON.parse(fetchMock.mock.calls[0]?.[1].body as string);
}

describe("startRetellCall request", () => {
  it("sends the per-call variables as retell_llm_dynamic_variables", async () => {
    const result = await startRetellCall({
      toNumber: "+15125550142",
      market: "US",
      metadata: { business_id: "b1", lead_id: "l1", call_id: "c1" },
      dynamicVariables: { lead_name: "Dana Reyes", problem: "AC not cooling" },
    });
    expect(result).toEqual({ callId: "call_abc" });
    expect(sentBody()).toMatchObject({
      to_number: "+15125550142",
      from_number: "+12125550100",
      override_agent_id: "agent_test",
      metadata: { business_id: "b1", lead_id: "l1", call_id: "c1", market: "US" },
      retell_llm_dynamic_variables: { lead_name: "Dana Reyes", problem: "AC not cooling" },
    });
  });

  it("is unchanged when no variables are supplied: the field is simply absent", async () => {
    await startRetellCall({ toNumber: "+15125550142", market: "US", metadata: { business_id: "b1" } });
    expect(sentBody()).not.toHaveProperty("retell_llm_dynamic_variables");
    expect(sentBody()).toMatchObject({ override_agent_id: "agent_test", to_number: "+15125550142" });
  });

  it("omits an empty variable set rather than sending {}", async () => {
    await startRetellCall({ toNumber: "+15125550142", market: "US", metadata: {}, dynamicVariables: {} });
    expect(sentBody()).not.toHaveProperty("retell_llm_dynamic_variables");
  });
});
