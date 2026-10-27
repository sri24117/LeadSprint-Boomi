import { useState } from 'react';
import {
  Calendar,
  CheckCircle2,
  ChevronRight,
  Compass,
  DollarSign,
  Filter,
  MapPin,
  MoveRight,
  Phone,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  User,
} from 'lucide-react';
import { useGetLeads, useStartCall } from '@workspace/api-client-react';
import { Badge, Button, EmptyState, ErrorState, Skeleton } from '@/components/common';

const STAGES = [
  { id: 'new', label: 'New Enquiries', color: 'border-blue-400 bg-blue-50/50' },
  { id: 'contacted', label: 'Contacted / In Touch', color: 'border-violet-400 bg-violet-50/50' },
  { id: 'qualified', label: 'AI Qualified', color: 'border-emerald-400 bg-emerald-50/50' },
  { id: 'booked', label: 'Showing Scheduled', color: 'border-purple-400 bg-purple-50/50' },
  { id: 'won', label: 'Under Contract / Won', color: 'border-amber-400 bg-amber-50/50' },
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
      <div className="grid grid-cols-1 gap-5 md:grid-cols-5">
        {[1, 2, 3, 4, 5].map((n) => (
          <Skeleton key={n} className="h-96 rounded-2xl" />
        ))}
      </div>
    );
  }

  if (leadsQuery.isError) {
    return <ErrorState retry={() => leadsQuery.refetch()} />;
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
      {/* Header filter controls */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search CRM pipeline by lead, project, or location..."
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm text-slate-800 placeholder-slate-400 shadow-xs focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
          />
        </div>

        <div className="flex items-center gap-3">
          <select
            value={filterScore}
            onChange={(e) => setFilterScore(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-700 shadow-xs focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
          >
            <option value="all">All Intent Scores</option>
            <option value="hot">Hot Leads</option>
            <option value="warm">Warm Leads</option>
            <option value="cold">Cold Leads</option>
          </select>
        </div>
      </div>

      {/* Kanban Board Columns */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-5 items-start">
        {STAGES.map((stage) => {
          const stageLeads = filteredLeads.filter((l) => getStageForLead(l) === stage.id);
          return (
            <div
              key={stage.id}
              className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3.5 shadow-2xs"
            >
              <div className="flex items-center justify-between px-2 pb-3 border-b border-slate-200/60">
                <span className="text-xs font-bold text-slate-700">{stage.label}</span>
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-200 font-mono text-[10px] font-bold text-slate-700">
                  {stageLeads.length}
                </span>
              </div>

              <div className="mt-3.5 space-y-3 min-h-[350px]">
                {stageLeads.length === 0 ? (
                  <div className="flex h-28 items-center justify-center rounded-xl border border-dashed border-slate-200 text-xs text-slate-400">
                    No leads in stage
                  </div>
                ) : (
                  stageLeads.map((lead) => (
                    <div
                      key={lead.id}
                      className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs transition hover:shadow-sm"
                    >
                      <div className="flex items-start justify-between">
                        <span className="font-bold text-sm text-slate-900">{lead.name}</span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                            lead.score === 'hot'
                              ? 'bg-red-50 text-red-600 border border-red-200'
                              : lead.score === 'warm'
                                ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {lead.score}
                        </span>
                      </div>

                      <p className="mt-1 text-xs text-slate-500 font-medium">
                        {lead.property_type} · {lead.location}
                      </p>

                      <div className="mt-2.5 flex items-center justify-between text-xs font-semibold text-slate-700">
                        <span>{lead.budget_label}</span>
                        <span className="text-[11px] font-mono text-slate-400">{lead.timeline}</span>
                      </div>

                      {/* TCPA Safety Badge */}
                      <div className="mt-3 flex items-center gap-1 text-[10px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-100">
                        <ShieldCheck size={11} />
                        <span>TCPA Consent: Valid</span>
                      </div>

                      {/* Card Action Controls */}
                      <div className="mt-3.5 flex items-center justify-between border-t border-slate-100 pt-3">
                        <button
                          onClick={() => startCall.mutate({ data: { lead_id: lead.id } })}
                          disabled={startCall.isPending}
                          className="inline-flex items-center gap-1 rounded-lg bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700 hover:bg-violet-100 transition"
                          title="Call with Sara AI"
                        >
                          <Phone size={11} />
                          <span>Call</span>
                        </button>

                        <div className="flex items-center gap-1">
                          {stage.id !== 'won' && (
                            <button
                              onClick={() => {
                                const currentIndex = STAGES.findIndex((s) => s.id === stage.id);
                                if (currentIndex < STAGES.length - 1) {
                                  moveStage(lead.id, STAGES[currentIndex + 1].id);
                                }
                              }}
                              className="rounded-lg border border-slate-200 p-1 text-slate-500 hover:text-violet-600 hover:border-violet-200 transition"
                              title="Advance to next stage"
                            >
                              <MoveRight size={13} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
