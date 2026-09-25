import {
  Activity as ActivityIcon,
  CalendarDays,
  PhoneCall,
  Target,
  UsersRound,
} from 'lucide-react';
import { useGetUsage, useGetWeeklyReport } from '@workspace/api-client-react';
import { ErrorState, Info, Skeleton } from '@/components/common';

export default function ReportsPage() {
  const report = useGetWeeklyReport();
  const usage = useGetUsage();

  if (report.isLoading || usage.isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-32" />
        <div className="grid gap-4 sm:grid-cols-3">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      </div>
    );
  }

  if (report.isError || usage.isError || !report.data || !usage.data) {
    return (
      <ErrorState
        retry={() => {
          report.refetch();
          usage.refetch();
        }}
      />
    );
  }

  const data = report.data;
  const bars = [
    { label: 'Leads received', value: data.leads_received },
    { label: 'Calls attempted', value: data.calls_attempted },
    { label: 'Qualified leads', value: data.qualified_leads },
    { label: 'Appointments', value: data.appointments_booked },
  ];

  return (
    <div className="animate-rise-in space-y-7">
      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm text-muted-foreground">{data.period_label}</p>
          <h2 className="mt-1 text-2xl font-bold tracking-[-.04em]">A weekly pulse, not a vanity dashboard.</h2>
        </div>
        <span className="font-mono text-xs text-muted-foreground">Updated just now</span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Leads received', value: data.leads_received, detail: 'new enquiries', icon: UsersRound },
          { label: 'Connected calls', value: data.calls_connected, detail: `${data.calls_attempted} attempted`, icon: PhoneCall },
          { label: 'Qualified', value: data.qualified_leads, detail: 'operator-confirmed', icon: Target },
          { label: 'Appointments', value: data.appointments_booked, detail: `${data.transfer_rate}% transfer rate`, icon: CalendarDays },
        ].map((item) => (
          <div key={item.label} className="rounded-xl border border-border bg-[hsl(var(--card))] p-5">
            <div className="flex justify-between">
              <p className="text-xs font-semibold text-muted-foreground">{item.label}</p>
              <item.icon size={17} className="text-[hsl(var(--accent))]" />
            </div>
            <p className="mt-5 font-mono text-3xl font-bold tracking-[-.07em]">{item.value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{item.detail}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.1fr_.9fr]">
        <section className="rounded-xl border border-border bg-[hsl(var(--card))] p-5">
          <h3 className="font-bold">Funnel movement</h3>
          <p className="mt-1 text-xs text-muted-foreground">Counts across the current pilot period.</p>
          <div className="mt-7 space-y-5">
            {bars.map((bar, index) => (
              <div key={bar.label}>
                <div className="mb-2 flex justify-between text-sm">
                  <span className="font-semibold">{bar.label}</span>
                  <span className="font-mono text-xs text-muted-foreground">{bar.value}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-[hsl(var(--muted))]">
                  <div
                    className="h-full rounded-full bg-[hsl(var(--accent))] transition-all"
                    style={{
                      width: `${Math.max(7, Math.min(100, (bar.value / Math.max(1, data.leads_received)) * 100))}%`,
                      opacity: 1 - index * 0.13,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-7 grid grid-cols-2 gap-4 border-t border-border pt-5">
            <Info label="Failed actions" value={String(data.failed_actions)} />
            <Info label="Voice minutes" value={String(data.voice_minutes)} />
          </div>
        </section>

        <section className="rounded-xl border border-border bg-[hsl(var(--primary))] p-5 text-[hsl(var(--primary-foreground))]">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[.18em] text-[hsl(var(--secondary))]">Current usage</p>
              <h3 className="mt-2 text-xl font-bold">{usage.data.period_label}</h3>
            </div>
            <ActivityIcon size={19} className="text-[hsl(var(--secondary))]" />
          </div>
          <div className="mt-8">
            <div className="flex items-end justify-between">
              <span className="text-sm text-[hsl(var(--primary-foreground)/.7)]">Voice minutes</span>
              <span className="font-mono text-sm">
                {usage.data.voice_minutes} / {usage.data.included_minutes}
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-[hsl(var(--primary-foreground)/.16)]">
              <div
                className="h-full rounded-full bg-[hsl(var(--secondary))]"
                style={{
                  width: `${Math.min(100, (usage.data.voice_minutes / Math.max(1, usage.data.included_minutes)) * 100)}%`,
                }}
              />
            </div>
          </div>
          <div className="mt-7 grid grid-cols-2 gap-y-5 border-t border-[hsl(var(--primary-foreground)/.16)] pt-5">
            <div>
              <p className="text-[11px] text-[hsl(var(--primary-foreground)/.55)]">SMS count</p>
              <p className="mt-1 font-mono text-lg">{usage.data.sms_count}</p>
            </div>
            <div>
              <p className="text-[11px] text-[hsl(var(--primary-foreground)/.55)]">Bookings</p>
              <p className="mt-1 font-mono text-lg">{usage.data.booking_count}</p>
            </div>
            <div>
              <p className="text-[11px] text-[hsl(var(--primary-foreground)/.55)]">Est. provider cost</p>
              <p className="mt-1 font-mono text-lg">${usage.data.estimated_cost.toFixed(2)}</p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
