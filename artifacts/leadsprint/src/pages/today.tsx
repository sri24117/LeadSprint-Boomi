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
  Button,
  EmptyState,
  ErrorState,
  MetricCard,
  PageHeader,
  Section,
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
      <div className="space-y-5">
        <PageHeader
          eyebrow="Console"
          title="Dashboard"
          description="Loading your desk view…"
        />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <MetricCard
              key={n}
              label="—"
              value="—"
              detail="—"
              icon={UsersRound}
            />
          ))}
        </div>
      </div>
    );
  }

  if (today.isError || !today.data) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow="Console" title="Dashboard" />
        <ErrorState retry={() => today.refetch()} />
      </div>
    );
  }

  const { metrics, setup_warnings, upcoming, recent_activity } = today.data;
  const events = activity.data?.length ? activity.data : recent_activity;

  return (
    <div className="animate-rise-in space-y-7">
      <PageHeader
        eyebrow="Console"
        title="Good morning. Here’s where the desk stands."
        description={today.data.date_label}
        action={
          <Link
            href="/workspace/leads"
            data-testid="link-review-leads"
            className="inline-flex items-center gap-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3.5 py-2.5 text-sm font-bold hover:bg-[hsl(var(--muted))]"
          >
            Review new leads <ChevronRight size={15} />
          </Link>
        }
      />

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
        <Section
          title="Setup checks before you dial"
          description="Open settings to clear these items."
          action={
            <Link
              href="/workspace/business-settings"
              className="text-xs font-bold text-[hsl(var(--primary))] hover:underline"
              data-testid="link-fix-settings"
            >
              Open settings <ArrowUpRight size={13} className="ml-1 inline" />
            </Link>
          }
        >
          <div className="grid gap-2 sm:grid-cols-2">
            {setup_warnings.map((warning) => (
              <div key={warning} className="flex items-start gap-2.5 text-sm text-[hsl(var(--muted-foreground))]">
                <span className="mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full bg-[hsl(var(--muted-foreground))]" />
                {warning}
              </div>
            ))}
          </div>
        </Section>
      )}

      <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <Section
          title="Upcoming handoffs"
          description="Confirmed meetings on the calendar"
          action={
            <Link
              href="/workspace/appointments"
              className="text-xs font-bold text-[hsl(var(--primary))] hover:underline"
              data-testid="link-all-appointments"
            >
              View all
            </Link>
          }
        >
          {upcoming.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title="No appointments on deck"
              description="Verified bookings will appear here once a lead chooses a slot."
            />
          ) : (
            <div className="divide-y divide-[hsl(var(--border))]">
              {upcoming.slice(0, 5).map((appointment) => (
                <div key={appointment.id} className="flex items-center gap-3 px-4 py-3.5">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[hsl(var(--muted))] font-mono text-xs text-[hsl(var(--primary))]">
                    {formatTime(appointment.start_time)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-[hsl(var(--foreground))]">
                      {appointment.lead_name}
                    </p>
                    <p className="truncate text-xs text-[hsl(var(--muted-foreground))]">
                      {appointment.service_or_property} · {appointment.calendar_provider}
                    </p>
                  </div>
                  <Badge className={statusTone(appointment.status)}>
                    {appointment.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section
          title="Recent activity"
          description="The last few desk movements"
        >
          {!events?.length ? (
            <EmptyState
              icon={ActivityIcon}
              title="The desk is quiet"
              description="Lead, call, booking, and import events will land here."
            />
          ) : (
            <div className="divide-y divide-[hsl(var(--border))]">
              {events.slice(0, 6).map((event) => (
                <div key={event.id} className="flex gap-3 px-4 py-3.5">
                  <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--muted))] text-[hsl(var(--primary))]">
                    <CircleDot size={12} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[hsl(var(--foreground))]">
                      {event.title}
                    </p>
                    <p className="mt-0.5 text-xs leading-5 text-[hsl(var(--muted-foreground))]">
                      {event.detail}
                    </p>
                    <p className="mt-1 font-mono text-[10px] text-[hsl(var(--muted-foreground))]">
                      {relativeTime(event.created_at)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
