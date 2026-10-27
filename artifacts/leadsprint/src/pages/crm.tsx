import { useState } from 'react';
import { MoveRight, Phone, Search, ShieldCheck } from 'lucide-react';
import { useGetLeads, useStartCall } from '@workspace/api-client-react';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  PageHeader,
  Section,
  Skeleton,
  Select,
  scoreTone,
} from '@/components/common';

const STAGES = [
  { id: 'new', label: 'New enquiries' },
  { id: 'contacted', label: 'Contacted' },
  { id: 'qualified', label: 'AI qualified' },
  { id: 'booked', label: 'Showing scheduled' },
  { id: 'won', label: 'Under contract' },
];

export default function CrmPage() {
  const [search, setSearch] = useState('');
  const [filterScore, setFilterScore] = useState('all');
  const leadsQuery = useGetLeads();
  const startCall = useStartCall();

  // Local state for moving leads between stages
  const [leadStages, setLeadStages] = useState<Record<string, string>>({
    lead_ava: 'booked',
    lead_rohan: 'contacted',
    lead_priya: 'qualified',
    lead_marcus: 'new',
  });

  if (leadsQuery.isLoading) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow="Console" title="CRM" />
        <div className="grid gap-4 sm:grid-cols-5">
          {[1, 2, 3, 4, 5].map((n) => (
            <Skeleton key={n} className="h-[340px] rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (leadsQuery.isError) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow="Console" title="CRM" />
        <ErrorState retry={() => leadsQuery.refetch()} />
      </div>
    );
  }

  const allLeads = leadsQuery.data || [];

  const getStageForLead = (lead: any) => {
    if (leadStages[lead.id]) return leadStages[lead.id];
    if (lead.qualification_status === 'Qualified') return 'qualified';
    if (lead.status === 'contacted') return 'contacted';
    return 'new';
  };

  const moveStage = (leadId: string, nextStage: string) => {
    setLeadStages((prev) => ({ ...prev, [leadId]: nextStage }));
  };

  const filteredLeads = allLeads.filter((lead) => {
    const matchesSearch =
      lead.name.toLowerCase().includes(search.toLowerCase()) ||
      lead.property_type.toLowerCase().includes(search.toLowerCase()) ||
      lead.location.toLowerCase().includes(search.toLowerCase());
    const matchesScore = filterScore === 'all' || lead.score === filterScore;
    return matchesSearch && matchesScore;
  });

  return (
    <div className="animate-rise-in space-y-6">
      <PageHeader
        eyebrow="Console"
        title="CRM"
        description="Track leads from incoming enquiry to qualification and booked appointments."
      />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3.5 top-[50%] -translate-y-[50%] text-[hsl(var(--muted-foreground))]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search pipeline by lead, project, or location…"
            className="w-full rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--background))] pl-10 pr-4 py-2.5 text-sm text-[hsl(var(--foreground))] placeholder-[hsl(var(--muted-foreground))] outline-none focus:border-[hsl(var(--primary))] focus:ring-1 focus:ring-[hsl(var(--primary))]"
          />
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={filterScore}
            onChange={(e) => setFilterScore(e.target.value)}
          >
            <option value="all">All intent scores</option>
            <option value="hot">Hot leads</option>
            <option value="warm">Warm leads</option>
            <option value="cold">Cold leads</option>
          </Select>
        </div>
      </div>

      <Section>
        <div className="grid gap-4 sm:gap-5 md:grid-cols-5 items-start">
          {STAGES.map((stage) => {
            const stageLeads = filteredLeads.filter((l) => getStageForLead(l) === stage.id);
            return (
              <div key={stage.id} className="flex flex-col gap-2" data-testid={`column-${stage.id}`}>
                <div className="flex items-center justify-between gap-2 px-2 py-2">
                  <span className="text-[10px] font-bold uppercase tracking-[.14em] text-[hsl(var(--muted-foreground))]">
                    {stage.label}
                  </span>
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] font-mono text-[10px] font-bold text-[hsl(var(--muted-foreground))]">
                    {stageLeads.length}
                  </span>
                </div>
                <div className="flex-1 min-h-[320px] flex flex-col gap-2.5 overflow-y-auto p-1.5 [&_*:last-child]:mb-0 scrollbar-subtle">
                  {stageLeads.length === 0 ? (
                    <div className="flex h-24 items-center justify-center rounded-md border border-dashed border-[hsl(var(--border))] text-xs text-[hsl(var(--muted-foreground))]">
                      No leads in stage
                    </div>
                  ) : (
                    stageLeads.map((lead) => (
                      <div
                        key={lead.id}
                        className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3.5 transition hover:border-[hsl(var(--primary))/0.5]"
                        data-testid={`card-lead-${lead.id}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-semibold text-[hsl(var(--foreground))]">{lead.name}</span>
                          <Badge className={scoreTone(lead.score)}>{lead.score}</Badge>
                        </div>
                        <p className="mt-1.5 text-xs text-[hsl(var(--muted-foreground))] font-medium">
                          {lead.property_type} · {lead.location}
                        </p>
                        <div className="mt-2.5 flex items-center justify-between text-xs text-[hsl(var(--muted-foreground))]">
                          <span className="font-mono font-semibold">{lead.budget_label}</span>
                          <span className="font-mono">{lead.timeline}</span>
                        </div>
                        <div className="mt-3 flex items-center gap-1.5 rounded-md border border-[hsl(var(--success))/0.35] bg-[hsl(var(--success))/0.08] px-2.5 py-1 text-[10px] font-bold text-[hsl(var(--success))]">
                          <ShieldCheck size={11} />
                          <span>TCPA consent valid</span>
                        </div>
                        <div className="mt-3.5 flex items-center justify-between gap-2">
                          <button
                            onClick={() => startCall.mutate({ data: { lead_id: lead.id } })}
                            disabled={startCall.isPending}
                            className="flex items-center gap-1.5 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-2.5 py-1.5 text-xs font-semibold text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))/0.05] disabled:opacity-40"
                            title="Call with Sara AI"
                          >
                            <Phone size={11} />
                            <span>Call</span>
                          </button>
                          {stage.id !== 'won' && (
                            <button
                              onClick={() => {
                                const currentIndex = STAGES.findIndex((s) => s.id === stage.id);
                                if (currentIndex < STAGES.length - 1) {
                                  moveStage(lead.id, STAGES[currentIndex + 1].id);
                                }
                              }}
                              className="rounded-md p-1.5 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--primary))]"
                              title="Advance to next stage"
                            >
                              <MoveRight size={13} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Section>
    </div>
  );
}
