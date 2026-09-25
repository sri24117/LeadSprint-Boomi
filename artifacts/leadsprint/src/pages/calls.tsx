import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Headphones,
  Loader2,
  MoreHorizontal,
  RefreshCw,
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

export default function CallsPage() {
  const [status, setStatus] = useState('all');
  const [selected, setSelected] = useState<string | null>(null);
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
          <Skeleton key={n} className="h-24" />
        ))}
      </div>
    );
  }

  if (calls.isError) {
    return <ErrorState retry={() => calls.refetch()} />;
  }

  return (
    <div className="animate-rise-in space-y-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm text-muted-foreground">Provider events, operator decisions, and the human-readable result.</p>
        </div>
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="w-fit rounded-lg border border-input bg-[hsl(var(--card))] px-3 py-2 text-sm"
          data-testid="select-call-status"
        >
          <option value="all">All call states</option>
          <option value="queued">Queued</option>
          <option value="in_progress">In progress</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="uncertain">Uncertain</option>
          <option value="policy_blocked">Policy blocked</option>
        </select>
      </div>

      {!calls.data?.length ? (
        <EmptyState
          icon={Headphones}
          title="No calls in this window"
          description="When a lead is called, provider state and outcome will be kept here."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-[hsl(var(--card))]">
          <div className="hidden grid-cols-[1.25fr_1fr_1fr_1fr_1.4fr_40px] gap-4 border-b border-border bg-[hsl(var(--muted)/.55)] px-5 py-3 text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground md:grid">
            <span>Lead</span>
            <span>Provider</span>
            <span>State</span>
            <span>Duration</span>
            <span>Outcome</span>
            <span />
          </div>
          <div className="divide-y divide-border">
            {calls.data.map((item) => (
              <div
                key={item.id}
                className="grid gap-3 px-4 py-4 md:grid-cols-[1.25fr_1fr_1fr_1fr_1.4fr_40px] md:items-center md:gap-4 md:px-5"
                data-testid={`row-call-${item.id}`}
              >
                <div>
                  <button
                    onClick={() => setSelected(item.id)}
                    className="text-left text-sm font-bold hover:text-[hsl(var(--accent))]"
                    data-testid={`button-open-call-${item.id}`}
                  >
                    {item.lead_name}
                  </button>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {item.phone} · {formatDate(item.started_at)}
                  </p>
                </div>
                <div className="text-sm">
                  <span className="font-medium">{item.provider}</span>
                  {item.transferred && <span className="ml-2 text-[11px] text-[hsl(var(--accent))]">Transferred</span>}
                </div>
                <div>
                  <Badge className={statusTone(item.status)}>{item.status.replaceAll('_', ' ')}</Badge>
                </div>
                <div className="font-mono text-xs text-muted-foreground">
                  {item.duration_seconds
                    ? `${Math.floor(item.duration_seconds / 60)}m ${item.duration_seconds % 60}s`
                    : '—'}
                </div>
                <div>
                  <p className="line-clamp-2 text-sm">{item.outcome || item.summary || 'No outcome recorded'}</p>
                  {item.error_state && <p className="mt-1 text-xs text-[hsl(var(--destructive))]">{item.error_state}</p>}
                </div>
                <button
                  className="rounded-lg p-2 text-muted-foreground hover:bg-[hsl(var(--muted))]"
                  onClick={() => setSelected(item.id)}
                  data-testid={`button-call-menu-${item.id}`}
                >
                  <MoreHorizontal size={16} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {selected && (
        <div
          className="fixed inset-0 z-40 flex justify-end bg-[#102632]/30"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelected(null);
          }}
        >
          <div className="h-full w-full max-w-[510px] overflow-y-auto bg-[hsl(var(--card))] p-6">
            <div className="flex justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[.18em] text-[hsl(var(--accent))]">Call detail</p>
                <h2 className="mt-1 text-2xl font-bold">{call.data?.lead_name || 'Call'}</h2>
              </div>
              <button onClick={() => setSelected(null)} data-testid="button-close-call">
                <X size={18} />
              </button>
            </div>

            {call.isLoading ? (
              <div className="mt-8 space-y-3">
                <Skeleton className="h-24" />
                <Skeleton className="h-40" />
              </div>
            ) : (
              call.data && (
                <>
                  <div className="mt-6 grid grid-cols-2 gap-3">
                    <Info label="State" value={call.data.status.replaceAll('_', ' ')} />
                    <Info label="Provider" value={call.data.provider} />
                    <Info label="Started" value={formatTime(call.data.started_at)} />
                    <Info label="Duration" value={call.data.duration_seconds ? `${call.data.duration_seconds}s` : '—'} />
                  </div>
                  <div className="mt-6 rounded-xl bg-[hsl(var(--muted)/.55)] p-4">
                    <p className="text-[10px] font-bold uppercase tracking-[.15em] text-muted-foreground">Summary</p>
                    <p className="mt-2 text-sm leading-6">{call.data.summary || 'No summary recorded.'}</p>
                  </div>
                  <div className="mt-4 flex gap-2">
                    <Badge className={call.data.booked ? statusTone('confirmed') : statusTone('created')}>
                      {call.data.booked ? 'Appointment booked' : 'No booking'}
                    </Badge>
                    {call.data.transferred && <Badge className={statusTone('qualified')}>Transferred</Badge>}
                  </div>
                </>
              )
            )}

            {call.data?.error_state && (
              <div className="mt-5 rounded-lg border border-[hsl(var(--destructive)/.25)] p-4 text-sm text-[hsl(var(--destructive))]">
                <AlertTriangle size={15} className="mr-2 inline" />
                {call.data.error_state}
              </div>
            )}

            {call.data && ['uncertain', 'failed', 'policy_blocked'].includes(call.data.status) ? (
              <div className="mt-7">
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
                  data-testid="button-retry-call"
                >
                  {retryCall.isPending ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                  {call.data.status === 'uncertain' ? 'Reconcile and retry' : 'Retry call'}
                </Button>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  {call.data.status === 'uncertain'
                    ? 'The provider never confirmed this call. Retrying queues a fresh attempt; the safety policy is checked again first.'
                    : 'Queues a fresh attempt. Consent, suppression, quiet hours and the attempt limit are all re-checked before dialling.'}
                </p>
                {retryCall.isError && (
                  <p className="mt-2 text-xs text-[hsl(var(--destructive))]" data-testid="text-retry-error">
                    The retry could not be started. It may be blocked by policy or by incomplete setup.
                  </p>
                )}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
