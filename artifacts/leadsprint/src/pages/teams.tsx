import { useState } from 'react';
import { Bot, Mail, Phone, Plus, X } from 'lucide-react';
import {
  Badge,
  Button,
  PageHeader,
  Section,
  Input,
  Select,
} from '@/components/common';

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: 'Owner' | 'Operator' | 'AI Voice Agent' | 'Admin';
  phone: string;
  status: 'active' | 'pending';
}

const MEMBERS: TeamMember[] = [
  {
    id: 'mem_1',
    name: 'Maya Patel',
    email: 'maya@northstarrealty.example',
    role: 'Owner',
    phone: '+1 212 555 0199',
    status: 'active',
  },
  {
    id: 'mem_2',
    name: 'Sara (Boomi Solutions)',
    email: 'sara.agent@retell.internal',
    role: 'AI Voice Agent',
    phone: '+1 212 555 0100',
    status: 'active',
  },
  {
    id: 'mem_3',
    name: 'Marcus Vance',
    email: 'marcus.v@northstarrealty.example',
    role: 'Operator',
    phone: '+1 646 555 0188',
    status: 'active',
  },
];

const ROLE_TONE: Record<string, string> = {
  Owner: 'border-[#f7e08a]/55 bg-[#fffbeb] text-[#854d0e]',
  'AI Voice Agent': 'border-[#d4b4f8]/55 bg-[#faf4ff] text-[#6d3fa3]',
  Operator: 'border-[#e2e8f0]/55 bg-[#f8fafc] text-[#475569]',
  Admin: 'border-[#e2e8f0]/55 bg-[#f8fafc] text-[#475569]',
};

export default function TeamsPage() {
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('Operator');
  const [invited, setInvited] = useState(false);

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail) return;
    setInvited(true);
    setTimeout(() => {
      setInvited(false);
      setShowInviteModal(false);
      setInviteEmail('');
    }, 1500);
  };

  return (
    <div className="animate-rise-in space-y-6">
      <PageHeader
        eyebrow="Console"
        title="Teams"
        description="Manage human operators, AI voice agent roles, and phone routing rules."
        action={
          <Button variant="primary" onClick={() => setShowInviteModal(true)} data-testid="button-invite-team">
            <Plus size={15} />
            Invite member
          </Button>
        }
      />

      <Section title={`Active members (${MEMBERS.length})`}>
        <div className="divide-y divide-[hsl(var(--border))]">
          {MEMBERS.map((member) => (
            <div
              key={member.id}
              className="flex flex-col justify-between gap-4 px-4 py-4 sm:flex-row sm:items-center transition hover:bg-[hsl(var(--muted))/0.4]"
            >
              <div className="flex items-center gap-3.5">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--muted))/0.4] font-bold text-sm text-[hsl(var(--muted-foreground))]">
                  {member.role === 'AI Voice Agent' ? <Bot size={18} /> : member.name[0]}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-[hsl(var(--foreground))]">{member.name}</span>
                    <Badge className={ROLE_TONE[member.role]}>{member.role}</Badge>
                  </div>
                  <p className="mt-0.5 text-xs font-mono text-[hsl(var(--muted-foreground))]">{member.email}</p>
                </div>
              </div>

              <div className="flex items-center gap-6">
                <div className="text-right">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                    Transfer route
                  </span>
                  <p className="font-mono text-xs font-semibold text-[hsl(var(--foreground))]">
                    {member.phone}
                  </p>
                </div>
                <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold border-[hsl(var(--success))/0.35] bg-[hsl(var(--success))/0.08] text-[hsl(var(--success))]`}>
                  Active
                </span>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {showInviteModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[hsl(var(--foreground))/0.25] backdrop-blur-sm p-4"
          onKeyDown={(event) => {
            if (event.key === 'Escape') setShowInviteModal(false);
          }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowInviteModal(false);
          }}
        >
          <div className="w-full max-w-md rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-bold text-[hsl(var(--foreground))]">Invite operator</h3>
                <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
                  Invite an operator to monitor live calls and receive appointment handoffs.
                </p>
              </div>
              <button onClick={() => setShowInviteModal(false)} data-testid="button-close-invite">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleInvite} className="mt-5 space-y-4">
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-[hsl(var(--muted-foreground))]">
                  Email address <span className="text-[hsl(var(--destructive))]">*</span>
                </label>
                <Input
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="operator@company.com"
                  className="w-full"
                  data-testid="input-invite-email"
                />
              </div>
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-[hsl(var(--muted-foreground))]">
                  Role &amp; access
                </label>
                <Select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  className="w-full"
                  data-testid="select-invite-role"
                >
                  <option value="Operator">Operator (live call supervision &amp; CRM)</option>
                  <option value="Admin">Admin (full prompt &amp; telephony settings)</option>
                </Select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowInviteModal(false)}
                  className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-2 text-xs font-semibold text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-md bg-[hsl(var(--primary))] px-4 py-2 text-xs font-semibold text-[hsl(var(--primary-foreground))] hover:bg-[hsl(var(--primary))/90]"
                >
                  {invited ? 'Invitation sent!' : 'Send invite'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
