import { type ReactNode } from 'react';
import { Link } from 'wouter';
import { AlertTriangle, RefreshCw, Sparkles, type LucideIcon } from 'lucide-react';

export function formatTime(value?: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

export function formatDate(value?: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
}

export function relativeTime(value?: string | null) {
  if (!value) return 'No activity yet';
  const minutes = Math.max(1, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1440)}d ago`;
}

export function initials(name = '') {
  return name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'LS';
}

export function scoreTone(score?: string) {
  if (score === 'hot') return 'bg-[#f7d6c7] text-[#8d371f]';
  if (score === 'warm') return 'bg-[#f5e6b6] text-[#745817]';
  return 'bg-[#dce8e4] text-[#285b4e]';
}

export function statusTone(status?: string) {
  if (status === 'qualified' || status === 'confirmed' || status === 'completed') return 'bg-[#d7e9df] text-[#24634f]';
  if (status === 'failed' || status === 'cancelled' || status === 'policy_blocked') return 'bg-[#f7d6c7] text-[#8d371f]';
  if (status === 'in_progress' || status === 'queued' || status === 'booked') return 'bg-[#f5e6b6] text-[#745817]';
  return 'bg-[#e6e7df] text-[#59605b]';
}

export function Button({
  children,
  variant = 'secondary',
  className = '',
  ...props
}: {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
  className?: string;
  [key: string]: unknown;
}) {
  const styles = {
    primary: 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] border-[hsl(var(--primary))] hover:brightness-110',
    secondary: 'bg-[hsl(var(--card))] text-foreground border-border hover:bg-[hsl(var(--muted))]',
    quiet: 'bg-transparent text-muted-foreground border-transparent hover:bg-[hsl(var(--muted))] hover:text-foreground',
    danger: 'bg-transparent text-[hsl(var(--destructive))] border-[hsl(var(--destructive)/.35)] hover:bg-[hsl(var(--destructive)/.08)]',
  };
  return (
    <button
      data-testid={props['data-testid'] as string}
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Badge({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-1 text-[11px] font-bold uppercase tracking-[.08em] ${className}`}>
      {children}
    </span>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-[hsl(var(--muted))] ${className}`} />;
}

export function EmptyState({
  icon: Icon = Sparkles,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-[280px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-[hsl(var(--card)/.45)] p-8 text-center">
      <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-[hsl(var(--secondary)/.35)] text-[hsl(var(--primary))]">
        <Icon size={20} />
      </div>
      <h3 className="font-semibold text-foreground">{title}</h3>
      <p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ retry }: { retry?: () => void }) {
  return (
    <div className="flex min-h-[220px] flex-col items-center justify-center rounded-xl border border-[hsl(var(--destructive)/.25)] bg-[hsl(var(--destructive)/.04)] p-8 text-center">
      <AlertTriangle className="mb-3 text-[hsl(var(--destructive))]" size={22} />
      <h3 className="font-semibold">Could not load this desk</h3>
      <p className="mt-1 text-sm text-muted-foreground">The service did not respond. Your work is safe.</p>
      {retry && (
        <Button className="mt-4" onClick={retry} data-testid="button-retry">
          <RefreshCw size={14} /> Try again
        </Button>
      )}
    </div>
  );
}

export function ConsentBadge({ status }: { status?: string }) {
  if (status === 'valid') return <Badge className="bg-[#d7e9df] text-[#24634f]">Consent on file</Badge>;
  if (status === 'revoked') return <Badge className="bg-[#f7d6c7] text-[#8d371f]">Consent revoked</Badge>;
  return <Badge className="bg-[#f5e6b6] text-[#745817]">Consent unknown</Badge>;
}

export function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-1 truncate font-medium">{value}</p>
    </div>
  );
}

export function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  tone = 'default',
  href,
}: {
  label: string;
  value: number | string;
  detail: string;
  icon: LucideIcon;
  tone?: 'default' | 'warm' | 'alert' | 'good';
  href?: string;
}) {
  const content = (
    <div
      className={`group rounded-xl border border-border bg-[hsl(var(--card))] p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_24px_hsl(209_43%_22%/.08)] ${tone === 'warm' ? 'border-[hsl(var(--secondary)/.45)]' : tone === 'alert' ? 'border-[hsl(var(--destructive)/.3)]' : tone === 'good' ? 'border-[hsl(var(--accent)/.3)]' : ''}`}
    >
      <div className="flex items-start justify-between">
        <span className="text-xs font-semibold text-muted-foreground">{label}</span>
        <span
          className={`rounded-lg p-2 ${tone === 'warm' ? 'bg-[hsl(var(--secondary)/.25)] text-[hsl(var(--primary))]' : tone === 'alert' ? 'bg-[hsl(var(--destructive)/.1)] text-[hsl(var(--destructive))]' : tone === 'good' ? 'bg-[hsl(var(--accent)/.12)] text-[hsl(var(--accent))]' : 'bg-[hsl(var(--muted))] text-muted-foreground'}`}
        >
          <Icon size={16} />
        </span>
      </div>
      <div className="mt-4 flex items-end justify-between">
        <strong className="font-mono text-3xl tracking-[-.08em]">{value}</strong>
        <span className="mb-1 text-right text-[11px] leading-4 text-muted-foreground">{detail}</span>
      </div>
    </div>
  );
  return href ? (
    <Link href={href} data-testid={`link-metric-${label.toLowerCase().replaceAll(' ', '-')}`}>
      {content}
    </Link>
  ) : (
    content
  );
}
