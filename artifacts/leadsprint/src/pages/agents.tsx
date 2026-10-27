import { useState } from 'react';
import { Link } from 'wouter';
import {
  Bot,
  Copy,
  ExternalLink,
  Filter,
  MoreVertical,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Volume2,
} from 'lucide-react';
import { Badge, Button } from '@/components/common';

interface RetellAgentItem {
  name: string;
  id: string;
  channel: string;
  mapping: string;
}

interface LocalAgentItem {
  id: string;
  name: string;
  businessType: string;
  languages: string[];
  voice: string;
  voiceProvider: string;
  status: 'active' | 'paused' | 'draft';
  callsToday: number;
  createdDate: string;
}

const INITIAL_RETELL_AGENTS: RetellAgentItem[] = [
  {
    name: 'Boomi Solutions Receptionist',
    id: 'agent_49f28308f661ae06a348071fff',
    channel: 'voice',
    mapping: 'Linked to sara (cmvdp8ql00001te0k4o5q8f6d)',
  },
  {
    name: 'Real Estate Qualifier US',
    id: 'agent_72a19904e220bc01a98092aaa',
    channel: 'voice',
    mapping: 'Linked to alex (cmvdp8ql00002te0k4o5q8f6e)',
  },
];

const INITIAL_LOCAL_AGENTS: LocalAgentItem[] = [
  {
    id: 'cmvdp8ql00001te0k4o5q8f6d',
    name: 'sara',
    businessType: 'Sales Agent',
    languages: ['English'],
    voice: 'Aura-Asteria',
    voiceProvider: 'Deepgram (1x)',
    status: 'active',
    callsToday: 1,
    createdDate: '2026-10-18',
  },
  {
    id: 'cmvdp8ql00002te0k4o5q8f6e',
    name: 'alex',
    businessType: 'Inbound Receptionist',
    languages: ['English', 'Spanish'],
    voice: 'Rachel - Natural Conversational',
    voiceProvider: 'ElevenLabs (Turbo v2)',
    status: 'active',
    callsToday: 3,
    createdDate: '2026-10-20',
  },
  {
    id: 'cmvdp8ql00003te0k4o5q8f6f',
    name: 'maya-concierge',
    businessType: 'Showing Scheduler',
    languages: ['English'],
    voice: 'Aura-Orion',
    voiceProvider: 'Deepgram (1x)',
    status: 'paused',
    callsToday: 0,
    createdDate: '2026-10-22',
  },
];

