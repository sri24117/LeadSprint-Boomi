import { useState } from 'react';
import {
  Calendar,
  CheckCircle2,
  CreditCard,
  Download,
  ExternalLink,
  FileText,
  Phone,
  ShieldCheck,
  Sparkles,
  Wallet,
  Zap,
} from 'lucide-react';
import { Badge, Button } from '@/components/common';

export default function BillingPage() {
  const [minutesUsed, setMinutesUsed] = useState(18.4);
  const minutesQuota = 500;
  const percentage = Math.round((minutesUsed / minutesQuota) * 100);

  return (
    <div className="animate-rise-in space-y-6">
      {/* Current Plan Card */}
      <div className="rounded-2xl border border-violet-200/80 bg-gradient-to-r from-violet-50/90 via-purple-50/50 to-white p-6 shadow-xs">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-violet-600 px-2.5 py-0.5 text-xs font-bold text-white">
                Active Plan
              </span>
              <h2 className="text-xl font-bold text-slate-900">LeadSprint Managed Pilot</h2>
            </div>
            <p className="mt-1 text-sm text-slate-600">
              $500 Setup + $399/month · Single dedicated broker desk, 1 business phone number, and unlimited qualification logic.
            </p>
          </div>

          <div className="text-right">
            <span className="text-xs uppercase font-bold text-slate-400">Monthly Renewal</span>
            <p className="font-mono text-base font-bold text-slate-800">November 1, 2026</p>
          </div>
        </div>
      </div>

      {/* Quota & Usage Meter */}
      <div className="grid gap-6 lg:grid-cols-12">
        <div className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs lg:col-span-7">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Voice Telephony Quota</h3>
              <p className="text-xs text-slate-500">Real-time meter of billed voice minutes across Retell & Twilio carrier</p>
            </div>
            <span className="font-mono text-xs font-bold text-violet-700 bg-violet-50 px-2.5 py-1 rounded-lg">
              {percentage}% Consumed
            </span>
          </div>

          <div className="mt-6">
            <div className="flex justify-between text-xs font-semibold text-slate-700 mb-2">
              <span>Voice Minutes Talk Time</span>
              <span className="font-mono">{minutesUsed} / {minutesQuota} mins</span>
            </div>
            <div className="h-3 w-full rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-violet-600 transition-all duration-500"
                style={{ width: `${percentage}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-slate-400">
              Overage rate beyond 500 mins is billed at $0.14/minute. You have 481.6 minutes remaining in this period.
            </p>
          </div>

          <div className="mt-6 grid grid-cols-3 gap-3 border-t border-slate-100 pt-4">
            <div className="rounded-xl bg-slate-50 p-3">
              <span className="text-[10px] uppercase font-bold text-slate-400">Carrier Route</span>
              <p className="mt-1 font-semibold text-xs text-slate-800">Twilio US E.164</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <span className="text-[10px] uppercase font-bold text-slate-400">AI Acoustic Engine</span>
              <p className="mt-1 font-semibold text-xs text-slate-800">Deepgram Aura</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <span className="text-[10px] uppercase font-bold text-slate-400">Calendar Provider</span>
              <p className="mt-1 font-semibold text-xs text-slate-800">Cal.com API</p>
            </div>
          </div>
        </div>

        {/* Payment Method Card */}
        <div className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs lg:col-span-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900">Payment Method</h3>
              <span className="text-xs text-emerald-600 font-semibold flex items-center gap-1">
                <CheckCircle2 size={13} /> Verified
              </span>
            </div>

            <div className="mt-4 flex items-center gap-3.5 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
              <div className="flex h-10 w-12 items-center justify-center rounded-lg bg-slate-900 text-white font-bold text-xs tracking-wider">
                VISA
              </div>
              <div>
                <p className="text-xs font-bold text-slate-800">Visa ending in •••• 4242</p>
                <p className="text-[11px] text-slate-400">Expires 08/2028 · Default method</p>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100 mt-4">
            <button className="w-full rounded-xl border border-slate-200 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition">
              Manage in Stripe Customer Portal
            </button>
          </div>
        </div>
      </div>

      {/* Invoice History */}
      <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-xs">
        <div className="border-b border-slate-100 px-6 py-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
            Invoice Statements & Receipts
          </h3>
        </div>

        <div className="divide-y divide-slate-100 text-xs">
          {[
            { id: 'INV-2026-001', date: 'Oct 01, 2026', amount: '$399.00', status: 'Paid', period: 'Oct 1 – Oct 31, 2026' },
            { id: 'INV-2026-SETUP', date: 'Sep 15, 2026', amount: '$500.00', status: 'Paid', period: 'One-time onboarding & policy setup' },
          ].map((inv) => (
            <div key={inv.id} className="flex items-center justify-between px-6 py-4 transition hover:bg-slate-50/60">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-50 text-violet-700">
                  <FileText size={15} />
                </div>
                <div>
                  <span className="font-bold font-mono text-slate-900">{inv.id}</span>
                  <p className="text-[11px] text-slate-400">{inv.period}</p>
                </div>
              </div>

              <div className="flex items-center gap-6">
                <span className="font-mono font-bold text-slate-800">{inv.amount}</span>
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200">
                  {inv.status}
                </span>
                <button
                  title="Download receipt"
                  className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:text-violet-600 hover:bg-slate-50"
                >
                  <Download size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
