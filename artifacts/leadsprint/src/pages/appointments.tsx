import { Link } from 'wouter';
import { CalendarDays, ChevronRight } from 'lucide-react';
import { useGetAppointments } from '@workspace/api-client-react';
import {
  Badge,
  EmptyState,
  ErrorState,
  PageHeader,
  Section,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  formatDate,
  formatTime,
  statusTone,
} from '@/components/common';

export default function AppointmentsPage() {
  const appointments = useGetAppointments();

  if (appointments.isLoading) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow="Console" title="Appointments" />
        {[1, 2, 3].map((n) => (
          <Skeleton key={n} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (appointments.isError) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow="Console" title="Appointments" />
        <ErrorState retry={() => appointments.refetch()} />
      </div>
    );
  }

  return (
    <div className="animate-rise-in space-y-6">
      <PageHeader
        eyebrow="Console"
        title="Appointments"
        description="Verified meetings, ready for the team."
      />
      <p className="text-sm text-[hsl(var(--muted-foreground))]">
        Every row below has a source lead and a calendar confirmation.
      </p>

      {!appointments.data?.length ? (
        <EmptyState
          icon={CalendarDays}
          title="No verified appointments yet"
          description="Once a lead books through the approved calendar, it will be visible here."
        />
      ) : (
        <Section>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[30%]">Lead &amp; property</TableHead>
                <TableHead className="w-[17%] text-right">Date &amp; time</TableHead>
                <TableHead className="w-[14%]">Timezone</TableHead>
                <TableHead className="w-[16%]">Calendar</TableHead>
                <TableHead className="w-[13%]">External ID</TableHead>
                <TableHead className="w-[10%] text-right">Status</TableHead>
                <TableHead className="w-[12%] text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {appointments.data.map((appointment) => (
                <TableRow key={appointment.id} data-testid={`row-appointment-${appointment.id}`}>
                  <TableCell className="w-[30%]">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[hsl(var(--primary))/0.10] font-mono text-xs font-bold text-[hsl(var(--primary))]">
                        {formatTime(appointment.start_time)}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[hsl(var(--foreground))]">
                          {appointment.lead_name}
                        </p>
                        <p className="truncate text-xs text-[hsl(var(--muted-foreground))]">
                          {appointment.service_or_property}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="w-[17%] text-right">
                    <p className="text-sm font-semibold text-[hsl(var(--foreground))] font-mono">
                      {formatDate(appointment.start_time)}
                    </p>
                  </TableCell>
                  <TableCell className="w-[14%]">
                    <p className="text-sm text-[hsl(var(--muted-foreground))] font-mono">
                      {appointment.timezone}
                    </p>
                  </TableCell>
                  <TableCell className="w-[16%]">
                    <p className="text-sm text-[hsl(var(--muted-foreground))]">
                      {appointment.calendar_provider}
                    </p>
                  </TableCell>
                  <TableCell className="w-[13%]">
                    <p className="text-xs font-mono text-[hsl(var(--muted-foreground))] truncate max-w-xs">
                      {appointment.external_id}
                    </p>
                  </TableCell>
                  <TableCell className="w-[10%] text-right">
                    <Badge className={statusTone(appointment.status)}>
                      {appointment.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="w-[12%] text-right">
                    <Link
                      href="/workspace/leads"
                      className="text-xs font-bold text-[hsl(var(--primary))] hover:underline"
                      data-testid={`link-source-lead-${appointment.id}`}
                    >
                      Open source lead <ChevronRight size={13} />
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      )}
    </div>
  );
}
