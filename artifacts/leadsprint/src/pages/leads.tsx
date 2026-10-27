import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Download,
  Filter,
  Loader2,
  Phone,
  PhoneCall,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Upload,
  UsersRound,
  X,
} from 'lucide-react';
import {
  getGetAppointmentsQueryKey,
  getGetAuthMeQueryKey,
  getGetCallsQueryKey,
  getGetLeadQueryKey,
  getGetLeadsQueryKey,
  useBookAppointment,
  useGetAuthMe,
  useGetAvailability,
  useGetLead,
  useGetLeads,
  useImportLeads,
  useStartCall,
  useSuppressLead,
  useUpdateLead,
} from '@workspace/api-client-react';
import { parseLeadCsv } from '@/lib/csv';
import {
  Badge,
  Button,
  Checkbox,
  ConsentBadge,
  EmptyState,
  ErrorState,
  Info,
  Input,
  PageHeader,
  Skeleton,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  initials,
  relativeTime,
  scoreTone,
  statusTone,
} from '@/components/common';
import { detailsText, displayValue, isEmergency, isRealEstateProfile, listSummary } from '@/lib/profile';

export function LeadDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const lead = useGetLead(id, { query: { enabled: !!id, queryKey: getGetLeadQueryKey(id) } });
  const update = useUpdateLead();
  const suppress = useSuppressLead();
  const startCall = useStartCall();
  const availability = useGetAvailability();
  const book = useBookAppointment();
  const [bookDate, setBookDate] = useState(new Date().toISOString().slice(0, 10));
  const [message, setMessage] = useState('');
  const data = lead.data;
  const session = useGetAuthMe({ query: { queryKey: getGetAuthMeQueryKey() } });
  const profile = session.data?.profile;
  const realEstate = isRealEstateProfile(profile);

  if (lead.isLoading) {
    return (
      <div className="fixed inset-0 z-50 flex justify-end bg-[hsl(var(--foreground))/0.25] backdrop-blur-sm" onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }}>
        <div className="h-full w-full max-w-[560px] bg-[hsl(var(--card))] border border-[hsl(var(--card-border))] p-6">
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="mt-8 h-40" />
        </div>
      </div>
    );
  }

  if (lead.isError || !data) {
    return (
      <div className="fixed inset-0 z-50 flex justify-end bg-[hsl(var(--foreground))/0.25] backdrop-blur-sm" onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }}>
        <div className="h-full w-full max-w-[560px] bg-[hsl(var(--card))] border border-[hsl(var(--card-border))] p-6">
          <ErrorState retry={() => lead.refetch()} />
          <Button onClick={onClose} data-testid="button-close-lead-error">
            Close
          </Button>
        </div>
      </div>
    );
  }

  const patch = (payload: any, successMessage: string) =>
    update.mutate(
      { id, data: payload },
      {
        onSuccess: (updated) => {
          queryClient.setQueryData(getGetLeadQueryKey(id), updated);
          queryClient.invalidateQueries({ queryKey: getGetLeadsQueryKey() });
          setMessage(successMessage);
        },
      },
    );

  const handleCall = () =>
    startCall.mutate(
      { data: { lead_id: id } },
      {
        onSuccess: () => {
          setMessage('Call queued. Watch Calls for the provider handoff.');
          queryClient.invalidateQueries({ queryKey: getGetCallsQueryKey() });
        },
        onError: (error) => {
          const detail =
            (error as { data?: { error?: string }; message?: string })?.data?.error ||
            (error as { message?: string })?.message ||
            'The call could not be started.';
          setMessage(detail);
          queryClient.invalidateQueries({ queryKey: getGetCallsQueryKey() });
        },
      },
    );

  const checkAvailability = () => availability.mutate({ data: { lead_id: id, date: bookDate } });

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-[hsl(var(--foreground))/0.25] backdrop-blur-sm"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex h-full w-full max-w-[560px] flex-col overflow-hidden bg-[hsl(var(--card))] border-l border-[hsl(var(--card-border))] shadow-[-20px_0_60px_hsl(0_0%_0%_/_0.10)]">
        <div className="flex items-start justify-between border-b border-[hsl(var(--border))] p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[hsl(var(--secondary))] font-mono text-sm font-bold text-[hsl(var(--primary))]">
              {initials(data.name)}
            </div>
            <div>
              <p className="text-lg font-bold tracking-[-.03em] text-[hsl(var(--foreground))]">{data.name}</p>
              <p className="text-xs text-[hsl(var(--muted-foreground))]">
                {data.source} · {data.campaign || 'No campaign'}
              </p>
              {isEmergency(data) && (
                <span className="mt-1.5 inline-block" data-testid="badge-emergency">
                  <Badge className="border-[#fb8c6c]/55 bg-[#fdf4f1] text-[#9a3412]">Emergency</Badge>
                </span>
              )}
            </div>
          </div>
          <button className="rounded-md p-2 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]" onClick={onClose} data-testid="button-close-lead">
            <X size={18} />
          </button>
        </div>

        <div className="scrollbar-subtle flex-1 overflow-y-auto p-6">
          {message && (
            <div className="mb-5 flex items-center gap-2 rounded-lg bg-[hsl(var(--primary))/0.08] px-3 py-2.5 text-xs font-semibold text-[hsl(var(--primary))]">
              <CheckCircle2 size={15} />
              {message}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))/0.5] p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Intent</p>
              <p className="mt-1 font-mono text-xl font-bold text-[hsl(var(--foreground))]">{data.intent_score}</p>
            </div>
            <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))/0.5] p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Score</p>
              <div className="mt-1">
                <Badge className={scoreTone(data.score)}>{data.score}</Badge>
              </div>
            </div>
            <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))/0.5] p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Status</p>
              <div className="mt-1">
                <Badge className={statusTone(data.status)}>{data.status}</Badge>
              </div>
            </div>
            <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))/0.5] p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Last call</p>
              <p className="mt-1 text-xs font-semibold text-[hsl(var(--foreground))]">
                {data.last_call ? relativeTime(data.last_call) : 'Never'}
              </p>
            </div>
          </div>

          <div className="mt-7 flex flex-wrap gap-2">
            <Button variant="primary" onClick={handleCall} disabled={startCall.isPending || data.suppressed} data-testid="button-call-lead">
              <PhoneCall size={15} />
              {startCall.isPending ? 'Queueing…' : 'Call now'}
            </Button>
            <Button
              onClick={() => patch({ status: 'qualified', qualification_status: 'operator_confirmed' }, 'Lead marked qualified.')}
              data-testid="button-qualify-lead"
            >
              <Check size={15} />
              Mark qualified
            </Button>
            <Button
              onClick={() => patch({ status: 'contacted', next_action: 'Follow up with operator' }, 'Follow-up added to next action.')}
              data-testid="button-follow-up"
            >
              <Clock3 size={15} />
              Follow up
            </Button>
            {!data.suppressed && (
              <Button
                variant="danger"
                onClick={() =>
                  suppress.mutate(
                    { id, data: { reason: 'Operator suppression' } },
                    {
                      onSuccess: () => {
                        setMessage('Lead suppressed from future calls.');
                        queryClient.invalidateQueries({ queryKey: getGetLeadsQueryKey() });
                        queryClient.setQueryData(getGetLeadQueryKey(id), (old: any) =>
                          old ? { ...old, suppressed: true, status: 'suppressed' } : old,
                        );
                      },
                    },
                  )
                }
                data-testid="button-suppress-lead"
              >
                <ShieldCheck size={15} />
                Suppress
              </Button>
            )}
          </div>

          <section className="mt-8">
            <h3 className="text-[10px] font-bold uppercase tracking-[.15em] text-[hsl(var(--muted-foreground))]">Lead context</h3>
            <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
              <Info label="Phone" value={data.phone} />
              <Info label="Email" value={data.email || 'Not provided'} />
              {realEstate ? (
                <>
                  <Info label="Property" value={data.property_type} />
                  <Info label="Project" value={data.project} />
                  <Info label="Location" value={data.location} />
                  <Info label="Budget" value={data.budget_label} />
                  <Info label="Timeline" value={data.timeline} />
                </>
              ) : (
                <>
                  {profile!.fields.map((field) =>
                    field.type === 'text' && !field.in_list ? (
                      <div key={field.key} className="col-span-2" data-testid={`field-${field.key}`}>
                        <p className="text-[11px] font-semibold text-[hsl(var(--muted-foreground))]">{field.label}</p>
                        <p className="mt-1 whitespace-pre-wrap break-words font-medium text-[hsl(var(--foreground))]">{displayValue(data, field)}</p>
                      </div>
                    ) : (
                      <div key={field.key} data-testid={`field-${field.key}`}>
                        <Info label={field.label} value={displayValue(data, field)} />
                      </div>
                    ),
                  )}
                  <Info label="Source" value={data.source} />
                </>
              )}
              <Info label="Language" value={data.preferred_language} />
            </div>
          </section>

          {data.consent_evidence && (
            <section className="mt-7" data-testid="consent-evidence">
              <h3 className="text-[10px] font-bold uppercase tracking-[.15em] text-[hsl(var(--muted-foreground))]">Consent wording</h3>
              <p className="mt-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))/0.5] p-3 text-sm leading-6 text-[hsl(var(--foreground))]">{data.consent_evidence}</p>
              <p className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">{data.consent_detail}</p>
            </section>
          )}

          <section className="mt-7 rounded-lg border border-[hsl(var(--border))] p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-[hsl(var(--foreground))]">Verified booking</h3>
                <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Check live availability before offering a slot.</p>
              </div>
              <CalendarDays size={17} className="text-[hsl(var(--primary))]" />
            </div>
            <div className="mt-4 flex gap-2">
              <input
                type="date"
                value={bookDate}
                onChange={(event) => setBookDate(event.target.value)}
                className="min-w-0 flex-1 rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))] focus:ring-1 focus:ring-[hsl(var(--primary))]"
                data-testid="input-availability-date"
              />
              <Button onClick={checkAvailability} disabled={availability.isPending} data-testid="button-check-availability">
                {availability.isPending ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                Check
              </Button>
            </div>
            {availability.data && (
              <div className="mt-3 space-y-2">
                {availability.data.length === 0 ? (
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">No open slots for this date.</p>
                ) : (
                  availability.data.map((slot) => (
                    <button
                      key={slot.start_time}
                      onClick={() =>
                        book.mutate(
                          { data: { lead_id: id, slot_start: slot.start_time, slot_end: slot.end_time } },
                          {
                            onSuccess: () => {
                              setMessage('Appointment booked and verified.');
                              queryClient.invalidateQueries({ queryKey: getGetAppointmentsQueryKey() });
                            },
                          },
                        )
                      }
                      className="flex w-full items-center justify-between rounded-md border border-[hsl(var(--border))] px-3 py-2 text-left text-sm transition hover:border-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))/0.05]"
                      data-testid={`button-book-slot-${slot.start_time}`}
                    >
                      <span>{slot.label}</span>
                      <ChevronRight size={14} className="text-[hsl(var(--muted-foreground))]" />
                    </button>
                  ))
                )}
              </div>
            )}
          </section>

          <section className="mt-6 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))/0.4] p-4">
            <p className="text-[10px] font-bold uppercase tracking-[.15em] text-[hsl(var(--muted-foreground))]">Next action</p>
            <p className="mt-2 text-sm font-semibold text-[hsl(var(--foreground))]">{data.next_action || 'No next action set'}</p>
            <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Qualification: {data.qualification_status || 'Not reviewed'}</p>
          </section>
        </div>
      </div>
    </div>
  );
}

