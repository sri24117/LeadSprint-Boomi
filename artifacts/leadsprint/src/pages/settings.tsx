import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Loader2,
  PhoneCall,
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
import { Badge, Button, ErrorState, PageHeader, Section, Select, Skeleton, Toggle, TextArea, Input } from '@/components/common';
import { SetupChecklist } from '@/components/setup-checklist';

function Field({
  label,
  value,
  onChange,
  disabled,
  testId,
  hint,
}: {
  label: string;
  value: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  testId: string;
  hint?: string;
}) {
  return (
    <div className="space-y-2">
      <label className="block text-xs font-semibold text-[hsl(var(--muted-foreground))]">
        {label}
      </label>
      <Input
        value={value || ''}
        onChange={(event) => onChange?.(event.target.value)}
        disabled={disabled}
        className="w-full"
        data-testid={testId}
      />
      {hint && <p className="text-[11px] text-[hsl(var(--muted-foreground))]">{hint}</p>}
    </div>
  );
}

function ServiceRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <span className="text-sm text-[hsl(var(--foreground))]">{label}</span>
      {value ? (
        <Badge className="border-[hsl(var(--success))/0.35] bg-[hsl(var(--success))/0.08] text-[hsl(var(--success))]">
          <Check size={12} className="mr-1.5" />
          Connected
        </Badge>
      ) : (
        <Badge className="border-[#e2e8f0]/0.5 bg-[#f8fafc] text-[#475569]">Not configured</Badge>
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
  const [zipText, setZipText] = useState<string | null>(null);

  if (settings.isLoading) {
    return (
      <div className="space-y-4">
        <PageHeader eyebrow="Console" title="Settings" />
        <Skeleton className="h-10 w-1/3" />
        <Skeleton className="mt-4 h-[300px] w-full" />
      </div>
    );
  }

  if (settings.isError || !settings.data) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow="Console" title="Settings" />
        <ErrorState retry={() => settings.refetch()} />
      </div>
    );
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
      vertical: data.vertical,
      notify_email: (data.notify_email ?? '').trim() || null,
      service_area_zips: data.service_area_zips ?? [],
      pricing_policy: (data.pricing_policy ?? '').trim() || null,
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
      <PageHeader
        eyebrow="Console"
        title="Settings"
        description="These settings gate what the operator console is allowed to do."
        action={
          <Button variant="primary" type="submit" disabled={update.isPending} data-testid="button-save-settings">
            {update.isPending && <Loader2 size={15} className="animate-spin" />}
            {update.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        }
      />
      {update.isError && (
        <p
          role="alert"
          className="rounded-lg border border-[hsl(var(--destructive))/0.4] bg-[hsl(var(--destructive))/0.08] px-4 py-3 text-sm text-[hsl(var(--destructive))]"
          data-testid="text-save-error"
        >
          Not saved: {(update.error as any)?.data?.error ?? update.error?.message ?? 'the server rejected these settings.'}
        </p>
      )}
      <SetupChecklist compact />

      <Section
        title="Business context"
        description="How LeadSprint speaks for your desk."
      >
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="Business name" value={data.name} disabled testId="input-business-name" />
          <Field
            label="Project / desk name"
            value={data.project_name}
            onChange={(value) => set('project_name', value)}
            testId="input-project-name"
          />
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-[hsl(var(--muted-foreground))]">Market</label>
            <Select
              value={data.market}
              onChange={(event) => set('market', event.target.value)}
              className="w-full"
              data-testid="select-market"
            >
              <option value="US">United States</option>
              <option value="IN">India</option>
            </Select>
          </div>
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
            label="Quiet hours (24h, e.g. 21:00-08:00; calls never before 08:00 or after 20:00)"
            value={data.quiet_hours}
            onChange={(value) => set('quiet_hours', value)}
            testId="input-quiet-hours"
            hint="Outside these hours the assistant will not place outbound calls."
          />
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-[hsl(var(--muted-foreground))]">Industry</label>
            <Select
              value={data.vertical ?? 'real_estate'}
              onChange={(event) => set('vertical', event.target.value)}
              className="w-full"
              data-testid="select-vertical"
            >
              <option value="real_estate">Real estate</option>
              <option value="home_services">Home services (AC &amp; plumbing)</option>
            </Select>
          </div>
          {data.vertical && data.vertical !== 'real_estate' && (
            <>
              <Field
                label="Emergency alert email"
                value={data.notify_email ?? ''}
                onChange={(value) => set('notify_email', value)}
                testId="input-notify-email"
              />
              <Field
                label="Service area ZIPs (comma-separated; 3 to 5 digits, e.g. 787, 78660)"
                value={zipText ?? (data.service_area_zips ?? []).join(', ')}
                onChange={(value) => {
                  setZipText(value);
                  set('service_area_zips', value.split(/[\s,]+/).filter(Boolean));
                }}
                testId="input-service-area"
              />
              <div className="sm:col-span-2">
                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-[hsl(var(--muted-foreground))]">
                    What the assistant may say about cost (leave empty to say a technician will confirm)
                  </label>
                  <TextArea
                    value={data.pricing_policy ?? ''}
                    onChange={(value) => set('pricing_policy', value)}
                    testId="input-pricing-policy"
                    className="w-full"
                    rows={4}
                  />
                </div>
              </div>
            </>
          )}
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
      </Section>

      <Section title="Policy controls" description="Guardrails for safe follow-through.">
        <div className="mt-5 space-y-4">
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-[hsl(var(--muted-foreground))]">Maximum call attempts</label>
            <Input
              type="number"
              min="1"
              max="10"
              value={data.max_call_attempts}
              onChange={(event) => set('max_call_attempts', event.target.value)}
              className="w-full"
              data-testid="input-max-attempts"
            />
          </div>
          <div className="rounded-lg border border-[hsl(var(--border))] p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Connected services</p>
            <div className="mt-3 space-y-2">
              <ServiceRow label="Retell agent" value={data.retell_agent_id} />
              <ServiceRow label="Cal.com event type" value={data.cal_event_type_id} />
            </div>
          </div>

          <div className="rounded-lg border border-[hsl(var(--primary))/0.35] bg-[hsl(var(--primary))/0.06] p-4">
            <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[hsl(var(--primary))]">
              <PhoneCall size={14} /> Test AI voice call
            </p>
            <p className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">
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
                className="min-w-0 flex-1 rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 py-2 text-[11px] outline-none focus:border-[hsl(var(--primary))] focus:ring-1 focus:ring-[hsl(var(--primary))]"
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
                {testStatus === 'calling' ? 'Calling…' : 'Call my phone'}
              </Button>
            </div>
            {testMessage && (
              <div className={`mt-2.5 flex items-center gap-1.5 text-xs font-medium ${
                testStatus === 'success'
                  ? 'text-[hsl(var(--success))]'
                  : testStatus === 'error'
                    ? 'text-[hsl(var(--destructive))]'
                    : 'text-[hsl(var(--muted-foreground))]'
              }`} data-testid="text-test-call-status">
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
      </Section>

      <Section title="Approved language" description="Keep the assistant inside the lines your team trusts.">
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-[hsl(var(--muted-foreground))]">Approved FAQ</label>
            <TextArea
              value={data.approved_faq}
              onChange={(value) => set('approved_faq', value)}
              testId="textarea-approved-faq"
              className="w-full"
              rows={5}
            />
          </div>
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-[hsl(var(--muted-foreground))]">Qualification questions</label>
            <TextArea
              value={(data.qualification_questions || []).join('\n')}
              onChange={(event) => set('qualification_questions', event.target.value.split('\n').filter(Boolean))}
              className="w-full"
              rows={5}
            />
          </div>
        </div>
        <div className="mt-5 space-y-2">
          <label className="block text-xs font-semibold text-[hsl(var(--muted-foreground))]">Escalation rules</label>
          <TextArea
            value={data.escalation_rules}
            disabled
            testId="textarea-escalation"
            className="w-full"
            rows={4}
          />
        </div>
      </Section>
    </form>
  );
}
