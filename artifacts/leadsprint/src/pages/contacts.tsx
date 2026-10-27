import { useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Filter,
  Globe,
  Mail,
  Phone,
  PhoneCall,
  Plus,
  Search,
  ShieldCheck,
  User,
  Users,
} from 'lucide-react';
import { useGetLeads, useStartCall } from '@workspace/api-client-react';
import { Badge, EmptyState, ErrorState, Skeleton, formatDate, initials } from '@/components/common';

export default function ContactsPage() {
  const [search, setSearch] = useState('');
  const leads = useGetLeads();
  const startCall = useStartCall();

  if (leads.isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4, 5].map((n) => (
          <Skeleton key={n} className="h-20 rounded-2xl" />
        ))}
      </div>
    );
  }

  if (leads.isError) {
    return <ErrorState retry={() => leads.refetch()} />;
  }

  const contactsList = (leads.data || []).filter((item) => {
    return (
      item.name.toLowerCase().includes(search.toLowerCase()) ||
      item.phone.includes(search) ||
      (item.email && item.email.toLowerCase().includes(search.toLowerCase())) ||
      item.location.toLowerCase().includes(search.toLowerCase())
    );
  });

  return (
    <div className="animate-rise-in space-y-6">
      {/* Search and Action Bar */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search contacts by name, phone, or email..."
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm text-slate-800 placeholder-slate-400 shadow-xs focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
          />
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-slate-500 font-mono">
            {contactsList.length} verified contacts
          </span>
        </div>
      </div>

      {contactsList.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No contacts found"
          description="Inbound enquiries automatically create compliant contact profiles here."
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-xs">
          <div className="hidden grid-cols-[1.4fr_1.2fr_1.1fr_1.3fr_1fr_100px] gap-4 border-b border-slate-100 bg-slate-50/70 px-6 py-3.5 text-[11px] font-bold uppercase tracking-wider text-slate-500 md:grid">
            <span>Contact Details</span>
            <span>Phone & Timezone</span>
            <span>Language & Area</span>
            <span>TCPA Consent Audit</span>
            <span>Last Activity</span>
            <span className="text-right">Action</span>
          </div>

          <div className="divide-y divide-slate-100">
            {contactsList.map((contact) => (
              <div
                key={contact.id}
                className="grid gap-3 px-6 py-4 md:grid-cols-[1.4fr_1.2fr_1.1fr_1.3fr_1fr_100px] md:items-center md:gap-4 transition hover:bg-slate-50/60"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-100 font-bold text-violet-700 text-xs">
                    {initials(contact.name)}
                  </div>
                  <div>
                    <span className="font-bold text-slate-900 text-sm">{contact.name}</span>
                    <p className="text-xs text-slate-400">{contact.email || 'No email provided'}</p>
                  </div>
                </div>

                <div>
                  <p className="font-mono text-xs font-semibold text-slate-800">{contact.phone}</p>
                  <p className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
                    <Clock size={11} /> America/New_York (EST)
                  </p>
                </div>

                <div>
                  <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-700">
                    {contact.preferred_language === 'es' ? 'Spanish' : 'English'}
                  </span>
                  <p className="mt-1 text-xs text-slate-500 font-medium">{contact.location}</p>
                </div>

                <div>
                  <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200">
                    <ShieldCheck size={13} />
                    <span>Consent Valid</span>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-400 truncate max-w-[190px]">
                    {contact.consent_source || 'Inbound web form'}
                  </p>
                </div>

                <div className="text-xs font-mono text-slate-500">
                  {contact.last_call ? formatDate(contact.last_call) : 'Never dialed'}
                </div>

                <div className="text-right">
                  <button
                    onClick={() => startCall.mutate({ data: { lead_id: contact.id } })}
                    disabled={startCall.isPending}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700 border border-violet-200 hover:bg-violet-100 transition active:scale-95 disabled:opacity-60"
                  >
                    <PhoneCall size={12} />
                    <span>Call</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
