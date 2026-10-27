import { useState } from 'react';
import { Link } from 'wouter';
import {
  Bot,
  Copy,
  Filter,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Volume2,
} from 'lucide-react';
import {
  Badge,
  Button,
  PageHeader,
  Section,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/common';

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
    const matchesLang = selectedLanguage === 'all' || agent.languages.includes(selectedLanguage);
    const matchesStatus = selectedStatus === 'all' || agent.status === selectedStatus;
    return matchesSearch && matchesLang && matchesStatus;
  });

  return (
    <div className="animate-rise-in space-y-6">
      <PageHeader
        eyebrow="Console"
        title="AI Agents"
        description="Configure, duplicate, pause, or deploy conversational agents across standard business profiles."
        action={
          <Link
            href="/workspace/agent-builder"
            className="inline-flex items-center gap-2 rounded-md bg-[hsl(var(--primary))] px-3.5 py-2 text-sm font-bold text-[hsl(var(--primary-foreground))] hover:bg-[hsl(var(--primary))/90]"
            data-testid="button-open-builder"
          >
            <Plus size={15} />
            Agent builder
          </Link>
        }
      />

      <Section>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-bold text-[hsl(var(--foreground))]">Existing Retell AI Agents</h3>
            <p className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">
              Read-only list from the configured Retell account. Linking changes only the local application mapping and requires an organization owner or administrator.
            </p>
          </div>
          <Button
            onClick={handleRefresh}
            data-testid="button-refresh-retell"
            className="px-3 py-2 text-sm"
          >
            {isRefreshing ? <RefreshCw size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            <span>Refresh</span>
          </Button>
        </div>

        <div className="mt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[30%]">Retell agent</TableHead>
                <TableHead className="w-[30%]">Retell agent ID</TableHead>
                <TableHead className="w-[15%]">Channel</TableHead>
                <TableHead>Application mapping</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {INITIAL_RETELL_AGENTS.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="w-[30%]">
                    <p className="font-semibold text-[hsl(var(--foreground))]">{item.name}</p>
                  </TableCell>
                  <TableCell className="w-[30%]">
                    <p className="font-mono text-xs text-[hsl(var(--muted-foreground))]">{item.id}</p>
                  </TableCell>
                  <TableCell className="w-[15%]">
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))/0.4] px-2.5 py-1 text-xs text-[hsl(var(--muted-foreground))]">
                      <Volume2 size={12} />
                      {item.channel}
                    </span>
                  </TableCell>
                  <TableCell>
                    <p className="text-xs font-medium text-[hsl(var(--muted-foreground))]">{item.mapping}</p>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Section>

      <Section
        title="Configured application agents"
        description="Agents active in this tenant workspace for handling inbound leads and scheduled outbound qualification calls."
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3.5 top-[50%] -translate-y-[50%] text-[hsl(var(--muted-foreground))]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search agents by name, type, or voice…"
              className="w-full rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--background))] pl-10 pr-4 py-2.5 text-sm text-[hsl(var(--foreground))] placeholder-[hsl(var(--muted-foreground))] outline-none focus:border-[hsl(var(--primary))] focus:ring-1 focus:ring-[hsl(var(--primary))]"
              data-testid="input-search-agents"
            />
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={selectedLanguage}
              onChange={(e) => setSelectedLanguage(e.target.value)}
              data-testid="select-language"
            >
              <option value="all">All languages</option>
              <option value="English">English</option>
              <option value="Spanish">Spanish</option>
            </Select>
            <Select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              data-testid="select-status"
            >
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
            </Select>
          </div>
        </div>

        <div className="mt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[26%]">Agent</TableHead>
                <TableHead className="w-[18%]">Business type</TableHead>
                <TableHead className="w-[14%]">Languages</TableHead>
                <TableHead className="w-[20%]">Voice configuration</TableHead>
                <TableHead className="w-[10%]">Status</TableHead>
                <TableHead className="w-[10%] text-right">Calls today</TableHead>
                <TableHead className="w-[14%] text-right">Created</TableHead>
                <TableHead className="w-[16%] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAgents.map((agent) => (
                <TableRow key={agent.id} data-testid={`row-agent-${agent.name}`}>
                  <TableCell className="w-[26%]">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[hsl(var(--primary))/0.10] text-[hsl(var(--primary))]">
                        <Bot size={16} />
                      </div>
                      <div>
                        <p className="font-semibold text-[hsl(var(--foreground))]">{agent.name}</p>
                        <div className="flex items-center gap-1.5 text-[11px] font-mono text-[hsl(var(--muted-foreground))]">
                          <span>ID: {agent.id.slice(0, 16)}…</span>
                          <button
                            onClick={() => handleCopy(agent.id)}
                            title="Copy agent ID"
                            className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                          >
                            <Copy size={11} />
                          </button>
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="w-[18%]">
                    <p className="text-sm text-[hsl(var(--muted-foreground))] font-medium">{agent.businessType}</p>
                  </TableCell>
                  <TableCell className="w-[14%]">
                    <div className="flex flex-wrap gap-1">
                      {agent.languages.map((lang) => (
                        <span key={lang} className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))/0.4] px-2 py-0.5 text-[10px] text-[hsl(var(--muted-foreground))]">
                          {lang}
                        </span>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="w-[20%]">
                    <p className="font-medium text-[hsl(var(--foreground))]">{agent.voice}</p>
                    <p className="mt-0.5 text-[11px] text-[hsl(var(--muted-foreground))]">{agent.voiceProvider}</p>
                  </TableCell>
                  <TableCell className="w-[10%]">
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold border ${agent.status === 'active' ? 'border-[#8fc7a8]/55 bg-[#eff7f2] text-[#2f6b49]' : 'border-[#e2e8f0]/55 bg-[#f8fafc] text-[#475569]'}`}>
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          agent.status === 'active'
                            ? 'bg-[hsl(var(--success))]'
                            : 'bg-[hsl(var(--muted-foreground))]'
                        }`}
                      />
                      {agent.status === 'active' ? 'Active' : 'Paused'}
                    </span>
                  </TableCell>
                  <TableCell className="w-[10%] text-right">
                    <p className="font-mono text-xs font-semibold text-[hsl(var(--foreground))]">{agent.callsToday}</p>
                  </TableCell>
                  <TableCell className="w-[14%] text-right">
                    <p className="text-[11px] font-mono text-[hsl(var(--muted-foreground))]">{agent.createdDate}</p>
                  </TableCell>
                  <TableCell className="w-[16%] text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Link
                        href={`/workspace/agent-builder?id=${agent.id}`}
                        className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-2.5 py-1 text-xs font-medium text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]"
                        data-testid={`button-edit-agent-${agent.name}`}
                      >
                        Edit
                      </Link>
                      <button
                        onClick={() => handleToggleStatus(agent.id)}
                        className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-2.5 py-1 text-xs font-medium text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]"
                        data-testid={`button-toggle-agent-${agent.name}`}
                      >
                        {agent.status === 'active' ? 'Pause' : 'Resume'}
                      </button>
                      <button
                        onClick={() => handleCopy(agent.id)}
                        className="rounded-md p-1.5 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]" title="Copy config"
                      >
                        <Copy size={13} />
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Section>
    </div>
  );
}
