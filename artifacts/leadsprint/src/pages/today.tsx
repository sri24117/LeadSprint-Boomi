import { Link } from 'wouter';
import {
  Activity as ActivityIcon,
  AlertTriangle,
  CalendarDays,
  ChevronRight,
  CircleDot,
  Flame,
  MessageSquare,
  PhoneCall,
  ShieldCheck,
  UsersRound,
} from 'lucide-react';
import { useGetActivity, useGetToday } from '@workspace/api-client-react';
import {
  Badge,
  EmptyState,
  ErrorState,
  MetricCard,
  Skeleton,
  formatTime,
  relativeTime,
  statusTone,
} from '@/components/common';
import { SetupChecklist } from '@/components/setup-checklist';
import { ArrowUpRight } from 'lucide-react';

export default function TodayPage() {
  const today = useGetToday();
  const activity = useGetActivity({ limit: 8 });

  if (today.isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-16 w-3/4" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <Skeleton key={n} className="h-32" />
          ))}
        </div>
      </div>
    );
  }

  if (today.isError || !today.data) {
    return <ErrorState retry={() => today.refetch()} />;
  }

  const { metrics, setup_warnings, upcoming, recent_activity } = today.data;
  const events = activity.data?.length ? activity.data : recent_activity;

  return (
    <div className="animate-rise-in space-y-7">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm text-muted-foreground">{today.data.date_label}</p>
          <h2 className="mt-1 max-w-xl text-2xl font-bold tracking-[-.045em] sm:text-3xl">
            Good morning. Here’s where the desk stands.
          </h2>
        </div>
        <Link
          href="/workspace/leads"
          data-testid="link-review-leads"
          className="inline-flex items-center gap-2 self-start rounded-lg bg-[hsl(var(--secondary))] px-3.5 py-2.5 text-sm font-bold text-[hsl(var(--secondary-foreground))] transition hover:brightness-105 sm:self-auto"
        >
          Review new leads <ChevronRight size={16} />
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <MetricCard
          label="New leads"
          value={metrics.new_leads}
          detail="awaiting a first touch"
          icon={UsersRound}
          tone="warm"
          href="/workspace/leads"
        />
        <MetricCard
          label="Calls in progress"
          value={metrics.calls_in_progress}
          detail="live right now"
          icon={PhoneCall}
          tone="good"
          href="/workspace/calls"
        />
        <MetricCard
          label="Hot leads"
          value={metrics.hot_leads}
          detail="high intent signals"
          icon={Flame}
          tone="warm"
          href="/workspace/leads"
        />
        <MetricCard
          label="Appointments today"
          value={metrics.appointments_today}
          detail="verified meetings"
          icon={CalendarDays}
          tone="good"
          href="/workspace/appointments"
        />
        <MetricCard
          label="Failed calls"
          value={metrics.failed_calls}
          detail="need an operator look"
          icon={AlertTriangle}
          tone={metrics.failed_calls ? 'alert' : 'default'}
          href="/workspace/calls"
        />
        <MetricCard
          label="Unresolved messages"
          value={metrics.unresolved_messages}
          detail="waiting on a reply"
          icon={MessageSquare}
          tone={metrics.unresolved_messages ? 'warm' : 'default'}
        />
      </div>

      <SetupChecklist />

      {setup_warnings.length > 0 && (
        <section className="rounded-xl border border-[hsl(var(--secondary)/.55)] bg-[hsl(var(--secondary)/.14)] p-5">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-[hsl(var(--secondary)/.45)] p-2 text-[hsl(var(--primary))]">
              <ShieldCheck size={18} />
            </div>
            <div className="flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-bold">Setup checks before you dial</h3>
                <Link
                  href="/workspace/business-settings"
                  className="text-xs font-bold text-[hsl(var(--accent))] hover:underline"
                  data-testid="link-fix-settings"
                >
                  Open settings <ArrowUpRight size={13} className="ml-1 inline" />
                </Link>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {setup_warnings.map((warning) => (
                  <div key={warning} className="flex items-start gap-2 text-sm text-[hsl(var(--foreground)/.78)]">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[hsl(var(--secondary-foreground))]" />
                    {warning}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      <div className="grid gap-5 xl:grid-cols-[1.15fr_.85fr]">
        <section className="rounded-xl border border-border bg-[hsl(var(--card))]">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div>
              <h3 className="font-bold">Upcoming handoffs</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">Confirmed meetings on the calendar</p>
            </div>
            <Link
              href="/workspace/appointments"
              className="text-xs font-bold text-[hsl(var(--accent))]"
              data-testid="link-all-appointments"
            >
              View all
            </Link>
          </div>
          {upcoming.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title="No appointments on deck"
              description="Verified bookings will appear here once a lead chooses a slot."
            />
          ) : (
            <div className="divide-y divide-border">
              {upcoming.slice(0, 5).map((appointment) => (
                <div key={appointment.id} className="flex items-center gap-3 px-5 py-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--muted))] font-mono text-xs text-[hsl(var(--primary))]">
                    {formatTime(appointment.start_time)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{appointment.lead_name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {appointment.service_or_property} · {appointment.calendar_provider}
                    </p>
                  </div>
                  <Badge className={statusTone(appointment.status)}>{appointment.status}</Badge>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-border bg-[hsl(var(--card))]">
          <div className="border-b border-border px-5 py-4">
            <h3 className="font-bold">Recent activity</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">The last few desk movements</p>
          </div>
          {!events?.length ? (
            <EmptyState
              icon={ActivityIcon}
              title="The desk is quiet"
              description="Lead, call, booking, and import events will land here."
            />
          ) : (
            <div className="divide-y divide-border">
              {events.slice(0, 6).map((event) => (
                <div key={event.id} className="flex gap-3 px-5 py-4">
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--muted))] text-[hsl(var(--accent))]">
                    <CircleDot size={13} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{event.title}</p>
                    <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{event.detail}</p>
                    <p className="mt-1 font-mono text-[10px] text-muted-foreground">{relativeTime(event.created_at)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
