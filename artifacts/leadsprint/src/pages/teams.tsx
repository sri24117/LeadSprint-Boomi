import { useState } from 'react';
import {
  Bot,
  CheckCircle2,
  Mail,
  MoreVertical,
  Phone,
  Plus,
  Shield,
  ShieldCheck,
  User,
  UsersRound,
} from 'lucide-react';
import { Badge, Button } from '@/components/common';

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: 'Owner' | 'Operator' | 'AI Voice Agent' | 'Admin';
  phone: string;
  status: 'active' | 'pending';
  avatarColor: string;
}

const MEMBERS: TeamMember[] = [
  {
    id: 'mem_1',
    name: 'Maya Patel',
    email: 'maya@northstarrealty.example',
    role: 'Owner',
    phone: '+1 212 555 0199',
    status: 'active',
    avatarColor: 'bg-violet-100 text-violet-700',
  },
  {
    id: 'mem_2',
    name: 'Sara (Boomi Solutions)',
    email: 'sara.agent@retell.internal',
    role: 'AI Voice Agent',
    phone: '+1 212 555 0100',
    status: 'active',
    avatarColor: 'bg-purple-100 text-purple-700',
  },
  {
    id: 'mem_3',
    name: 'Marcus Vance',
    email: 'marcus.v@northstarrealty.example',
    role: 'Operator',
    phone: '+1 646 555 0188',
    status: 'active',
    avatarColor: 'bg-indigo-100 text-indigo-700',
  },
];

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
      {/* Top Banner */}
      <div className="flex flex-col justify-between gap-4 rounded-2xl border border-violet-100 bg-gradient-to-r from-violet-50/70 via-white to-slate-50 p-6 shadow-xs sm:flex-row sm:items-center">
        <div>
          <h2 className="text-base font-bold text-slate-800">Workspace Team & Roles</h2>
          <p className="mt-1 text-sm text-slate-600">
            Control human operator access, manage telephony transfer routing, and assign agent permissions.
          </p>
        </div>
        <button
          onClick={() => setShowInviteModal(true)}
          className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-xs font-semibold text-white shadow-xs transition hover:bg-violet-700 active:scale-95"
          data-testid="button-invite-team"
        >
          <Plus size={16} />
          <span>Invite Member</span>
        </button>
      </div>

      {/* Team Table */}
      <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-xs">
        <div className="border-b border-slate-100 px-6 py-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
            Active Members ({MEMBERS.length})
          </h3>
        </div>

        <div className="divide-y divide-slate-100">
          {MEMBERS.map((member) => (
            <div
              key={member.id}
              className="flex flex-col justify-between gap-4 px-6 py-4 sm:flex-row sm:items-center transition hover:bg-slate-50/60"
            >
              <div className="flex items-center gap-3.5">
                <div
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl font-bold text-sm ${member.avatarColor}`}
                >
                  {member.role === 'AI Voice Agent' ? <Bot size={20} /> : member.name[0]}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900 text-sm">{member.name}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        member.role === 'Owner'
                          ? 'bg-amber-50 text-amber-700 border border-amber-200'
                          : member.role === 'AI Voice Agent'
                            ? 'bg-violet-50 text-violet-700 border border-violet-200'
                            : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {member.role}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 font-mono mt-0.5">{member.email}</p>
                </div>
              </div>

              <div className="flex items-center gap-6">
                <div className="text-right">
                  <span className="text-[10px] uppercase font-bold text-slate-400">Transfer Route</span>
                  <p className="font-mono text-xs text-slate-700 font-semibold">{member.phone}</p>
                </div>

                <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200">
                  Active
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Invite Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl animate-scale-in">
            <h3 className="text-base font-bold text-slate-900">Invite Operator</h3>
            <p className="mt-1 text-xs text-slate-500">
              Invite an operator or assistant to monitor live calls and receive appointment handoffs.
            </p>

            <form onSubmit={handleInvite} className="mt-4 space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-700">Email Address</label>
                <input
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="operator@company.com"
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-800 shadow-xs focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700">Role & Access</label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-800 shadow-xs focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
                >
                  <option value="Operator">Operator (Live Call Supervision & CRM)</option>
                  <option value="Admin">Admin (Full Prompt & Telephony Settings)</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowInviteModal(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-violet-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-violet-700"
                >
                  {invited ? 'Invitation Sent!' : 'Send Invite'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
