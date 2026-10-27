import { useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  BarChart2,
  Calendar,
  CheckCircle2,
  Clock,
  Filter,
  Headphones,
  PhoneCall,
  ShieldCheck,
  TrendingUp,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/common';

export default function AnalyticsPage() {
  const [timeRange, setTimeRange] = useState('7d');

  return (
    <div className="animate-rise-in space-y-6">
      {/* Header filter */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-base font-bold text-slate-800">Operational & Speech Intelligence</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Real-time telemetry, conversational qualification yield, and regulatory safety logs.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {(['24h', '7d', '30d'] as const).map((range) => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={`rounded-xl px-3.5 py-1.5 text-xs font-semibold shadow-2xs transition ${
                timeRange === range
                  ? 'bg-violet-600 text-white'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              {range === '24h' ? 'Last 24 Hours' : range === '7d' ? 'Last 7 Days' : 'Last 30 Days'}
            </button>
          ))}
        </div>
      </div>

      {/* Primary KPI Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total Calls Placed</span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
              <PhoneCall size={16} />
            </span>
          </div>
          <p className="mt-3 text-3xl font-bold text-slate-900">42</p>
          <div className="mt-2 flex items-center gap-1.5 text-xs font-medium text-emerald-600">
            <TrendingUp size={13} />
            <span>+18% from last period</span>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Pickup & Connect</span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
              <Activity size={16} />
            </span>
          </div>
          <p className="mt-3 text-3xl font-bold text-slate-900">91.4%</p>
          <div className="mt-2 text-xs text-slate-500">
            <span>Average 2.4 rings to answer</span>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">AI Qualification Rate</span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-purple-100 text-purple-700">
              <CheckCircle2 size={16} />
            </span>
          </div>
          <p className="mt-3 text-3xl font-bold text-slate-900">84.2%</p>
          <div className="mt-2 text-xs text-emerald-600 font-medium">
            <span>Budget & location confirmed</span>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Showings Scheduled</span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
              <Calendar size={16} />
            </span>
          </div>
          <p className="mt-3 text-3xl font-bold text-slate-900">14</p>
          <div className="mt-2 text-xs text-slate-500">
            <span>Verified via Cal.com</span>
          </div>
        </div>
      </div>

      {/* Conversion Funnel & Volume Breakdown */}
      <div className="grid gap-6 lg:grid-cols-12">
        {/* Qualification Conversion Funnel */}
        <div className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs lg:col-span-7">
          <div className="border-b border-slate-100 pb-3">
            <h3 className="text-sm font-bold text-slate-800">Lead-to-Showing Conversion Funnel</h3>
            <p className="text-xs text-slate-500">Progression from raw inbound property inquiry to qualified conversation</p>
          </div>

          <div className="mt-5 space-y-4">
            <div>
              <div className="flex justify-between text-xs font-semibold text-slate-700 mb-1.5">
                <span>1. Inbound Leads Intake (Web / Zillow)</span>
                <span className="font-mono">42 leads (100%)</span>
              </div>
              <div className="h-3 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full bg-violet-600 rounded-full w-full" />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs font-semibold text-slate-700 mb-1.5">
                <span>2. Outbound Telephony Pickup (Answered)</span>
                <span className="font-mono">38 calls (90.4%)</span>
              </div>
              <div className="h-3 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full bg-indigo-500 rounded-full w-[90%]" />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs font-semibold text-slate-700 mb-1.5">
                <span>3. Qualified by Sara AI (Budget, Timeline, Loc)</span>
                <span className="font-mono">32 qualified (76.1%)</span>
              </div>
              <div className="h-3 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full bg-purple-500 rounded-full w-[76%]" />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs font-semibold text-slate-700 mb-1.5">
                <span>4. In-Person Showing / Agent Handoff</span>
                <span className="font-mono">14 scheduled (33.3%)</span>
              </div>
              <div className="h-3 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full bg-emerald-500 rounded-full w-[33%]" />
              </div>
            </div>
          </div>
        </div>

        {/* Safety & Compliance Engine Audit */}
        <div className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs lg:col-span-5">
          <div className="border-b border-slate-100 pb-3">
            <h3 className="text-sm font-bold text-slate-800">6-Gate Safety Engine Audit</h3>
            <p className="text-xs text-slate-500">Autonomous enforcement before every single outbound connection</p>
          </div>

          <div className="mt-4 space-y-3">
            {[
              { gate: 'Consent Gate (TCPA/TRAI)', status: 'PASS', detail: 'Valid evidence on all 42 records' },
              { gate: 'Suppression List (DNC)', status: 'PASS', detail: '0 dialed on suppression block' },
              { gate: 'Quiet Hours Enforcement', status: 'PASS', detail: 'Local recipient timezone respected' },
              { gate: 'Usage & Minute Limits', status: 'PASS', detail: '18.4 / 500 mins used this period' },
              { gate: 'Attempt Limit (Max 3)', status: 'PASS', detail: '0 leads exceeded dialing caps' },
              { gate: 'Global Kill Switch', status: 'NOMINAL', detail: 'Armed and ready' },
            ].map((item, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between rounded-xl bg-slate-50 p-2.5 border border-slate-150"
              >
                <div>
                  <p className="text-xs font-semibold text-slate-800">{item.gate}</p>
                  <p className="text-[10px] text-slate-400">{item.detail}</p>
                </div>
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200">
                  {item.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
