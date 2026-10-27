import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Bot,
  Calendar,
  CheckCircle2,
  ChevronDown,
  Download,
  FastForward,
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
  Sparkles,
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
  Info,
  Skeleton,
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
        {[1, 2, 3, 4, 5].map((n) => (
          <Skeleton key={n} className="h-20 rounded-2xl" />
        ))}
      </div>
    );
  }

  if (calls.isError) {
    return <ErrorState retry={() => calls.refetch()} />;
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

  return (
    <>
      <div className="animate-rise-in space-y-6">
        {/* Search and Filters Bar */}
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div className="relative flex-1 max-w-md">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by lead name, phone number, or call outcome..."
              className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm text-slate-800 placeholder-slate-400 shadow-xs focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
              data-testid="input-search-calls"
            />
          </div>

          <div className="flex items-center gap-3">
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-700 shadow-xs focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
              data-testid="select-call-status"
            >
              <option value="all">All Call States</option>
              <option value="completed">Completed</option>
              <option value="in_progress">In progress</option>
              <option value="queued">Queued</option>
              <option value="failed">Failed</option>
              <option value="uncertain">Uncertain</option>
              <option value="policy_blocked">Policy blocked</option>
            </select>
          </div>
        </div>

        {!filteredCalls.length ? (
          <EmptyState
            icon={Headphones}
            title="No calls found in this filter"
            description="When leads are contacted, full audio recordings and conversational transcripts will appear here."
          />
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-xs">
            <div className="hidden grid-cols-[1.3fr_1.1fr_1fr_1fr_1.5fr_110px] gap-4 border-b border-slate-100 bg-slate-50/70 px-6 py-3.5 text-[11px] font-bold uppercase tracking-wider text-slate-500 md:grid">
              <span>Lead & Contact</span>
              <span>Agent / Provider</span>
              <span>State</span>
              <span>Duration</span>
              <span>Intelligence Outcome</span>
              <span className="text-right">Transcript</span>
            </div>

            <div className="divide-y divide-slate-100">
              {filteredCalls.map((item) => (
                <div
                  key={item.id}
                  className="grid gap-3 px-6 py-4 md:grid-cols-[1.3fr_1.1fr_1fr_1fr_1.5fr_110px] md:items-center md:gap-4 transition hover:bg-slate-50/60"
                  data-testid={`row-call-${item.id}`}
                >
                  <div>
                    <button
                      onClick={() => setSelected(item.id)}
                      className="text-left font-bold text-slate-800 hover:text-violet-600 transition"
                      data-testid={`button-open-call-${item.id}`}
                    >
                      {item.lead_name}
                    </button>
                    <p className="mt-0.5 text-xs font-mono text-slate-400">
                      {item.phone} · {formatDate(item.started_at)}
                    </p>
                  </div>

                  <div className="text-xs">
                    <span className="font-semibold text-slate-700">Sara AI</span>
                    <span className="ml-1.5 text-slate-400">({item.provider})</span>
                    {item.transferred && (
                      <span className="mt-1 block text-[11px] font-medium text-violet-600">
                        Operator Transferred
                      </span>
                    )}
                  </div>

                  <div>
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        item.status === 'completed'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : item.status === 'in_progress'
                            ? 'bg-violet-50 text-violet-700 border border-violet-200 animate-pulse'
                            : 'bg-slate-100 text-slate-600 border border-slate-200'
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          item.status === 'completed'
                            ? 'bg-emerald-500'
                            : item.status === 'in_progress'
                              ? 'bg-violet-600'
                              : 'bg-slate-400'
                        }`}
                      />
                      {item.status.replaceAll('_', ' ')}
                    </span>
                  </div>

                  <div className="font-mono text-xs font-medium text-slate-600">
                    {item.duration_seconds
                      ? `${Math.floor(item.duration_seconds / 60)}m ${item.duration_seconds % 60}s`
                      : '—'}
                  </div>

                  <div>
                    <p className="line-clamp-2 text-xs leading-relaxed text-slate-700">
                      {item.outcome || item.summary || 'Awaiting final callback'}
                    </p>
                    {item.error_state && (
                      <p className="mt-1 text-xs text-red-600 font-medium">{item.error_state}</p>
                    )}
                  </div>

                  <div className="text-right">
                    <button
                      onClick={() => setSelected(item.id)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-violet-700 shadow-2xs transition hover:bg-violet-50 hover:border-violet-200 active:scale-95"
                      data-testid={`button-view-transcript-${item.id}`}
                    >
                      <FileText size={13} />
                      <span>View</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Full Call Intelligence & Transcript Drawer - Mounted at root */}
      {selected && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-xs animate-fade-in"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelected(null);
          }}
        >
          <div className="h-full w-full max-w-[620px] overflow-y-auto bg-white p-7 shadow-2xl flex flex-col justify-between">
            <div>
              {/* Drawer Header */}
              <div className="flex items-start justify-between border-b border-slate-100 pb-5">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-md bg-violet-100 px-2.5 py-0.5 text-xs font-bold text-violet-700">
                      Call Intelligence
                    </span>
                    <span className="text-xs text-slate-400 font-mono">ID: {selected}</span>
                  </div>
                  <h2 className="mt-2 text-2xl font-bold text-slate-900">
                    {call.data?.lead_name || 'Call Details'}
                  </h2>
                  <p className="text-xs font-mono text-slate-500">
                    {call.data?.phone} · Started: {formatDate(call.data?.started_at)}
                  </p>
                </div>
                <button
                  onClick={() => setSelected(null)}
                  className="rounded-xl border border-slate-200 p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition"
                  data-testid="button-close-call"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Audio Recording & Waveform Player */}
              <div className="my-5 rounded-2xl border border-violet-100 bg-gradient-to-br from-violet-50/90 via-purple-50/40 to-slate-50 p-5 shadow-2xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Volume2 size={16} className="text-violet-600" />
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                      Call Audio Recording
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {(['1x', '1.25x', '1.5x'] as const).map((spd) => (
                      <button
                        key={spd}
                        onClick={() => setPlaybackSpeed(spd)}
                        className={`rounded-md px-2 py-0.5 text-[10px] font-bold transition ${
                          playbackSpeed === spd
                            ? 'bg-violet-600 text-white'
                            : 'bg-white text-slate-600 border border-slate-200'
                        }`}
                      >
                        {spd}
                      </button>
                    ))}
                    <button
                      title="Download Audio"
                      className="rounded-md bg-white border border-slate-200 p-1 text-slate-500 hover:text-violet-600"
                    >
                      <Download size={12} />
                    </button>
                  </div>
                </div>

                {/* Scrubber bar */}
                <div className="mt-4 flex items-center gap-3">
                  <button
                    onClick={() => setIsPlaying(!isPlaying)}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white shadow-xs transition hover:bg-violet-700 active:scale-95"
                    data-testid="button-play-recording"
                  >
                    {isPlaying ? <Pause size={17} /> : <Play size={17} className="ml-0.5" />}
                  </button>

                  <div className="flex-1">
                    <div className="relative h-2 w-full rounded-full bg-slate-200 overflow-hidden cursor-pointer">
                      <div
                        className="h-full bg-violet-600 rounded-full transition-all duration-150"
                        style={{ width: `${isPlaying ? 68 : audioProgress}%` }}
                      />
                    </div>
                    <div className="mt-1 flex justify-between text-[11px] font-mono text-slate-400">
                      <span>{isPlaying ? '01:14' : '00:25'}</span>
                      <span>
                        {call.data?.duration_seconds
                          ? `${Math.floor(call.data.duration_seconds / 60)}:${(call.data.duration_seconds % 60).toString().padStart(2, '0')}`
                          : '04:56'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Extracted Key Signals */}
              <div className="grid grid-cols-3 gap-3 mb-6">
                <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-center">
                  <span className="text-[10px] uppercase font-bold text-slate-400">Sentiment</span>
                  <p className="mt-1 text-xs font-bold text-emerald-600">Positive (94%)</p>
                </div>
                <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-center">
                  <span className="text-[10px] uppercase font-bold text-slate-400">Intent</span>
                  <p className="mt-1 text-xs font-bold text-violet-600">Ready to View</p>
                </div>
                <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-center">
                  <span className="text-[10px] uppercase font-bold text-slate-400">Appointment</span>
                  <p className="mt-1 text-xs font-bold text-slate-800">
                    {call.data?.booked ? 'Booked' : 'Handoff'}
                  </p>
                </div>
              </div>

              {/* Conversational Turn-by-Turn Transcript */}
              <div>
                <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
                  <div className="flex items-center gap-2">
                    <FileText size={16} className="text-violet-600" />
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                      Full Dialogue Transcript
                    </h3>
                  </div>
                  <span className="text-[11px] text-slate-400 font-mono">7 turns</span>
                </div>

                <div className="space-y-4 pr-1">
                  {transcript.map((item, idx) => (
                    <div
                      key={idx}
                      className={`flex flex-col ${item.role === 'user' ? 'items-end' : 'items-start'}`}
                    >
                      <div className="flex items-center gap-2 mb-1 px-1">
                        <span className="text-[11px] font-bold text-slate-600">
                          {item.speaker}
                        </span>
                        <span className="text-[10px] font-mono text-slate-400">· {item.time}</span>
                      </div>
                      <div
                        className={`max-w-[90%] rounded-2xl px-4 py-3 text-xs leading-relaxed ${
                          item.role === 'agent'
                            ? 'bg-violet-50/80 border border-violet-100 text-slate-800 rounded-tl-sm'
                            : 'bg-slate-100 text-slate-800 rounded-tr-sm border border-slate-200/60'
                        }`}
                      >
                        {item.text}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Bottom Actions if failed or retriable */}
            {call.data && ['uncertain', 'failed', 'policy_blocked'].includes(call.data.status) && (
              <div className="mt-6 border-t border-slate-100 pt-4">
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
                  <span>Retry Call</span>
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
