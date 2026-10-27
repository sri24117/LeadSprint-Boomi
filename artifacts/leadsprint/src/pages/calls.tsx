import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Bot,
  Calendar,
  CheckCircle2,
  Download,
  FileText,
  Filter,
  Headphones,
  Loader2,
  Mic,
  MoreHorizontal,
  Pause,
  Phone,
  Play,
  RefreshCw,
  Search,
  User,
  Volume2,
  X,
} from 'lucide-react';
import {
  getGetCallQueryKey,
  getGetCallsQueryKey,
  useGetCall,
  useGetCalls,
  useRetryCall,
} from '@workspace/api-client-react';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  Select,
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

// Sample conversational transcript data for calls
const MOCK_TRANSCRIPTS: Record<
  string,
  Array<{ role: 'agent' | 'user'; speaker: string; text: string; time: string; sentiment?: string }>
> = {
  default: [
    {
      role: 'agent',
      speaker: 'Sara (Boomi Solutions AI)',
      text: 'Hello Ava! This is Sara calling on behalf of Northstar Realty. Thank you for your inquiry on Zillow regarding our 2-bedroom condominium listings in Williamsburg. Do you have two minutes to discuss what you are looking for?',
      time: '00:04',
      sentiment: 'friendly',
    },
    {
      role: 'user',
      speaker: 'Ava Williams (Buyer)',
      text: 'Hi Sara! Yes, perfect timing. I am actively searching for a 2-bedroom with a balcony or outdoor space, ideally close to the Bedford L train stop.',
      time: '00:19',
      sentiment: 'positive',
    },
    {
      role: 'agent',
      speaker: 'Sara (Boomi Solutions AI)',
      text: 'Wonderful! What target price range or budget do you have in mind for this purchase, and are you already pre-approved for financing?',
      time: '00:34',
      sentiment: 'neutral',
    },
    {
      role: 'user',
      speaker: 'Ava Williams (Buyer)',
      text: 'Our target is between $850k and $1.1 million, and we are already fully pre-approved through Chase Private Client.',
      time: '00:52',
      sentiment: 'positive',
    },
    {
      role: 'agent',
      speaker: 'Sara (Boomi Solutions AI)',
      text: 'That is fantastic. We have two exclusive units on North 5th Street that match your exact criteria. Maya Patel from our senior brokerage team is holding private showings this Saturday at 2:00 PM. Would you like me to book a slot for you?',
      time: '01:15',
      sentiment: 'positive',
    },
    {
      role: 'user',
      speaker: 'Ava Williams (Buyer)',
      text: 'Saturday at 2:00 PM works great for me. Please reserve that showing!',
      time: '01:31',
      sentiment: 'positive',
    },
    {
      role: 'agent',
      speaker: 'Sara (Boomi Solutions AI)',
      text: 'I have locked in your showing for Saturday at 2:00 PM. You will receive an immediate calendar invitation and SMS confirmation. Thank you Ava, have a wonderful day!',
      time: '01:45',
      sentiment: 'positive',
    },
  ],
};