export default function LeadsPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [score, setScore] = useState('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [consentSource, setConsentSource] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [showAddLead, setShowAddLead] = useState(false);
  const [addLeadError, setAddLeadError] = useState<string | null>(null);
  const [addLeadForm, setAddLeadForm] = useState({
    name: '',
    phone: '',
    email: '',
    property_type: 'Condo',
    project: 'Direct enquiry',
    budget_label: '$500k – $800k',
    timeline: 'Immediate (0–3 months)',
    consent_source: 'Direct client phone/walk-in inquiry',
    call_immediately: true,
  });
  const importLeads = useImportLeads();

  const params = useMemo(
    () => ({
      ...(search ? { search } : {}),
      ...(status !== 'all' ? { status: status as any } : {}),
      ...(score !== 'all' ? { score: score as any } : {}),
    }),
    [search, status, score],
  );

  const leads = useGetLeads(params);
  const startCall = useStartCall();
  const queryClient = useQueryClient();
  const session = useGetAuthMe({ query: { queryKey: getGetAuthMeQueryKey() } });
  const profile = session.data?.profile;
  const realEstate = isRealEstateProfile(profile);

  const handleExportCsv = () => {
    if (!leads.data?.length) return;
    const headers = [
      'Name',
      'Phone',
      'Email',
      'Property Type',
      'Project',
      'Budget',
      'Timeline',
      'Score',
      'Intent Score',
      'Status',
      'Consent Status',
      'Consent Source',
      'Next Action',
      'Last Call',
      ...(realEstate ? [] : ['Urgency', 'Details']),
    ];
    const escapeCsv = (val?: string | number | null) => {
      if (val === null || val === undefined) return '""';
      const str = String(val).replaceAll('"', '""');
      return `"${str}"`;
    };
    const rows = leads.data.map((lead) => [
      escapeCsv(lead.name),
      escapeCsv(lead.phone),
      escapeCsv(lead.email),
      escapeCsv(lead.property_type),
      escapeCsv(lead.project),
      escapeCsv(lead.budget_label),
      escapeCsv(lead.timeline),
      escapeCsv(lead.score),
      escapeCsv(lead.intent_score),
      escapeCsv(lead.status),
      escapeCsv(lead.consent_status),
      escapeCsv(lead.consent_source),
      escapeCsv(lead.next_action),
      escapeCsv(lead.last_call),
      ...(realEstate ? [] : [escapeCsv(lead.urgency), escapeCsv(detailsText(lead, profile!))]),
    ]);
    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `leadsprint-leads-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleAddLead = (e: React.FormEvent) => {
    e.preventDefault();
    setAddLeadError(null);
    if (!addLeadForm.name.trim()) {
      setAddLeadError('Please enter a lead name.');
      return;
    }
    if (!addLeadForm.phone.trim()) {
      setAddLeadError('Please enter a valid phone number.');
      return;
    }
    if (!addLeadForm.consent_source.trim()) {
      setAddLeadError('Please record where consent was obtained.');
      return;
    }

    importLeads.mutate(
      {
        data: {
          rows: [
            {
              name: addLeadForm.name.trim(),
              phone: addLeadForm.phone.trim(),
              email: addLeadForm.email.trim() || undefined,
              property_type: addLeadForm.property_type.trim() || undefined,
              project: addLeadForm.project.trim() || undefined,
              budget_label: addLeadForm.budget_label.trim() || undefined,
              timeline: addLeadForm.timeline.trim() || undefined,
              source: 'Manual entry',
            },
          ],
          consent_status: 'valid',
          consent_source: addLeadForm.consent_source.trim(),
        },
      },
      {
        onSuccess: (res: any) => {
          setShowAddLead(false);
          queryClient.invalidateQueries({ queryKey: getGetLeadsQueryKey() });
          const newLead = res?.leads?.[0];
          if (addLeadForm.call_immediately && newLead?.id) {
            startCall.mutate(
              { data: { lead_id: newLead.id } },
              {
                onSuccess: () => {
                  queryClient.invalidateQueries({ queryKey: getGetCallsQueryKey() });
                },
              },
            );
          }
          setAddLeadForm({
            name: '',
            phone: '',
            email: '',
            property_type: 'Condo',
            project: 'Direct enquiry',
            budget_label: '$500k – $800k',
            timeline: 'Immediate (0–3 months)',
            consent_source: 'Direct client phone/walk-in inquiry',
            call_immediately: true,
          });
        },
        onError: (err: any) => {
          setAddLeadError(err?.message || 'Failed to save lead. Please check details.');
        },
      },
    );
  };

  const handleImport = (event: any) => {
    const file = event.target.files?.[0] as File | undefined;
    if (!file) return;
    setImportError(null);
    setImportNotice(null);

    if (!consentSource.trim()) {
      setImportError('Enter where consent for these leads was captured before importing.');
      event.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseLeadCsv(String(reader.result || ''));
      if (parsed.error) {
        setImportError(parsed.error);
        return;
      }
      if (!parsed.rows.length) {
        setImportError('No rows in that file had both a name and a phone number.');
        return;
      }
      if (parsed.skipped) {
        setImportNotice(`${parsed.skipped} row${parsed.skipped === 1 ? '' : 's'} skipped for a missing name or phone number.`);
      }
      importLeads.mutate(
        { data: { rows: parsed.rows as any, consent_status: 'valid', consent_source: consentSource.trim() } },
        {
          onSuccess: () => {
            setShowImport(false);
            setConsentSource('');
            queryClient.invalidateQueries({ queryKey: getGetLeadsQueryKey() });
          },
        },
      );
    };
    reader.readAsText(file);
  };

  const visibleCount = leads.data?.length ?? 0;

  return (
    <div className="animate-rise-in space-y-5">
      <PageHeader
        eyebrow="Console"
        title="Leads"
        description="Find the next best conversation."
        action={
          <Button variant="primary" onClick={() => setShowAddLead(true)} data-testid="button-open-add-lead">
            <Plus size={15} />
            Add Lead
          </Button>
        }
      />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2 text-sm text-[hsl(var(--muted-foreground))]">
          <span className="font-mono text-[hsl(var(--foreground))]">{visibleCount}</span> visible leads
          <span className="text-[hsl(var(--border))]">/</span> sorted by latest signal
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setShowImport(true)} data-testid="button-open-import">
            <Upload size={15} />
            Import CSV
          </Button>
          <Button
            onClick={handleExportCsv}
            disabled={!leads.data?.length}
            data-testid="button-export-leads"
            title="Download visible leads as CSV"
          >
            <Download size={15} />
            Export CSV
          </Button>
          <Link
            href="/workspace/leads"
            data-testid="link-refresh-leads"
            className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-sm font-semibold hover:bg-[hsl(var(--muted))]"
          >
            <RefreshCw size={15} />
            Refresh
          </Link>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3 top-[50%] -translate-y-[50%] text-[hsl(var(--muted-foreground))]" size={17} />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name, phone, project…"
            className="w-full pl-9"
            data-testid="input-search-leads"
          />
        </div>
        <div className="flex gap-2">
          <Select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            data-testid="select-lead-status"
          >
            <option value="all">All statuses</option>
            <option value="new">New</option>
            <option value="contacted">Contacted</option>
            <option value="qualified">Qualified</option>
            <option value="booked">Booked</option>
            <option value="suppressed">Suppressed</option>
          </Select>
          <Select
            value={score}
            onChange={(event) => setScore(event.target.value)}
            data-testid="select-lead-score"
          >
            <option value="all">All scores</option>
            <option value="hot">Hot</option>
            <option value="warm">Warm</option>
            <option value="cold">Cold</option>
          </Select>
          <Button variant="quiet" size="icon" className="px-0" data-testid="button-filter-leads" aria-label="Filters">
            <Filter size={16} />
          </Button>
        </div>
      </div>

      {leads.isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <Skeleton key={n} className="h-10 w-full" />
          ))}
        </div>
      ) : leads.isError ? (
        <ErrorState retry={() => leads.refetch()} />
      ) : !leads.data?.length ? (
        <EmptyState
          icon={UsersRound}
          title="No leads match that view"
          description="Try clearing a filter or import a normalized CSV to start the desk."
          action={
            <Button
              onClick={() => {
                setSearch('');
                setStatus('all');
                setScore('all');
              }}
              data-testid="button-clear-lead-filters"
            >
              Clear filters
            </Button>
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[260px]">Lead</TableHead>
              <TableHead>Intent &amp; score</TableHead>
              <TableHead className="text-right">Next action</TableHead>
              <TableHead className="text-right">Last call</TableHead>
              <TableHead className="text-right w-12">Status</TableHead>
              <TableHead className="w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {leads.data.map((lead) => (
              <TableRow key={lead.id} data-testid={`row-lead-${lead.id}`}>
                <TableCell className="w-[260px]">
                  <button
                    className="flex min-w-0 items-center gap-3 text-left"
                    onClick={() => setSelected(lead.id)}
                    data-testid={`button-open-lead-${lead.id}`}
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--secondary))] font-mono text-[11px] font-bold text-[hsl(var(--primary))]">
                      {initials(lead.name)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-bold text-[hsl(var(--foreground))]">{lead.name}</span>
                      <span className="mt-0.5 block truncate text-xs text-[hsl(var(--muted-foreground))]">
                        {lead.phone} · {lead.project}
                      </span>
                    </span>
                  </button>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-2">
                    {isEmergency(lead) && <Badge className="border-[#fb8c6c]/55 bg-[#fdf4f1] text-[#9a3412]">Emergency</Badge>}
                    <Badge className={scoreTone(lead.score)}>{lead.score}</Badge>
                    <span className="font-mono text-xs text-[hsl(var(--muted-foreground))]">{lead.intent_score}/100</span>
                    {lead.consent_status !== 'valid' && (
                      <ConsentBadge status={lead.consent_status} unknownLabel={realEstate ? undefined : 'Needs consent'} />
                    )}
                  </div>
                  {realEstate ? (
                    <div className="mt-1.5">
                      <p className="text-sm font-medium text-[hsl(var(--foreground))]">{lead.property_type}</p>
                      <p className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">
                        {lead.budget_label} · {lead.timeline}
                      </p>
                    </div>
                  ) : (
                    <div className="mt-1.5">
                      <p className="text-sm font-medium text-[hsl(var(--foreground))]">{listSummary(lead, profile!).primary}</p>
                      <p className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">{listSummary(lead, profile!).secondary}</p>
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <p className="text-sm font-medium text-[hsl(var(--foreground))]">{lead.next_action || 'Review lead'}</p>
                  <p className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">
                    {relativeTime(lead.last_call || lead.created_at)}
                  </p>
                </TableCell>
                <TableCell className="text-right w-12">
                  <p className="text-xs font-mono text-[hsl(var(--muted-foreground))] text-right">{lead.status}</p>
                </TableCell>
                <TableCell className="w-16 text-right">
                  <button
                    onClick={() =>
                      startCall.mutate(
                        { data: { lead_id: lead.id } },
                        { onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetCallsQueryKey() }) },
                      )
                    }
                    disabled={!lead.callable || startCall.isPending}
                    className="rounded-md p-2 text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))/0.08] disabled:opacity-40"
                    title={lead.callable ? 'Call now' : lead.consent_detail || 'This lead cannot be called'}
                    data-testid={`button-call-row-${lead.id}`}
                  >
                    <Phone size={16} />
                  </button>
                  <button
                    onClick={() => setSelected(lead.id)}
                    className="rounded-md p-2 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
                    title="Open details"
                    data-testid={`button-details-row-${lead.id}`}
                  >
                    <ChevronRight size={16} />
                  </button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {selected && <LeadDetail id={selected} onClose={() => setSelected(null)} />}

      {showImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[hsl(var(--foreground))/0.25] backdrop-blur-sm p-5" onKeyDown={(event) => { if (event.key === 'Escape') setShowImport(false); }}>
          <div className="w-full max-w-[460px] rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-bold text-[hsl(var(--foreground))]">Import lead rows</h2>
                <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
                  Use a CSV with name and phone columns. Quoted commas are handled.
                </p>
              </div>
              <button onClick={() => setShowImport(false)} data-testid="button-close-import">
                <X size={18} />
              </button>
            </div>
            <label className="mt-6 block text-sm font-semibold text-[hsl(var(--foreground))]">
              Where was consent captured?
              <Input
                value={consentSource}
                onChange={(event) => {
                  setConsentSource(event.target.value);
                  setImportError(null);
                }}
                placeholder="e.g. Website enquiry form, 12 Sep 2026"
                className="mt-2 w-full"
                data-testid="input-consent-source"
              />
              <span className="mt-1.5 block text-xs text-[hsl(var(--muted-foreground))]">
                Required. Leads imported without recorded consent evidence are never called.
              </span>
            </label>
            <label className="mt-5 flex cursor-pointer flex-col items-center rounded-lg border border-dashed border-[hsl(var(--primary))/0.5] bg-[hsl(var(--primary))/0.05] p-8 text-center hover:bg-[hsl(var(--primary))/0.10]">
              <Upload className="text-[hsl(var(--primary))]" size={22} />
              <span className="mt-3 text-sm font-semibold text-[hsl(var(--foreground))]">Choose CSV file</span>
              <span className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Rows are normalized before import.</span>
              <input type="file" accept=".csv,text/csv" onChange={handleImport} className="hidden" data-testid="input-import-csv" />
            </label>
            {importLeads.isPending && <p className="mt-3 text-xs text-[hsl(var(--muted-foreground))]">Importing rows…</p>}
            {importNotice && (
              <p className="mt-3 text-xs text-[hsl(var(--muted-foreground))]" data-testid="text-import-notice">
                {importNotice}
              </p>
            )}
            {(importError || importLeads.isError) && (
              <p className="mt-3 text-xs text-[hsl(var(--destructive))]" data-testid="text-import-error">
                {importError || 'Import failed. Check the required columns and try again.'}
              </p>
            )}
            <Button variant="quiet" className="mt-5 w-full" onClick={() => setShowImport(false)} data-testid="button-cancel-import">
              Cancel
            </Button>
          </div>
        </div>
      )}

      {showAddLead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[hsl(var(--foreground))/0.25] backdrop-blur-sm p-5" onKeyDown={(event) => { if (event.key === 'Escape') setShowAddLead(false); }}>
          <div className="w-full max-w-[520px] rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6">
            <div className="flex items-start justify-between border-b border-[hsl(var(--border))] pb-4">
              <div>
                <h2 className="text-lg font-bold text-[hsl(var(--foreground))]">Add New Lead</h2>
                <p className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">
                  Quickly register an inbound lead and optionally trigger an instant AI qualification call.
                </p>
              </div>
              <button onClick={() => setShowAddLead(false)} data-testid="button-close-add-lead">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleAddLead} className="mt-5 space-y-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-[hsl(var(--muted-foreground))]">Full Name <span className="text-[hsl(var(--destructive))]">*</span></label>
                  <Input
                    required
                    value={addLeadForm.name}
                    onChange={(e) => setAddLeadForm((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="e.g. Michael Scott"
                    className="w-full"
                    data-testid="input-add-lead-name"
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-[hsl(var(--muted-foreground))]">Phone Number <span className="text-[hsl(var(--destructive))]">*</span></label>
                  <Input
                    required
                    value={addLeadForm.phone}
                    onChange={(e) => setAddLeadForm((prev) => ({ ...prev, phone: e.target.value }))}
                    placeholder="+19175550188"
                    className="w-full"
                    data-testid="input-add-lead-phone"
                  />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-[hsl(var(--muted-foreground))]">Email (Optional)</label>
                  <Input
                    type="email"
                    value={addLeadForm.email}
                    onChange={(e) => setAddLeadForm((prev) => ({ ...prev, email: e.target.value }))}
                    placeholder="client@example.com"
                    className="w-full"
                    data-testid="input-add-lead-email"
                  />
                </div>
                {realEstate && (
                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-[hsl(var(--muted-foreground))]">Property Type</label>
                    <Input
                      value={addLeadForm.property_type}
                      onChange={(e) => setAddLeadForm((prev) => ({ ...prev, property_type: e.target.value }))}
                      placeholder="Condo, Single Family, etc."
                      className="w-full"
                      data-testid="input-add-lead-property-type"
                    />
                  </div>
                )}
              </div>
              {realEstate && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-[hsl(var(--muted-foreground))]">Target Budget</label>
                    <Input
                      value={addLeadForm.budget_label}
                      onChange={(e) => setAddLeadForm((prev) => ({ ...prev, budget_label: e.target.value }))}
                      placeholder="$600k – $900k"
                      className="w-full"
                      data-testid="input-add-lead-budget"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-[hsl(var(--muted-foreground))]">Timeline</label>
                    <Input
                      value={addLeadForm.timeline}
                      onChange={(e) => setAddLeadForm((prev) => ({ ...prev, timeline: e.target.value }))}
                      placeholder="1–3 months"
                      className="w-full"
                      data-testid="input-add-lead-timeline"
                    />
                  </div>
                </div>
              )}
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-[hsl(var(--muted-foreground))]">Consent Evidence Source <span className="text-[hsl(var(--destructive))]">*</span></label>
                <Input
                  required
                  value={addLeadForm.consent_source}
                  onChange={(e) => setAddLeadForm((prev) => ({ ...prev, consent_source: e.target.value }))}
                  placeholder="e.g. Phone inquiry, Open House walk-in"
                  className="w-full"
                  data-testid="input-add-lead-consent-source"
                />
                <span className="text-[11px] text-[hsl(var(--muted-foreground))]">
                  TCPA compliance requirement: records why this contact may be dialed.
                </span>
              </div>
              <label className="flex items-center gap-2.5 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))/0.4] p-3 cursor-pointer">
                <Checkbox
                  checked={addLeadForm.call_immediately}
                  onChange={(checked) => setAddLeadForm((prev) => ({ ...prev, call_immediately: checked }))}
                  data-testid="checkbox-add-lead-call-now"
                />
                <div>
                  <span className="block text-xs font-semibold text-[hsl(var(--foreground))]">Call lead immediately</span>
                  <span className="block text-[11px] text-[hsl(var(--muted-foreground))]">
                    Queues and starts the AI qualification call as soon as the lead is saved.
                  </span>
                </div>
              </label>

              {addLeadError && (
                <p className="text-xs text-[hsl(var(--destructive))]" data-testid="text-add-lead-error">
                  {addLeadError}
                </p>
              )}

              <div className="flex gap-2 pt-2">
                <Button
                  variant="primary"
                  type="submit"
                  disabled={importLeads.isPending}
                  className="flex-1"
                  data-testid="button-submit-add-lead"
                >
                  {importLeads.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                  {importLeads.isPending ? 'Saving Lead…' : 'Save Lead'}
                </Button>
                <Button
                  variant="quiet"
                  type="button"
                  onClick={() => setShowAddLead(false)}
                  data-testid="button-cancel-add-lead"
                >
                  Cancel
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
