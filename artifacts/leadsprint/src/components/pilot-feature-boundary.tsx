import React, { type ReactNode } from "react";

/** Prototype screens must never impersonate customer data or provider actions. */
export function PilotFeatureBoundary({ isDemo, children }: {
  isDemo: boolean;
  children: ReactNode;
}) {
  if (!isDemo) {
    return (
      <section
        className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-8"
        data-testid="pilot-feature-unavailable"
      >
        <h1 className="text-xl font-bold">Not available in the managed pilot</h1>
        <p className="mt-3 text-sm leading-6">
          This feature is a prototype, not a connected service. No agent
          deployments, team invitations, payments, live-call controls, or advanced
          analytics are performed here. Your deployment operator manages provider
          configuration and invoicing outside the console. Use Settings for
          business configuration, Calls for call history, and Reports for recorded
          usage.
        </p>
      </section>
    );
  }
  return (
    <div>
      <p
        role="note"
        className="mb-5 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
      >
        Prototype preview — sample data and simulated controls only. Changes are
        not saved, no invitations or payments are sent, and no real call or agent
        is controlled.
      </p>
      {children}
    </div>
  );
}
