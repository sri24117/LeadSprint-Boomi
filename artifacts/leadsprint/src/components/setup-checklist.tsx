import { Link } from 'wouter';
import { ArrowUpRight, CheckCircle2, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useGetOnboardingChecklist } from '@workspace/api-client-react';

export function SetupChecklist({ compact = false }: { compact?: boolean }) {
  const checklist = useGetOnboardingChecklist();
  if (checklist.isLoading || checklist.isError || !checklist.data) return null;
  const { ready_for_live_calls, items, missing_required } = checklist.data;
  const outstanding = items.filter((item) => !item.complete);

  if (ready_for_live_calls && !outstanding.length) {
    if (compact) return null;
    return (
      <section
        className="rounded-xl border border-[hsl(var(--accent)/.3)] bg-[hsl(var(--accent)/.06)] p-5"
        data-testid="panel-setup-ready"
      >
        <div className="flex items-center gap-3">
          <CheckCircle2 className="text-[hsl(var(--accent))]" size={18} />
          <div>
            <h3 className="font-bold">Setup complete — live calling is enabled</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Every required item is configured. The safety policy still gates each individual call.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      className={`rounded-xl border p-5 ${
        ready_for_live_calls
          ? 'border-border bg-[hsl(var(--card))]'
          : 'border-[hsl(var(--destructive)/.35)] bg-[hsl(var(--destructive)/.05)]'
      }`}
      data-testid="panel-setup-checklist"
    >
      <div className="flex items-start gap-3">
        <div
          className={`rounded-lg p-2 ${
            ready_for_live_calls
              ? 'bg-[hsl(var(--muted))] text-muted-foreground'
              : 'bg-[hsl(var(--destructive)/.12)] text-[hsl(var(--destructive))]'
          }`}
        >
          {ready_for_live_calls ? <ShieldCheck size={18} /> : <ShieldAlert size={18} />}
        </div>
        <div className="flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-bold">
              {ready_for_live_calls
                ? 'Recommended setup still outstanding'
                : 'Live calling is disabled until setup is complete'}
            </h3>
            <Link
              href="/workspace/business-settings"
              className="text-xs font-bold text-[hsl(var(--accent))] hover:underline"
              data-testid="link-open-setup-settings"
            >
              Open settings <ArrowUpRight size={13} className="ml-1 inline" />
            </Link>
          </div>
          {!ready_for_live_calls && (
            <p className="mt-1 text-sm text-muted-foreground">
              {missing_required.length} required {missing_required.length === 1 ? 'item is' : 'items are'} missing.
              LeadSprint will not place calls until they are configured.
            </p>
          )}
          <div className="mt-4 space-y-2">
            {outstanding.map((item) => (
              <div key={item.key} className="flex items-start gap-2.5 text-sm" data-testid={`checklist-item-${item.key}`}>
                <span
                  className={`mt-1 h-3.5 w-3.5 shrink-0 rounded-[4px] border ${
                    item.severity === 'required' ? 'border-[hsl(var(--destructive)/.55)]' : 'border-border'
                  }`}
                />
                <span className="min-w-0">
                  <span className="font-semibold">{item.label}</span>
                  {item.severity === 'recommended' && (
                    <span className="ml-2 text-[10px] font-bold uppercase tracking-[.1em] text-muted-foreground">
                      optional
                    </span>
                  )}
                  <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{item.detail}</span>
                </span>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            {items.length - outstanding.length} of {items.length} configured.
          </p>
        </div>
      </div>
    </section>
  );
}
