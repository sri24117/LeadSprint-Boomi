import { useState } from 'react';
import {
  Clock,
  Phone,
  PhoneCall,
  Search,
  Users,
} from 'lucide-react';
import { useGetLeads, useStartCall } from '@workspace/api-client-react';
import {
  Badge,
  EmptyState,
  ErrorState,
  PageHeader,
  Section,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  ConsentBadge,
  formatDate,
  initials,
} from '@/components/common';

export default function ContactsPage() {
  const [search, setSearch] = useState('');
  const leads = useGetLeads();
  const startCall = useStartCall();

  if (leads.isLoading) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow="Console" title="Contacts" />
        {[1, 2, 3, 4, 5].map((n) => (
          <Skeleton key={n} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (leads.isError) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow="Console" title="Contacts" />
        <ErrorState retry={() => leads.refetch()} />
      </div>
    );
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
      <PageHeader
        eyebrow="Console"
        title="Contacts"
        description="Verified contact records, recipient timezones, and TCPA consent compliance."
      />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3.5 top-[50%] -translate-y-[50%] text-[hsl(var(--muted-foreground))]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search contacts by name, phone, or email…"
            className="w-full rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--background))] pl-10 pr-4 py-2.5 text-sm text-[hsl(var(--foreground))] placeholder-[hsl(var(--muted-foreground))] outline-none focus:border-[hsl(var(--primary))] focus:ring-1 focus:ring-[hsl(var(--primary))]"
          />
        </div>
        <div className="flex items-center gap-2 text-sm font-mono text-[hsl(var(--muted-foreground))]">
          {contactsList.length} verified contacts
        </div>
      </div>

      {contactsList.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No contacts found"
          description="Inbound enquiries automatically create compliant contact profiles here."
        />
      ) : (
        <Section>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[26%]">Contact</TableHead>
                <TableHead className="w-[20%]">Phone &amp; timezone</TableHead>
                <TableHead className="w-[16%]">Language &amp; area</TableHead>
                <TableHead className="w-[24%]">TCPA consent</TableHead>
                <TableHead className="w-[16%] text-right">Last activity</TableHead>
                <TableHead className="w-[14%] text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {contactsList.map((contact) => (
                <TableRow key={contact.id}>
                  <TableCell className="w-[26%]">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--primary))/0.10] font-bold text-xs text-[hsl(var(--primary))]">
                        {initials(contact.name)}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-[hsl(var(--foreground))]">
                          {contact.name}
                        </p>
                        <p className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">
                          {contact.email || 'No email provided'}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="w-[20%]">
                    <p className="font-mono text-xs font-semibold text-[hsl(var(--foreground))]">
                      {contact.phone}
                    </p>
                    <p className="mt-0.5 text-[11px] text-[hsl(var(--muted-foreground))] flex items-center gap-1">
                      <Clock size={11} /> America/New_York (EST)
                    </p>
                  </TableCell>
                  <TableCell className="w-[16%]">
                    <span className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))/0.4] px-2 py-0.5 text-[10px] text-[hsl(var(--muted-foreground))]">
                      {contact.preferred_language === 'es' ? 'Spanish' : 'English'}
                    </span>
                    <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))] font-medium">
                      {contact.location}
                    </p>
                  </TableCell>
                  <TableCell className="w-[24%]">
                    <ConsentBadge status={contact.consent_status} unknownLabel="Consent unknown" />
                    <p className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))] truncate max-w-xs">
                      {contact.consent_source || 'Inbound web form'}
                    </p>
                  </TableCell>
                  <TableCell className="w-[16%] text-right">
                    <p className="font-mono text-xs text-[hsl(var(--muted-foreground))]">
                      {contact.last_call ? formatDate(contact.last_call) : 'Never dialed'}
                    </p>
                  </TableCell>
                  <TableCell className="w-[14%] text-right">
                    <button
                      onClick={() => startCall.mutate({ data: { lead_id: contact.id } })}
                      disabled={startCall.isPending}
                      className="inline-flex items-center gap-1.5 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-1.5 text-xs font-semibold text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))/0.05] disabled:opacity-40"
                    >
                      <Phone size={12} />
                      <span>Call</span>
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      )}
    </div>
  );
}