export default function AgentsPage() {
  const [search, setSearch] = useState('');
  const [selectedLanguage, setSelectedLanguage] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [localAgents, setLocalAgents] = useState<LocalAgentItem[]>(INITIAL_LOCAL_AGENTS);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => setIsRefreshing(false), 800);
  };

  const handleToggleStatus = (id: string) => {
    setLocalAgents((prev) =>
      prev.map((agent) =>
        agent.id === id
          ? { ...agent, status: agent.status === 'active' ? 'paused' : 'active' }
          : agent,
      ),
    );
  };

  const handleCopy = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const filteredAgents = localAgents.filter((agent) => {
    const matchesSearch =
      agent.name.toLowerCase().includes(search.toLowerCase()) ||
      agent.businessType.toLowerCase().includes(search.toLowerCase()) ||
      agent.voice.toLowerCase().includes(search.toLowerCase()) ||
      agent.id.toLowerCase().includes(search.toLowerCase());
    const matchesLang =
      selectedLanguage === 'all' || agent.languages.includes(selectedLanguage);
    const matchesStatus =
      selectedStatus === 'all' || agent.status === selectedStatus;
    return matchesSearch && matchesLang && matchesStatus;
  });

  return (
    <div className="animate-rise-in space-y-6">
      {/* Top Banner Card */}
      <div className="relative overflow-hidden rounded-2xl border border-violet-100 bg-gradient-to-r from-violet-50/80 via-purple-50/50 to-indigo-50/70 p-6 shadow-sm">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div className="max-w-2xl">
            <h2 className="text-base font-semibold text-slate-800">
              Conversational Voice Workforce
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-slate-600">
              Configure, duplicate, pause, or deploy conversational agents across standard business profiles.
              Agents are linked to Retell AI telephony and operate under verified TCPA compliance gates.
            </p>
          </div>
          <Link
            href="/workspace/agent-builder"
            className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-700 active:scale-95"
            data-testid="button-open-builder"
          >
            <Plus size={16} />
            <span>Agent Builder</span>
          </Link>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search
            size={16}
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search agents by name, type, or voice..."
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm text-slate-800 placeholder-slate-400 shadow-xs focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
            data-testid="input-search-agents"
          />
        </div>
        <div className="flex items-center gap-2">
          <select
            value={selectedLanguage}
            onChange={(e) => setSelectedLanguage(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-700 shadow-xs focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
            data-testid="select-language"
          >
            <option value="all">All Languages</option>
            <option value="English">English</option>
            <option value="Spanish">Spanish</option>
          </select>

          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-700 shadow-xs focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
            data-testid="select-status"
          >
            <option value="all">All Statuses</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
          </select>
        </div>
      </div>

      {/* Existing Retell AI Agents Card */}
      <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-xs">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
              Existing Retell AI Agents
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Read-only list from the configured Retell account. Linking changes only the local application mapping and requires an organization owner or administrator.
            </p>
          </div>
          <button
            onClick={handleRefresh}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 active:scale-95"
            data-testid="button-refresh-retell"
          >
            <RefreshCw size={13} className={isRefreshing ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/70 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-6 py-3">Retell Agent</th>
                <th className="px-6 py-3">Retell Agent ID</th>
                <th className="px-6 py-3">Channel</th>
                <th className="px-6 py-3">Application Mapping</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {INITIAL_RETELL_AGENTS.map((item) => (
                <tr key={item.id} className="transition hover:bg-slate-50/60">
                  <td className="px-6 py-4 font-semibold text-slate-800">
                    {item.name}
                  </td>
                  <td className="px-6 py-4 font-mono text-xs text-slate-500">
                    {item.id}
                  </td>
                  <td className="px-6 py-4">
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                      <Volume2 size={12} className="text-slate-500" />
                      {item.channel}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-xs font-medium text-violet-700">
                    {item.mapping}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Local AI Agents Table */}
      <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-xs">
        <div className="border-b border-slate-100 px-6 py-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
            Configured Application Agents
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Agents active in this tenant workspace for handling inbound leads and scheduled outbound qualification calls.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/70 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-6 py-3">Agent Name</th>
                <th className="px-6 py-3">Business Type</th>
                <th className="px-6 py-3">Languages</th>
                <th className="px-6 py-3">Voice Configuration</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3">Calls Today</th>
                <th className="px-6 py-3">Created Date</th>
                <th className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredAgents.map((agent) => (
                <tr key={agent.id} className="transition hover:bg-slate-50/60" data-testid={`row-agent-${agent.name}`}>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
                        <Bot size={18} />
                      </div>
                      <div>
                        <span className="font-bold text-slate-800">{agent.name}</span>
                        <div className="flex items-center gap-1 text-[11px] font-mono text-slate-400">
                          <span>ID: {agent.id.slice(0, 16)}...</span>
                          <button
                            onClick={() => handleCopy(agent.id)}
                            title="Copy Agent ID"
                            className="hover:text-slate-600"
                          >
                            <Copy size={11} />
                          </button>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-slate-600 font-medium">{agent.businessType}</td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-1">
                      {agent.languages.map((lang) => (
                        <span
                          key={lang}
                          className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600"
                        >
                          {lang}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <p className="font-medium text-slate-800">{agent.voice}</p>
                    <p className="text-xs text-slate-400">{agent.voiceProvider}</p>
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        agent.status === 'active'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-slate-100 text-slate-600 border border-slate-200'
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          agent.status === 'active' ? 'bg-emerald-500' : 'bg-slate-400'
                        }`}
                      />
                      {agent.status === 'active' ? 'Active' : 'Paused'}
                    </span>
                  </td>
                  <td className="px-6 py-4 font-mono font-semibold text-slate-700">
                    {agent.callsToday}
                  </td>
                  <td className="px-6 py-4 text-xs font-mono text-slate-500">
                    {agent.createdDate}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Link
                        href={`/workspace/agent-builder?id=${agent.id}`}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                        data-testid={`button-edit-agent-${agent.name}`}
                      >
                        <Pencil size={12} />
                        <span>Edit</span>
                      </Link>
                      <button
                        onClick={() => handleToggleStatus(agent.id)}
                        className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                        data-testid={`button-toggle-agent-${agent.name}`}
                      >
                        {agent.status === 'active' ? 'Pause' : 'Resume'}
                      </button>
                      <button
                        onClick={() => handleCopy(agent.id)}
                        className="rounded-lg border border-slate-200 p-1 text-slate-600 transition hover:bg-slate-50"
                        title="Copy Config"
                      >
                        <Copy size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
