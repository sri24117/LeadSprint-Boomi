import { Link } from 'wouter';
import { CalendarDays, ChevronRight } from 'lucide-react';
import { useGetAppointments } from '@workspace/api-client-react';
import {
  Badge,
  EmptyState,
  ErrorState,
  Info,
  Skeleton,
  formatDate,
  formatTime,
  statusTone,
} from '@/components/common';

export default function AppointmentsPage() {
  const appointments = useGetAppointments();

  if (appointments.isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((n) => (
          <Skeleton key={n} className="h-24" />
        ))}
      </div>
    );
  }

  if (appointments.isError) {
    return <ErrorState retry={() => appointments.refetch()} />;
  }

  return (
    <div className="animate-rise-in space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">Every row below has a source lead and a calendar confirmation.</p>
      </div>

      {!appointments.data?.length ? (
        <EmptyState
          icon={CalendarDays}
          title="No verified appointments yet"
          description="Once a lead books through the approved calendar, it will be visible here."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {appointments.data.map((appointment) => (
            <div
              key={appointment.id}
              className="rounded-xl border border-border bg-[hsl(var(--card))] p-5 transition hover:-translate-y-0.5 hover:shadow-[0_8px_24px_hsl(209_43%_22%/.08)]"
              data-testid={`card-appointment-${appointment.id}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[hsl(var(--accent)/.11)] font-mono text-xs font-bold text-[hsl(var(--accent))]">
                    {formatTime(appointment.start_time)}
                  </div>
                  <div>
                    <h3 className="font-bold">{appointment.lead_name}</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">{appointment.service_or_property}</p>
                  </div>
                </div>
                <Badge className={statusTone(appointment.status)}>{appointment.status}</Badge>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-y-3 border-t border-border pt-4 text-sm">
                <Info label="Date" value={formatDate(appointment.start_time)} />
                <Info label="Timezone" value={appointment.timezone} />
                <Info label="Calendar" value={appointment.calendar_provider} />
                <Info label="External ID" value={appointment.external_id} />
              </div>

              <Link
                href="/workspace/leads"
                className="mt-5 inline-flex items-center gap-1 text-xs font-bold text-[hsl(var(--accent))]"
                data-testid={`link-source-lead-${appointment.id}`}
              >
                Open source lead <ChevronRight size={13} />
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
