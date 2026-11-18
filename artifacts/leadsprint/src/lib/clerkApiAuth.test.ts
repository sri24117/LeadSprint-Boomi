// @vitest-environment jsdom
import { createElement, useEffect } from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClerkApiAuth } from "../components/clerk-api-auth";
import { customFetch, setAuthTokenGetter } from "../../../../lib/api-client-react/src/custom-fetch";

const auth = vi.hoisted(() => ({
  isLoaded: true,
  isSignedIn: true,
  sessionId: "session_a" as string | null,
  getToken: vi.fn<() => Promise<string | null>>(),
}));
vi.mock("@clerk/react", () => ({ useAuth: () => auth }));

function Consumer() {
  useEffect(() => { void customFetch("/api/auth/me"); }, []);
  return null;
}
function tree() {
  return createElement(ClerkApiAuth, { children: createElement(Consumer) });
}
const fetchMock = vi.fn();

afterEach(() => {
  cleanup();
  setAuthTokenGetter(null);
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  Object.assign(auth, { isLoaded: true, isSignedIn: true, sessionId: "session_a" });
});

function setupFetch() {
  fetchMock.mockImplementation(async () => new Response('{"ok":true}', {
    headers: { "content-type": "application/json" },
  }));
  vi.stubGlobal("fetch", fetchMock);
}
function authorization(call: number) {
  return new Headers(fetchMock.mock.calls[call][1].headers).get("authorization");
}

describe("Clerk → API session bridge", () => {
  it("attaches a bearer token to the very first child API request without a cookie", async () => {
    setupFetch();
    auth.getToken.mockResolvedValue("first-token");
    render(tree());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(authorization(0)).toBe("Bearer first-token");
  });

  it("does not mount API consumers before Clerk has loaded", async () => {
    setupFetch();
    auth.isLoaded = false;
    const view = render(tree());
    expect(fetchMock).not.toHaveBeenCalled();
    auth.isLoaded = true;
    auth.getToken.mockResolvedValue("ready-token");
    view.rerender(tree());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(authorization(0)).toBe("Bearer ready-token");
  });

  it("gets a renewable token on each request and does not overwrite explicit auth", async () => {
    setupFetch();
    auth.getToken.mockResolvedValueOnce("old-token").mockResolvedValueOnce("new-token");
    render(tree());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await customFetch("/api/business-settings");
    expect(authorization(1)).toBe("Bearer new-token");
    await customFetch("/api/custom", { headers: { Authorization: "Bearer explicit" } });
    expect(authorization(2)).toBe("Bearer explicit");
    expect(auth.getToken).toHaveBeenCalledTimes(2);
  });

  it("clears the getter on sign-out and unmount", async () => {
    setupFetch();
    auth.getToken.mockResolvedValue("signed-in-token");
    const view = render(tree());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    auth.isSignedIn = false;
    auth.sessionId = null;
    view.rerender(tree());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(authorization(1)).toBeNull();
    view.unmount();
    await customFetch("/api/auth/me");
    expect(authorization(2)).toBeNull();
    expect(auth.getToken).toHaveBeenCalledTimes(1);
  });

  it("propagates token failures without sending an unauthenticated fallback request", async () => {
    setupFetch();
    auth.isSignedIn = false;
    auth.sessionId = null;
    render(tree());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    setAuthTokenGetter(() => Promise.reject(new Error("Session expired")));
    await expect(customFetch("/api/business-settings")).rejects.toThrow("Session expired");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
