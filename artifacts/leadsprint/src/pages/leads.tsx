import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Filter,
  Loader2,
  Phone,
  PhoneCall,
  RefreshCw,
  Search,
  ShieldCheck,
  Upload,
  UsersRound,
  X,
} from 'lucide-react';
import {
  getGetAppointmentsQueryKey,
  getGetCallsQueryKey,
  getGetLeadQueryKey,
  getGetLeadsQueryKey,
  useBookAppointment,
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
  ConsentBadge,
  EmptyState,
  ErrorState,
  Info,
  Skeleton,
  initials,
  relativeTime,
  scoreTone,
  statusTone,
} from '@/components/common';

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

  if (lead.isLoading) {
    return (
      <div className="fixed inset-0 z-40 flex justify-end bg-[#102632]/30">
        <div className="h-full w-full max-w-[540px] bg-[hsl(var(--card))] p-6">
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="mt-8 h-40" />
        </div>
      </div>
    );
  }

  if (lead.isError || !data) {
    return (
      <div className="fixed inset-0 z-40 flex justify-end bg-[#102632]/30">
        <div className="h-full w-full max-w-[540px] bg-[hsl(var(--card))] p-6">
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
      },
    );

  const checkAvailability = () => availability.mutate({ data: { lead_id: id, date: bookDate } });

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-[#102632]/30"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex h-full w-full max-w-[560px] flex-col overflow-hidden bg-[hsl(var(--card))] shadow-[-20px_0_60px_hsl(209_43%_22%/.16)]">
        <div className="flex items-start justify-between border-b border-border p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[hsl(var(--secondary)/.45)] font-mono text-sm font-bold text-[hsl(var(--primary))]">
              {initials(data.name)}
            </div>
            <div>
              <p className="text-lg font-bold tracking-[-.03em]">{data.name}</p>
              <p className="text-xs text-muted-foreground">
                {data.source} · {data.campaign || 'No campaign'}
              </p>
            </div>
          </div>
          <button className="rounded-lg p-2 text-muted-foreground hover:bg-[hsl(var(--muted))]" onClick={onClose} data-testid="button-close-lead">
            <X size={18} />
          </button>
        </div>

        <div className="scrollbar-subtle flex-1 overflow-y-auto p-6">
          {message && (
            <div className="mb-5 flex items-center gap-2 rounded-lg bg-[hsl(var(--accent)/.1)] px-3 py-2.5 text-xs font-semibold text-[hsl(var(--accent))]">
              <CheckCircle2 size={15} />
              {message}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg bg-[hsl(var(--muted)/.65)] p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Intent</p>
              <p className="mt-1 font-mono text-xl font-bold">{data.intent_score}</p>
            </div>
            <div className="rounded-lg bg-[hsl(var(--muted)/.65)] p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Score</p>
              <div className="mt-1">
                <Badge className={scoreTone(data.score)}>{data.score}</Badge>
              </div>
            </div>
            <div className="rounded-lg bg-[hsl(var(--muted)/.65)] p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Status</p>
              <div className="mt-1">
                <Badge className={statusTone(data.status)}>{data.status}</Badge>
              </div>
            </div>
            <div className="rounded-lg bg-[hsl(var(--muted)/.65)] p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Last call</p>
              <p className="mt-1 text-xs font-semibold">{data.last_call ? relativeTime(data.last_call) : 'Never'}</p>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
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

          <section className="mt-7">
            <h3 className="text-xs font-bold uppercase tracking-[.15em] text-muted-foreground">Lead context</h3>
            <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
              <Info label="Phone" value={data.phone} />
              <Info label="Email" value={data.email || 'Not provided'} />
              <Info label="Property" value={data.property_type} />
              <Info label="Project" value={data.project} />
              <Info label="Location" value={data.location} />
              <Info label="Budget" value={data.budget_label} />
              <Info label="Timeline" value={data.timeline} />
              <Info label="Language" value={data.preferred_language} />
            </div>
          </section>

          <section className="mt-7 rounded-xl border border-border p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold">Verified booking</h3>
                <p className="mt-1 text-xs text-muted-foreground">Check live availability before offering a slot.</p>
              </div>
              <CalendarDays size={18} className="text-[hsl(var(--accent))]" />
            </div>
            <div className="mt-4 flex gap-2">
              <input
                type="date"
                value={bookDate}
                onChange={(event) => setBookDate(event.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm"
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
                  <p className="text-xs text-muted-foreground">No open slots for this date.</p>
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
                      className="flex w-full items-center justify-between rounded-lg border border-border px-3 py-2 text-left text-sm transition hover:border-[hsl(var(--accent))] hover:bg-[hsl(var(--accent)/.06)]"
                      data-testid={`button-book-slot-${slot.start_time}`}
                    >
                      <span>{slot.label}</span>
                      <ChevronRight size={14} className="text-muted-foreground" />
                    </button>
                  ))
                )}
              </div>
            )}
          </section>

          <section className="mt-6 rounded-xl bg-[hsl(var(--muted)/.55)] p-4">
            <p className="text-[10px] font-bold uppercase tracking-[.15em] text-muted-foreground">Next action</p>
            <p className="mt-2 text-sm font-semibold">{data.next_action || 'No next action set'}</p>
            <p className="mt-1 text-xs text-muted-foreground">Qualification: {data.qualification_status || 'Not reviewed'}</p>
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

  return (
    <div className="animate-rise-in space-y-5">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <p className="text-sm text-muted-foreground">A lead is a conversation waiting for context.</p>
          <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono text-foreground">{leads.data?.length ?? '—'}</span> visible leads{' '}
            <span className="text-border">/</span> sorted by latest signal
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setShowImport(true)} data-testid="button-open-import">
            <Upload size={15} />
            Import CSV
          </Button>
          <Link
            href="/workspace/leads"
            data-testid="link-refresh-leads"
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-[hsl(var(--card))] px-3 py-2 text-sm font-semibold hover:bg-[hsl(var(--muted))]"
          >
            <RefreshCw size={15} />
            Refresh
          </Link>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-border bg-[hsl(var(--card))] p-3 md:flex-row">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3 top-2.5 text-muted-foreground" size={17} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name, phone, project…"
            className="w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-sm outline-none focus:border-[hsl(var(--accent))]"
            data-testid="input-search-leads"
          />
        </div>
        <div className="flex gap-2">
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="rounded-lg border border-input bg-background px-3 py-2 text-sm"
            data-testid="select-lead-status"
          >
            <option value="all">All statuses</option>
            <option value="new">New</option>
            <option value="contacted">Contacted</option>
            <option value="qualified">Qualified</option>
            <option value="booked">Booked</option>
            <option value="suppressed">Suppressed</option>
          </select>
          <select
            value={score}
            onChange={(event) => setScore(event.target.value)}
            className="rounded-lg border border-input bg-background px-3 py-2 text-sm"
            data-testid="select-lead-score"
          >
            <option value="all">All scores</option>
            <option value="hot">Hot</option>
            <option value="warm">Warm</option>
            <option value="cold">Cold</option>
          </select>
          <Button variant="quiet" className="px-2" data-testid="button-filter-leads">
            <Filter size={16} />
          </Button>
        </div>
      </div>

      {leads.isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <Skeleton key={n} className="h-20" />
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
        <div className="overflow-hidden rounded-xl border border-border bg-[hsl(var(--card))]">
          <div className="hidden grid-cols-[minmax(220px,1.3fr)_1fr_1fr_1fr_120px] gap-4 border-b border-border bg-[hsl(var(--muted)/.55)] px-5 py-3 text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground md:grid">
            <span>Lead</span>
            <span>Intent</span>
            <span>Need</span>
            <span>Next action</span>
            <span />
          </div>
          <div className="divide-y divide-border">
            {leads.data.map((lead) => (
              <div
                key={lead.id}
                className="grid gap-3 px-4 py-4 transition hover:bg-[hsl(var(--muted)/.32)] md:grid-cols-[minmax(220px,1.3fr)_1fr_1fr_1fr_120px] md:items-center md:gap-4 md:px-5"
                data-testid={`row-lead-${lead.id}`}
              >
                <button
                  className="flex min-w-0 items-center gap-3 text-left"
                  onClick={() => setSelected(lead.id)}
                  data-testid={`button-open-lead-${lead.id}`}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--secondary)/.35)] font-mono text-[11px] font-bold text-[hsl(var(--primary))]">
                    {initials(lead.name)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold">{lead.name}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {lead.phone} · {lead.project}
                    </span>
                  </span>
                </button>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={scoreTone(lead.score)}>{lead.score}</Badge>
                  <span className="font-mono text-xs text-muted-foreground">{lead.intent_score}/100</span>
                  {lead.consent_status !== 'valid' && <ConsentBadge status={lead.consent_status} />}
                </div>
                <div>
                  <p className="text-sm font-medium">{lead.property_type}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {lead.budget_label} · {lead.timeline}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium">{lead.next_action || 'Review lead'}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{relativeTime(lead.last_call || lead.created_at)}</p>
                </div>
                <div className="flex items-center justify-end gap-1">
                  <button
                    onClick={() =>
                      startCall.mutate(
                        { data: { lead_id: lead.id } },
                        { onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetCallsQueryKey() }) },
                      )
                    }
                    disabled={!lead.callable || startCall.isPending}
                    className="rounded-lg p-2 text-[hsl(var(--accent))] hover:bg-[hsl(var(--accent)/.1)] disabled:opacity-40"
                    title={lead.callable ? 'Call now' : lead.consent_detail || 'This lead cannot be called'}
                    data-testid={`button-call-row-${lead.id}`}
                  >
                    <Phone size={16} />
                  </button>
                  <button
                    onClick={() => setSelected(lead.id)}
                    className="rounded-lg p-2 text-muted-foreground hover:bg-[hsl(var(--muted))]"
                    title="Open details"
                    data-testid={`button-details-row-${lead.id}`}
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {selected && <LeadDetail id={selected} onClose={() => setSelected(null)} />}

      {showImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#102632]/35 p-5">
          <div className="w-full max-w-[440px] rounded-2xl border border-border bg-[hsl(var(--card))] p-6 shadow-2xl">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-bold">Import lead rows</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Use a CSV with name and phone columns. Quoted commas are handled.
                </p>
              </div>
              <button onClick={() => setShowImport(false)} data-testid="button-close-import">
                <X size={18} />
              </button>
            </div>
            <label className="mt-5 block text-sm font-semibold">
              Where was consent captured?
              <input
                value={consentSource}
                onChange={(event) => {
                  setConsentSource(event.target.value);
                  setImportError(null);
                }}
                placeholder="e.g. Website enquiry form, 12 Sep 2026"
                className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm"
                data-testid="input-consent-source"
              />
              <span className="mt-1.5 block text-xs font-normal leading-5 text-muted-foreground">
                Required. Leads imported without recorded consent evidence are never called.
              </span>
            </label>
            <label className="mt-5 flex cursor-pointer flex-col items-center rounded-xl border border-dashed border-[hsl(var(--accent)/.5)] bg-[hsl(var(--accent)/.04)] p-8 text-center hover:bg-[hsl(var(--accent)/.08)]">
              <Upload className="text-[hsl(var(--accent))]" size={22} />
              <span className="mt-3 text-sm font-semibold">Choose CSV file</span>
              <span className="mt-1 text-xs text-muted-foreground">Rows are normalized before import.</span>
              <input type="file" accept=".csv,text/csv" onChange={handleImport} className="hidden" data-testid="input-import-csv" />
            </label>
            {importLeads.isPending && <p className="mt-3 text-xs text-muted-foreground">Importing rows…</p>}
            {importNotice && (
              <p className="mt-3 text-xs text-muted-foreground" data-testid="text-import-notice">
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
    </div>
  );
}
