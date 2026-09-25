import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Loader2,
  MessageSquare,
  PhoneCall,
  ShieldCheck,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react';
import {
  getGetBusinessSettingsQueryKey,
  getGetCallsQueryKey,
  getGetLeadsQueryKey,
  useGetBusinessSettings,
  useImportLeads,
  useStartCall,
  useUpdateBusinessSettings,
} from '@workspace/api-client-react';
import { Badge, Button, ErrorState, Skeleton } from '@/components/common';
import { SetupChecklist } from '@/components/setup-checklist';

function SectionTitle({ icon: Icon, title, detail }: { icon: LucideIcon; title: string; detail: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="rounded-lg bg-[hsl(var(--accent)/.1)] p-2 text-[hsl(var(--accent))]">
        <Icon size={17} />
      </div>
      <div>
        <h2 className="font-bold">{title}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  disabled,
  testId,
}: {
  label: string;
  value: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  testId: string;
}) {
  return (
    <label className="block text-sm font-semibold">
      {label}
      <input
        value={value || ''}
        onChange={(event) => onChange?.(event.target.value)}
        disabled={disabled}
        className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-[hsl(var(--accent))] disabled:bg-[hsl(var(--muted)/.5)] disabled:text-muted-foreground"
        data-testid={testId}
      />
    </label>
  );
}

function TextArea({
  label,
  value,
  onChange,
  disabled,
  testId,
}: {
  label: string;
  value: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  testId: string;
}) {
  return (
    <label className="block text-sm font-semibold">
      {label}
      <textarea
        value={value || ''}
        onChange={(event) => onChange?.(event.target.value)}
        disabled={disabled}
        rows={5}
        className="mt-2 w-full resize-y rounded-lg border border-input bg-background px-3 py-2.5 text-sm leading-6 outline-none focus:border-[hsl(var(--accent))] disabled:bg-[hsl(var(--muted)/.5)]"
        data-testid={testId}
      />
    </label>
  );
}

