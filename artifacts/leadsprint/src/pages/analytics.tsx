import { useState } from 'react';
import {
  Activity,
  Calendar,
  CheckCircle2,
  PhoneCall,
  TrendingUp,
} from 'lucide-react';
import { PageHeader, Section, SectionBody } from '@/components/common';

export default function AnalyticsPage() {
  const [timeRange, setTimeRange] = useState('7d');

  return (
    <div className="animate-rise-in space-y-6">
      <PageHeader
        eyebrow="Console"
        title="Analytics"
        description="Conversion funnels, speech latency, call sentiment, and quota usage."
      />

      <div className="flex items-center gap-2">
        {(['24h', '7d', '30d'] as const).map((range) => (
          <button
            key={range}
            onClick={() => setTimeRange(range)}
            className={`rounded-md border px-3.5 py-1.5 text-xs font-semibold transition ${
              timeRange === range
                ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]'
                : 'border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]'
            }`}
          >
            {range === '24h' ? 'Last 24 hours' : range === '7d' ? 'Last 7 days' : 'Last 30 days'}
          </button>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Section>
          <SectionBody>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Total calls placed</span>
              <PhoneCall size={15} className="text-[hsl(var(--primary))]" />
            </div>
            <p className="mt-3 text-2xl font-bold text-[hsl(var(--foreground))]">42</p>
            <div className="mt-2 flex items-center gap-1.5 text-xs font-bold text-[hsl(var(--success))]">
              <TrendingUp size={13} />
              <span>+18% from last period</span>
            </div>
          </SectionBody>
        </Section>
        <Section>
          <SectionBody>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Pickup &amp; connect</span>
              <Activity size={15} className="text-[hsl(var(--success))]" />
            </div>
            <p className="mt-3 text-2xl font-bold text-[hsl(var(--foreground))]">91.4%</p>
            <div className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">Average 2.4 rings to answer</div>
          </SectionBody>
        </Section>
        <Section>
          <SectionBody>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">AI qualification rate</span>
              <CheckCircle2 size={15} className="text-[hsl(var(--success))]" />
            </div>
            <p className="mt-3 text-2xl font-bold text-[hsl(var(--foreground))]">84.2%</p>
            <div className="mt-2 text-xs text-[hsl(var(--success))]">Budget &amp; location confirmed</div>
          </SectionBody>
        </Section>
        <Section>
          <SectionBody>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Showings scheduled</span>
              <Calendar size={15} className="text-[hsl(var(--muted-foreground))]" />
            </div>
            <p className="mt-3 text-2xl font-bold text-[hsl(var(--foreground))]">14</p>
            <div className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">Verified via Cal.com</div>
          </SectionBody>
        </Section>
      </div>

      <div className="grid gap-5 lg:grid-cols-12">
        {/* Qualification conversion funnel */}
        <Section
          className="lg:col-span-7"
          title="Lead-to-showing conversion funnel"
          description="Progression from raw inbound property inquiry to qualified conversation."
        >
          <div className="space-y-4">
            {[
              { label: '1. Inbound leads intake (web / Zillow)', value: '42 leads (100%)', width: '100%' },
              { label: '2. Outbound telephony pickup (answered)', value: '38 calls (90.4%)', width: '90%' },
              { label: '3. Qualified by Sara AI (budget, timeline, location)', value: '32 qualified (76.1%)', width: '76%' },
              { label: '4. In-person showing / agent handoff', value: '14 scheduled (33.3%)', width: '33%' },
            ].map((step, index) => (
              <div key={index}>
                <div className="mb-1.5 flex justify-between text-xs">
                  <span className="font-semibold text-[hsl(var(--foreground))]">{step.label}</span>
                  <span className="font-mono text-[hsl(var(--muted-foreground))]">{step.value}</span>
                </div>
                <div className="h-2 rounded-full overflow-hidden bg-[hsl(var(--muted))]">
                  <div className="h-full bg-[hsl(var(--primary))]" style={{ width: step.width }} />
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* Safety & compliance engine audit */}
        <Section
          className="lg:col-span-5"
          title="Safety gate audit"
          description="Autonomous enforcement before every single outbound connection."
        >
          <div className="space-y-3">
            {[
              { gate: 'Consent gate (TCPA/TRAI)', status: 'Pass', detail: 'Valid evidence on all 42 records' },
              { gate: 'Suppression list (DNC)', status: 'Pass', detail: '0 dialed on suppression block' },
              { gate: 'Quiet hours enforcement', status: 'Pass', detail: 'Local recipient timezone respected' },
              { gate: 'Usage &amp; minute limits', status: 'Pass', detail: '18.4 / 500 mins used this period' },
              { gate: 'Attempt limit (max 3)', status: 'Pass', detail: '0 leads exceeded dialing caps' },
              { gate: 'Global kill switch', status: 'Nominal', detail: 'Armed and ready' },
            ].map((item, idx) => (
              <div key={idx} className="flex items-center justify-between rounded-lg border border-[hsl(var(--border))] p-3">
                <div>
                  <p className="text-xs font-semibold text-[hsl(var(--foreground))]">{item.gate}</p>
                  <p className="text-[10px] text-[hsl(var(--muted-foreground))]">{item.detail}</p>
                </div>
                <span className="rounded-full border px-2.5 py-0.5 text-[10px] font-bold border-[hsl(var(--success))/0.35] bg-[hsl(var(--success))/0.08] text-[hsl(var(--success))]">
                  {item.status}
                </span>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}
