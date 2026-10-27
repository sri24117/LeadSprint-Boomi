import { useState } from 'react';
import { CheckCircle2, Download, FileText } from 'lucide-react';
import { Badge, Button, PageHeader, Section, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common';

export default function BillingPage() {
  const [minutesUsed, setMinutesUsed] = useState(18.4);
  const minutesQuota = 500;
  const percentage = Math.round((minutesUsed / minutesQuota) * 100);

  return (
    <div className="animate-rise-in space-y-6">
      <PageHeader
        eyebrow="Console"
        title="Billing"
        description="Voice minutes consumption, telephony carrier charges, and pilot tier."
      />

      <Section>
        <div className="px-5 py-4 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-md border border-[hsl(var(--primary))/0.35] bg-[hsl(var(--primary))/0.06] px-2.5 py-0.5 text-xs font-bold text-[hsl(var(--primary))]">
                Active plan
              </span>
              <h2 className="mt-0.5 text-base font-bold text-[hsl(var(--foreground))]">
                LeadSprint managed pilot
              </h2>
            </div>
            <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
              $500 setup + $399/month · Single dedicated broker desk, 1 business phone number, and unlimited qualification logic.
            </p>
          </div>
          <div className="text-right">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Monthly renewal</span>
            <p className="mt-0.5 font-mono text-sm text-[hsl(var(--foreground))]">November 1, 2026</p>
          </div>
        </div>
      </Section>

      <div className="grid gap-5 lg:grid-cols-12">
        <Section className="lg:col-span-7" title="Voice telephony quota" description="Real-time meter of billed voice minutes across Retell & Twilio carrier.">
          <div className="px-5 py-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-[hsl(var(--muted-foreground))]">Voice minutes talk time</span>
              <span className="font-mono text-xs text-[hsl(var(--foreground))]">{minutesUsed} / {minutesQuota} mins</span>
            </div>
            <div className="mt-2.5 h-2 rounded-full overflow-hidden bg-[hsl(var(--muted))]">
              <div
                className="h-full bg-[hsl(var(--primary))] transition-all duration-500"
                style={{ width: `${percentage}%` }}
              />
            </div>
            <div className="mt-2 flex justify-between text-[11px] text-[hsl(var(--muted-foreground))]">
              <span>{percentage}% consumed</span>
              <span>481.6 minutes remaining in this period</span>
            </div>
            <p className="mt-3 text-xs text-[hsl(var(--muted-foreground))]">
              Overage rate beyond 500 mins is billed at $0.14/minute.
            </p>
            <div className="mt-5 grid gap-3">
              <div className="rounded-lg border border-[hsl(var(--border))] p-3">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Carrier route</span>
                <p className="mt-1 font-semibold text-xs text-[hsl(var(--foreground))]">Twilio US E.164</p>
              </div>
              <div className="rounded-lg border border-[hsl(var(--border))] p-3">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">AI acoustic engine</span>
                <p className="mt-1 font-semibold text-xs text-[hsl(var(--foreground))]">Deepgram Aura</p>
              </div>
              <div className="rounded-lg border border-[hsl(var(--border))] p-3">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Calendar provider</span>
                <p className="mt-1 font-semibold text-xs text-[hsl(var(--foreground))]">Cal.com API</p>
              </div>
            </div>
          </div>
        </Section>

        <Section className="lg:col-span-5" title="Payment method" description="Card on file for the pilot tier.">
          <div className="px-5 py-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-[hsl(var(--muted-foreground))]">Payment method</h3>
              <span className="flex items-center gap-1.5 rounded-full border border-[hsl(var(--success))/0.35] bg-[hsl(var(--success))/0.08] px-2.5 py-0.5 text-[10px] font-bold text-[hsl(var(--success))]">
                <CheckCircle2 size={12} /> Verified
              </span>
            </div>
            <div className="flex items-center gap-3.5 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))/0.4] p-4">
              <div className="flex h-9 w-11 items-center justify-center rounded-md bg-[hsl(var(--foreground))] text-[hsl(var(--background))] font-bold text-xs tracking-wider">
                VISA
              </div>
              <div>
                <p className="text-sm font-bold text-[hsl(var(--foreground))]">Visa ending in •••• 4242</p>
                <p className="mt-0.5 text-[11px] text-[hsl(var(--muted-foreground))]">
                  Expires 08/2028 · Default method
                </p>
              </div>
            </div>
            <button className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] py-2 text-xs font-semibold text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]">
              Manage in Stripe customer portal
            </button>
          </div>
        </Section>
      </div>

      <Section title="Invoice statements &amp; receipts">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[44%]">Invoice</TableHead>
              <TableHead className="w-[20%] text-right">Amount</TableHead>
              <TableHead className="w-[20%] text-right">Status</TableHead>
              <TableHead className="w-[16%] text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {[
              { id: 'INV-2026-001', date: 'Oct 01, 2026', amount: '$399.00', status: 'Paid', period: 'Oct 1 – Oct 31, 2026' },
              { id: 'INV-2026-SETUP', date: 'Sep 15, 2026', amount: '$500.00', status: 'Paid', period: 'One-time onboarding &amp; policy setup' },
            ].map((inv) => (
              <TableRow key={inv.id}>
                <TableCell className="w-[44%]">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[hsl(var(--primary))/0.10] text-[hsl(var(--primary))]">
                      <FileText size={15} />
                    </div>
                    <div>
                      <span className="font-mono font-semibold text-[hsl(var(--foreground))]">{inv.id}</span>
                      <p className="mt-0.5 text-[11px] text-[hsl(var(--muted-foreground))]">{inv.period}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="w-[20%] text-right">
                  <span className="font-mono font-bold text-[hsl(var(--foreground))]">{inv.amount}</span>
                </TableCell>
                <TableCell className="w-[20%] text-right">
                  <span className="rounded-full border border-[hsl(var(--success))/0.35] bg-[hsl(var(--success))/0.08] px-2.5 py-0.5 text-[10px] font-bold text-[hsl(var(--success))]">
                    {inv.status}
                  </span>
                </TableCell>
                <TableCell className="w-[16%] text-right">
                  <button title="Download receipt" className="rounded-md border border-[hsl(var(--border))] p-1.5 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--primary))] hover:bg-[hsl(var(--muted))]">
                    <Download size={13} />
                  </button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>
    </div>
  );
}
