// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PilotFeatureBoundary } from "../components/pilot-feature-boundary";

afterEach(cleanup);

it("does not mount simulated features for authenticated customer workspaces", () => {
  const simulatedAction = vi.fn();
  function Prototype() {
    simulatedAction();
    return createElement("div", null, "Deployed to Retell");
  }
  render(createElement(PilotFeatureBoundary, {
    isDemo: false,
    children: createElement(Prototype),
  }));
  expect(screen.getByTestId("pilot-feature-unavailable")).toBeTruthy();
  expect(screen.queryByText("Deployed to Retell")).toBeNull();
  expect(simulatedAction).not.toHaveBeenCalled();
});

it("labels simulated features explicitly in a local demo", () => {
  render(createElement(PilotFeatureBoundary, {
    isDemo: true,
    children: createElement("div", null, "Sample agent"),
  }));
  expect(screen.getByText("Sample agent")).toBeTruthy();
  expect(screen.getByRole("note").textContent).toContain("simulated controls only");
});