export default function CallsPage() {
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  // Audio player state
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<'1x' | '1.25x' | '1.5x'>('1x');
  const [audioProgress, setAudioProgress] = useState(25);

  const calls = useGetCalls(status === 'all' ? undefined : { status: status as any });
  const call = useGetCall(selected || '', {
    query: { enabled: !!selected, queryKey: getGetCallQueryKey(selected || '') },
  });
  const retryCall = useRetryCall();
  const queryClient = useQueryClient();

  if (calls.isLoading) {
    return (
      <div className="space-y-3">
        <PageHeader eyebrow="Console" title="Call History" />
        {[1, 2, 3, 4, 5].map((n) => (
          <Skeleton key={n} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (calls.isError) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow="Console" title="Call History" />
        <ErrorState retry={() => calls.refetch()} />
      </div>
    );
  }

  const filteredCalls = (calls.data || []).filter((item) => {
    return (
      item.lead_name.toLowerCase().includes(search.toLowerCase()) ||
      item.phone.includes(search) ||
      (item.outcome && item.outcome.toLowerCase().includes(search.toLowerCase())) ||
      (item.summary && item.summary.toLowerCase().includes(search.toLowerCase()))
    );
  });

  const transcript = MOCK_TRANSCRIPTS.default;

  const statusDot = (itemStatus: string) => {
    if (itemStatus === 'completed') return 'bg-[hsl(var(--success))]';
    if (itemStatus === 'in_progress') return 'bg-[hsl(var(--primary))] animate-pulse-dot';
    return 'bg-[hsl(var(--muted-foreground))]';
  };

  return (
    <div className="animate-rise-in space-y-6">
      <PageHeader
        eyebrow="Console"
        title="Call History"
        description="Audio recordings, full transcripts, turn-by-turn dialogue, and AI summaries."
      />

      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3.5 top-[50%] -translate-y-[50%] text-[hsl(var(--muted-foreground))]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by lead name, phone number, or call outcome…"
            className="w-full rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--background))] pl-10 pr-4 py-2.5 text-sm text-[hsl(var(--foreground))] placeholder-[hsl(var(--muted-foreground))] outline-none focus:border-[hsl(var(--primary))] focus:ring-1 focus:ring-[hsl(var(--primary))]"
            data-testid="input-search-calls"
          />
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            data-testid="select-call-status"
          >
            <option value="all">All call states</option>
            <option value="completed">Completed</option>
            <option value="in_progress">In progress</option>
            <option value="queued">Queued</option>
            <option value="failed">Failed</option>
            <option value="uncertain">Uncertain</option>
            <option value="policy_blocked">Policy blocked</option>
          </Select>
        </div>
      </div>

      {!filteredCalls.length ? (
        <EmptyState
          icon={Headphones}
          title="No calls found in this filter"
          description="When leads are contacted, full audio recordings and conversational transcripts will appear here."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[34%]">Lead &amp; contact</TableHead>
              <TableHead className="w-[20%]">Agent / provider</TableHead>
              <TableHead className="w-[16%]">State</TableHead>
              <TableHead className="w-[12%] text-right">Duration</TableHead>
              <TableHead className="w-[28%]">Intelligence outcome</TableHead>
              <TableHead className="w-[12%] text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredCalls.map((item) => (
              <TableRow key={item.id} data-testid={`row-call-${item.id}`}>
                <TableCell className="w-[34%]">
                  <button
                    onClick={() => setSelected(item.id)}
                    className="text-left font-semibold text-[hsl(var(--foreground))] hover:text-[hsl(var(--primary))]"
                    data-testid={`button-open-call-${item.id}`}
                  >
                    {item.lead_name}
                  </button>
                  <p className="mt-0.5 text-xs font-mono text-[hsl(var(--muted-foreground))]">
                    {item.phone} · {formatDate(item.started_at)}
                  </p>
                </TableCell>
                <TableCell className="w-[20%]">
                  <p className="text-xs font-semibold text-[hsl(var(--foreground))]">Sara AI</p>
                  <p className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))] font-mono">
                    ({item.provider})
                  </p>
                  {item.transferred && (
                    <p className="mt-1 text-[11px] font-medium text-[hsl(var(--primary))]">
                      Operator transferred
                    </p>
                  )}
                </TableCell>
                <TableCell className="w-[16%]">
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold border ${statusTone(item.status)}`}>
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${statusDot(item.status)}`}
                    />
                    {item.status.replaceAll('_', ' ')}
                  </span>
                </TableCell>
                <TableCell className="w-[12%] text-right">
                  <span className="font-mono text-xs font-medium text-[hsl(var(--muted-foreground))]">
                    {item.duration_seconds
                      ? `${Math.floor(item.duration_seconds / 60)}m ${item.duration_seconds % 60}s`
                      : '—'}
                  </span>
                </TableCell>
                <TableCell className="w-[28%]">
                  <p className="line-clamp-2 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">
                    {item.outcome || item.summary || 'Awaiting final callback'}
                  </p>
                  {item.error_state && (
                    <p className="mt-1 text-xs font-medium text-[hsl(var(--destructive))]">
                      {item.error_state}
                    </p>
                  )}
                </TableCell>
                <TableCell className="w-[12%] text-right">
                  <button
                    onClick={() => setSelected(item.id)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-1.5 text-xs font-semibold text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))/0.05]"
                    data-testid={`button-view-transcript-${item.id}`}
                  >
                    <FileText size={13} />
                    <span>View</span>
                  </button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Full Call Intelligence & Transcript Panel */}
      {selected && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-[hsl(var(--foreground))/0.25] backdrop-blur-sm"
          onKeyDown={(event) => {
            if (event.key === 'Escape') setSelected(null);
          }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelected(null);
          }}
        >
          <div className="h-full w-full max-w-[620px] overflow-y-auto bg-[hsl(var(--card))] border-l border-[hsl(var(--card-border))] flex flex-col">
            <div className="flex items-start justify-between border-b border-[hsl(var(--border))] p-5">
              <div>
                <div className="flex items-center gap-2">
                  <span className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-2.5 py-0.5 text-xs font-bold text-[hsl(var(--muted-foreground))]">
                    Call intelligence
                  </span>
                  <span className="ml-2 text-[10px] font-mono text-[hsl(var(--muted-foreground))]">
                    ID: {selected}
                  </span>
                </div>
                <h2 className="mt-1.5 text-xl font-bold text-[hsl(var(--foreground))]">
                  {call.data?.lead_name || 'Call details'}
                </h2>
                <p className="mt-0.5 text-xs font-mono text-[hsl(var(--muted-foreground))]">
                  {call.data?.phone} · Started: {formatDate(call.data?.started_at)}
                </p>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="rounded-md p-2 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
                data-testid="button-close-call"
              >
                <X size={18} />
              </button>
            </div>

            {/* Audio Recording & Player */}
            <section className="border-b border-[hsl(var(--border))] p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Volume2 size={16} className="text-[hsl(var(--primary))]" />
                  <span className="text-xs font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                    Call audio recording
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {(['1x', '1.25x', '1.5x'] as const).map((spd) => (
                    <button
                      key={spd}
                      onClick={() => setPlaybackSpeed(spd)}
                      className={`rounded-md border px-2.5 py-0.5 text-[10px] font-bold transition ${
                        playbackSpeed === spd
                          ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]'
                          : 'border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]'
                      }`}
                    >
                      {spd}
                    </button>
                  ))}
                  <button
                    title="Download audio"
                    className="rounded-md border border-[hsl(var(--border))] p-1.5 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--primary))] hover:bg-[hsl(var(--muted))]"
                  >
                    <Download size={12} />
                  </button>
                </div>
              </div>

              <div className="mt-5 flex items-center gap-3">
                <button
                  onClick={() => setIsPlaying(!isPlaying)}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] transition hover:bg-[hsl(var(--primary))/90]"
                  data-testid="button-play-recording"
                >
                  {isPlaying ? <Pause size={17} /> : <Play size={17} className="ml-0.5" />}
                </button>
                <div className="flex-1">
                  <div className="relative h-1.5 w-full rounded-full bg-[hsl(var(--border))] overflow-hidden">
                    <div
                      className="h-full bg-[hsl(var(--primary))] transition-all duration-150"
                      style={{ width: `${isPlaying ? 68 : audioProgress}%` }}
                    />
                  </div>
                  <div className="mt-1.5 flex justify-between text-[10px] font-mono text-[hsl(var(--muted-foreground))]">
                    <span>{isPlaying ? '01:14' : '00:25'}</span>
                    <span>
                      {call.data?.duration_seconds
                        ? `${Math.floor(call.data.duration_seconds / 60)}:${(call.data.duration_seconds % 60).toString().padStart(2, '0')}`
                        : '04:56'}
                    </span>
                  </div>
                </div>
              </div>
            </section>

            {/* Extracted Key Signals */}
            <section className="border-b border-[hsl(var(--border))] p-5">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border border-[hsl(var(--border))] p-3 text-center">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Sentiment</span>
                  <p className="mt-1 text-xs font-bold text-[hsl(var(--success))]">Positive (94%)</p>
                </div>
                <div className="rounded-lg border border-[hsl(var(--border))] p-3 text-center">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Intent</span>
                  <p className="mt-1 text-xs font-bold text-[hsl(var(--primary))]">Ready to view</p>
                </div>
                <div className="rounded-lg border border-[hsl(var(--border))] p-3 text-center">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Appointment</span>
                  <p className="mt-1 text-xs font-bold text-[hsl(var(--foreground))]">
                    {call.data?.booked ? 'Booked' : 'Handoff'}
                  </p>
                </div>
              </div>
            </section>

            {/* Conversational Turn-by-Turn Transcript */}
            <section className="p-5">
              <div className="flex items-center justify-between border-b border-[hsl(var(--border))] pb-2 mb-4">
                <div className="flex items-center gap-2">
                  <FileText size={16} className="text-[hsl(var(--primary))]" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                    Full dialogue transcript
                  </h3>
                </div>
                <span className="text-[11px] font-mono text-[hsl(var(--muted-foreground))]">7 turns</span>
              </div>

              <div className="space-y-4 pr-1">
                {transcript.map((item, idx) => (
                  <div key={idx} className={`flex flex-col ${item.role === 'user' ? 'items-end' : 'items-start'}`}>
                    <div className="flex items-center gap-1.5 mb-1 px-1">
                      <span className="text-[10px] font-bold text-[hsl(var(--muted-foreground))]">
                        {item.speaker}
                      </span>
                      <span className="text-[10px] font-mono text-[hsl(var(--muted-foreground))]">· {item.time}</span>
                    </div>
                    <div
                      className={`max-w-[88%] rounded-lg px-3.5 py-2.5 text-xs leading-relaxed ${
                        item.role === 'agent'
                          ? 'border border-[hsl(var(--border))] bg-[hsl(var(--muted))/0.4] text-[hsl(var(--foreground))]'
                          : 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]'
                      }`}
                    >
                      {item.text}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Bottom Actions if failed or retriable */}
            {call.data && ['uncertain', 'failed', 'policy_blocked'].includes(call.data.status) && (
              <div className="border-t border-[hsl(var(--border))] p-5">
                <Button
                  variant="primary"
                  onClick={() => {
                    if (call.data) {
                      retryCall.mutate(
                        { id: call.data.id },
                        {
                          onSettled: () => {
                            queryClient.invalidateQueries({ queryKey: getGetCallsQueryKey() });
                            queryClient.invalidateQueries({ queryKey: getGetCallQueryKey(call.data!.id) });
                          },
                        },
                      );
                    }
                  }}
                  disabled={retryCall.isPending}
                >
                  {retryCall.isPending ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                  <span>Retry call</span>
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