function Toggle({
  label,
  detail,
  checked,
  onChange,
  testId,
}: {
  label: string;
  detail: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-center justify-between rounded-lg border border-border p-3 text-left transition hover:bg-[hsl(var(--muted)/.5)]"
      data-testid={testId}
    >
      <span>
        <span className="block text-sm font-semibold">{label}</span>
        <span className="mt-1 block text-xs font-normal text-muted-foreground">{detail}</span>
      </span>
      <span
        className={`relative h-5 w-9 rounded-full transition-colors ${
          checked ? 'bg-[hsl(var(--accent))]' : 'bg-[hsl(var(--border))]'
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-[hsl(var(--card))] shadow transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </span>
    </button>
  );
}

function ServiceRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm font-medium">{label}</span>
      {value ? (
        <Badge className="bg-[hsl(var(--accent)/.12)] text-[hsl(var(--accent))]">
          <Check size={12} className="mr-1" />
          Connected
        </Badge>
      ) : (
        <Badge className="bg-[hsl(var(--secondary)/.28)] text-[hsl(var(--primary))]">Not configured</Badge>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const settings = useGetBusinessSettings();
  const update = useUpdateBusinessSettings();
  const importLeads = useImportLeads();
  const startCall = useStartCall();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<any>(null);
  const [testPhone, setTestPhone] = useState('');
  const [testStatus, setTestStatus] = useState<'idle' | 'calling' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState<string | null>(null);

  if (settings.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (settings.isError || !settings.data) {
    return <ErrorState retry={() => settings.refetch()} />;
  }

  const data = draft || settings.data;
  const set = (key: string, value: any) =>
    setDraft((current: any) => ({ ...(current || settings.data), [key]: value }));

  const save = (event: FormEvent) => {
    event.preventDefault();
    const payload = {
      market: data.market,
      timezone: data.timezone,
      transfer_number: data.transfer_number,
      project_name: data.project_name,
      approved_faq: data.approved_faq,
      qualification_questions: data.qualification_questions,
      recording_disclosure: data.recording_disclosure,
      ai_disclosure: data.ai_disclosure,
      quiet_hours: data.quiet_hours,
      max_call_attempts: Number(data.max_call_attempts),
    };
    update.mutate(
      { data: payload },
      {
        onSuccess: (updated) => {
          setDraft(updated);
          queryClient.setQueryData(getGetBusinessSettingsQueryKey(), updated);
        },
      },
    );
  };

  const handleSendTestCall = () => {
    const phoneToCall = testPhone.trim() || data.transfer_number?.trim();
    if (!phoneToCall) {
      setTestStatus('error');
      setTestMessage('Please enter a phone number to test.');
      return;
    }
    setTestStatus('calling');
    setTestMessage('Registering test lead and dispatching call…');

    importLeads.mutate(
      {
        data: {
          rows: [
            {
              name: 'Operator Voice Test',
              phone: phoneToCall,
              project: data.project_name || 'Pilot project',
              property_type: 'Voice quality check',
              budget_label: '$750k',
              timeline: 'Immediate',
              source: 'Settings voice test',
            },
          ],
          consent_status: 'valid',
          consent_source: 'Operator manual voice test authorization',
        },
      },
      {
        onSuccess: (res: any) => {
          const leadId = res?.leads?.[0]?.id;
          if (leadId) {
            startCall.mutate(
              { data: { lead_id: leadId } },
              {
                onSuccess: () => {
                  setTestStatus('success');
                  setTestMessage(`Call dispatched to ${phoneToCall}! Pick up to test the AI voice agent.`);
                  queryClient.invalidateQueries({ queryKey: getGetCallsQueryKey() });
                  queryClient.invalidateQueries({ queryKey: getGetLeadsQueryKey() });
                },
                onError: (err: any) => {
                  setTestStatus('error');
                  setTestMessage(err?.message || 'Call blocked: Check quiet hours or if Retell credentials are configured.');
                },
              },
            );
          } else {
            setTestStatus('error');
            setTestMessage('Could not register test contact.');
          }
        },
        onError: (err: any) => {
          setTestStatus('error');
          setTestMessage(err?.message || 'Failed to initiate test call.');
        },
      },
    );
  };

  return (
    <form onSubmit={save} className="animate-rise-in space-y-6">
      <SetupChecklist />
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm text-muted-foreground">These settings gate what the operator console is allowed to do.</p>
        </div>
        <Button variant="primary" type="submit" disabled={update.isPending} data-testid="button-save-settings">
          {update.isPending && <Loader2 size={15} className="animate-spin" />}
          {update.isPending ? 'Saving…' : 'Save changes'}
        </Button>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.2fr_.8fr]">
        <section className="rounded-xl border border-border bg-[hsl(var(--card))] p-5">
          <SectionTitle
            icon={SlidersHorizontal}
            title="Business context"
            detail="How LeadSprint speaks for your desk."
          />
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <Field label="Business name" value={data.name} disabled testId="input-business-name" />
            <Field
              label="Project / desk name"
              value={data.project_name}
              onChange={(value) => set('project_name', value)}
              testId="input-project-name"
            />
            <label className="block text-sm font-semibold">
              Market
              <select
                value={data.market}
                onChange={(event) => set('market', event.target.value)}
                className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm"
                data-testid="select-market"
              >
                <option value="US">United States</option>
                <option value="IN">India</option>
              </select>
            </label>
            <Field
              label="Timezone"
              value={data.timezone}
              onChange={(value) => set('timezone', value)}
              testId="input-timezone"
            />
            <Field
              label="Transfer number"
              value={data.transfer_number}
              onChange={(value) => set('transfer_number', value)}
              testId="input-transfer-number"
            />
            <Field
              label="Quiet hours"
              value={data.quiet_hours}
              onChange={(value) => set('quiet_hours', value)}
              testId="input-quiet-hours"
            />
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <Toggle
              label="Recording disclosure"
              detail="Tell the caller when calls are recorded."
              checked={data.recording_disclosure}
              onChange={(value) => set('recording_disclosure', value)}
              testId="toggle-recording"
            />
            <Toggle
              label="AI disclosure"
              detail="Make the assistant identity clear."
              checked={data.ai_disclosure}
              onChange={(value) => set('ai_disclosure', value)}
              testId="toggle-ai"
            />
          </div>
        </section>

        <section className="rounded-xl border border-border bg-[hsl(var(--card))] p-5">
          <SectionTitle icon={ShieldCheck} title="Policy controls" detail="Guardrails for safe follow-through." />
          <div className="mt-6 space-y-4">
            <label className="block text-sm font-semibold">
              Maximum call attempts
              <input
                type="number"
                min="1"
                max="10"
                value={data.max_call_attempts}
                onChange={(event) => set('max_call_attempts', event.target.value)}
                className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm"
                data-testid="input-max-attempts"
              />
            </label>
            <div className="rounded-lg bg-[hsl(var(--muted)/.6)] p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Connected services</p>
              <div className="mt-4 space-y-3">
                <ServiceRow label="Retell agent" value={data.retell_agent_id} />
                <ServiceRow label="Cal.com event type" value={data.cal_event_type_id} />
              </div>
            </div>

            <div className="rounded-lg border border-[hsl(var(--accent)/.35)] bg-[hsl(var(--accent)/.05)] p-4">
              <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[hsl(var(--accent))]">
                <PhoneCall size={14} /> Test AI Voice Call
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Dial your personal phone to experience the AI voice quality, response latency, and qualification script.
              </p>
              <div className="mt-3 flex gap-2">
                <input
                  type="tel"
                  value={testPhone}
                  onChange={(e) => {
                    setTestPhone(e.target.value);
                    if (testStatus !== 'idle') setTestStatus('idle');
                  }}
                  placeholder={data.transfer_number || '+19175550188'}
                  className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2 text-xs outline-none focus:border-[hsl(var(--accent))]"
                  data-testid="input-test-phone"
                />
                <Button
                  type="button"
                  variant="primary"
                  onClick={handleSendTestCall}
                  disabled={testStatus === 'calling' || importLeads.isPending || startCall.isPending}
                  className="shrink-0 text-xs"
                  data-testid="button-test-call"
                >
                  {testStatus === 'calling' ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <PhoneCall size={13} />
                  )}
                  {testStatus === 'calling' ? 'Calling…' : 'Call My Phone'}
                </Button>
              </div>
              {testMessage && (
                <div
                  className={`mt-2.5 flex items-center gap-1.5 text-xs font-medium ${
                    testStatus === 'success'
                      ? 'text-[hsl(var(--accent))]'
                      : testStatus === 'error'
                        ? 'text-[hsl(var(--destructive))]'
                        : 'text-muted-foreground'
                  }`}
                  data-testid="text-test-call-status"
                >
                  {testStatus === 'success' ? (
                    <CheckCircle2 size={13} className="shrink-0" />
                  ) : testStatus === 'error' ? (
                    <AlertTriangle size={13} className="shrink-0" />
                  ) : null}
                  <span>{testMessage}</span>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      <section className="rounded-xl border border-border bg-[hsl(var(--card))] p-5">
        <SectionTitle
          icon={MessageSquare}
          title="Approved language"
          detail="Keep the assistant inside the lines your team trusts."
        />
        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          <TextArea
            label="Approved FAQ"
            value={data.approved_faq}
            onChange={(value) => set('approved_faq', value)}
            testId="textarea-approved-faq"
          />
          <TextArea
            label="Qualification questions"
            value={(data.qualification_questions || []).join('\n')}
            onChange={(value) => set('qualification_questions', value.split('\n').filter(Boolean))}
            testId="textarea-qualification"
          />
        </div>
        <div className="mt-5">
          <TextArea label="Escalation rules" value={data.escalation_rules} disabled testId="textarea-escalation" />
        </div>
      </section>
    </form>
  );
}
