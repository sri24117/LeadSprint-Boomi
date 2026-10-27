import {
  Activity as ActivityIcon,
  CalendarDays,
  PhoneCall,
  Target,
  UsersRound,
} from 'lucide-react';
import { useGetUsage, useGetWeeklyReport } from '@workspace/api-client-react';
import {
  EmptyState,
  ErrorState,
  Info,
  PageHeader,
  Section,
  SectionBody,
  Skeleton,
} from '@/components/common';

export default function ReportsPage() {
  const report = useGetWeeklyReport();
  const usage = useGetUsage();

  if (report.isLoading || usage.isLoading) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow="Console" title="Reports" />
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
      <div className="space-y-5">
        <PageHeader eyebrow="Console" title="Reports" />
        <ErrorState
          retry={() => {
            report.refetch();
            usage.refetch();
          }}
        />
      </div>
    );
  }

  const data = report.data;
  const bars = [
    { label: 'Leads received', value: data.leads_received },
    { label: 'Calls attempted', value: data.calls_attempted },
    { label: 'Qualified leads', value: data.qualified_leads },
    { label: 'Appointments', value: data.appointments_booked },
  ];

  const maxBar = Math.max(1, ...bars.map((b) => b.value), data.leads_received || 1);

  return (
    <div className="animate-rise-in space-y-7">
      <PageHeader
        eyebrow="Console"
        title="Reports"
        description="A grounded view of your weekly operation."
      />
      <div className="flex items-center gap-2">
        <span className="text-sm text-[hsl(var(--muted-foreground))]">{data.period_label}</span>
        <span className="font-mono text-xs text-[hsl(var(--muted-foreground))]">Updated just now</span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Leads received', value: data.leads_received, detail: 'new enquiries', icon: UsersRound },
          { label: 'Connected calls', value: data.calls_connected, detail: `${data.calls_attempted} attempted`, icon: PhoneCall },
          { label: 'Qualified', value: data.qualified_leads, detail: 'operator-confirmed', icon: Target },
          { label: 'Appointments', value: data.appointments_booked, detail: `${data.transfer_rate}% transfer rate`, icon: CalendarDays },
        ].map((item) => (
          <Section key={item.label}>
            <SectionBody className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-[hsl(var(--muted-foreground))]">{item.label}</p>
                <item.icon size={16} className="text-[hsl(var(--primary))]" />
              </div>
              <p className="font-mono text-2xl font-bold tracking-[-.04em] text-[hsl(var(--foreground))]">{item.value}</p>
              <p className="text-xs text-[hsl(var(--muted-foreground))]">{item.detail}</p>
            </SectionBody>
          </Section>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        <Section
          title="Funnel movement"
          description="Counts across the current pilot period."
        >
          <div className="space-y-5">
            {bars.map((bar, index) => (
              <div key={bar.label}>
                <div className="mb-1.5 flex justify-between text-xs">
                  <span className="font-semibold text-[hsl(var(--foreground))]">{bar.label}</span>
                  <span className="font-mono text-xs text-[hsl(var(--muted-foreground))]">{bar.value}</span>
                </div>
                <div className="h-2 rounded-full overflow-hidden bg-[hsl(var(--muted))]">
                  <div
                    className="h-full bg-[hsl(var(--primary))] transition-all"
                    style={{
                      width: `${Math.max(7, Math.min(100, (bar.value / maxBar) * 100))}%`,
                      opacity: 1 - index * 0.13,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-6 grid grid-cols-2 gap-4 border-t border-[hsl(var(--border))] pt-5">
            <Info label="Failed actions" value={String(data.failed_actions)} />
            <Info label="Voice minutes" value={String(data.voice_minutes)} />
          </div>
        </Section>

        <Section title="Current usage" description={usage.data.period_label}>
          <div className="space-y-4">
            <div className="flex items-end justify-between">
              <span className="text-sm text-[hsl(var(--muted-foreground))]">Voice minutes</span>
              <span className="font-mono text-sm text-[hsl(var(--foreground))]">
                {usage.data.voice_minutes} / {usage.data.included_minutes}
              </span>
            </div>
            <div className="mt-2 h-2 rounded-full overflow-hidden bg-[hsl(var(--muted))]">
              <div
                className="h-full bg-[hsl(var(--primary))]"
                style={{
                  width: `${Math.min(100, (usage.data.voice_minutes / Math.max(1, usage.data.included_minutes)) * 100)}%`,
                }}
              />
            </div>
            <div className="grid grid-cols-3 gap-4 border-t border-[hsl(var(--border))] pt-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[.1em] text-[hsl(var(--muted-foreground))]">SMS count</p>
                <p className="mt-1 font-mono text-[hsl(var(--foreground))]">{usage.data.sms_count}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[.1em] text-[hsl(var(--muted-foreground))]">Bookings</p>
                <p className="mt-1 font-mono text-[hsl(var(--foreground))]">{usage.data.booking_count}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[.1em] text-[hsl(var(--muted-foreground))]">Est. provider cost</p>
                <p className="mt-1 font-mono text-[hsl(var(--foreground))]">${usage.data.estimated_cost.toFixed(2)}</p>
              </div>
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}
