import { Link } from 'wouter';
import { ArrowUpRight, CheckCircle2, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useGetOnboardingChecklist } from '@workspace/api-client-react';
import { QuietLink } from '@/components/common';

export function SetupChecklist({ compact = false }: { compact?: boolean }) {
  const checklist = useGetOnboardingChecklist();
  if (checklist.isLoading || checklist.isError || !checklist.data) return null;
  const { ready_for_live_calls, items, missing_required } = checklist.data;
  const outstanding = items.filter((item) => !item.complete);

  if (ready_for_live_calls && !outstanding.length) {
    if (compact) return null;
    return (
      <section
        className="rounded-lg border border-[hsl(var(--success))/0.35] bg-[hsl(var(--success))/0.08] p-4"
        data-testid="panel-setup-ready"
      >
        <div className="flex items-start gap-3">
          <CheckCircle2 className="text-[hsl(var(--success))]" size={17} />
          <div className="flex-1">
            <h3 className="font-bold text-[hsl(var(--foreground))]">Setup complete — live calling is enabled</h3>
            <p className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">
              Every required item is configured. The safety policy still gates each individual call.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      className={`rounded-lg border p-4 ${
        ready_for_live_calls
          ? 'border-[hsl(var(--border))] bg-[hsl(var(--card))]'
          : 'border-[hsl(var(--destructive))/0.35] bg-[hsl(var(--destructive))/0.05]'
      }`}
      data-testid="panel-setup-checklist"
    >
      <div className="flex items-start gap-3">
        <div
          className={`rounded-md p-2 ${
            ready_for_live_calls
              ? 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]'
              : 'bg-[hsl(var(--destructive))/0.12] text-[hsl(var(--destructive))]'
          }`}
        >
          {ready_for_live_calls ? <ShieldCheck size={17} /> : <ShieldAlert size={17} />}
        </div>
        <div className="flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-bold text-[hsl(var(--foreground))]">
              {ready_for_live_calls
                ? 'Recommended setup still outstanding'
                : 'Live calling is disabled until setup is complete'}
            </h3>
            <QuietLink
              href="/workspace/business-settings"
              data-testid="link-open-setup-settings"
            >
              Open settings <ArrowUpRight size={12} />
            </QuietLink>
          </div>
          {!ready_for_live_calls && (
            <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
              {missing_required.length} required {missing_required.length === 1 ? 'item is' : 'items are'} missing.
              LeadSprint will not place calls until they are configured.
            </p>
          )}
          <div className="mt-4 space-y-2">
            {outstanding.map((item) => (
              <div key={item.key} className="flex items-start gap-2.5 text-sm" data-testid={`checklist-item-${item.key}`}>
                <span
                  className={`mt-[3px] h-3.5 w-3.5 shrink-0 rounded-sm border ${
                    item.severity === 'required'
                      ? 'border-[hsl(var(--destructive))/0.55]'
                      : 'border-[hsl(var(--border))]'
                  }`}
                />
                <span className="min-w-0">
                  <span className="font-semibold text-[hsl(var(--foreground))]">{item.label}</span>
                  {item.severity === 'recommended' && (
                    <span className="ml-2 text-[10px] font-bold uppercase tracking-[.1em] text-[hsl(var(--muted-foreground))]">
                      optional
                    </span>
                  )}
                  <span className="mt-0.5 block text-xs leading-5 text-[hsl(var(--muted-foreground))]">
                    {item.detail}
                  </span>
                </span>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-[hsl(var(--muted-foreground))]">
            {items.length - outstanding.length} of {items.length} configured.
          </p>
        </div>
      </div>
    </section>
  );
}
