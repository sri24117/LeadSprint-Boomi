import React, { type ReactNode } from 'react';
import { Link } from 'wouter';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Info as InfoIcon,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  X,
  type LucideIcon,
} from 'lucide-react';

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
  if (score === 'hot') return 'border-[#d6383e]/30 bg-[#d6383e]/10 text-[#d6383e]';
  if (score === 'warm') return 'border-[#b36b00]/30 bg-[#b36b00]/10 text-[#b36b00]';
  return 'border-[var(--prise-border,#d5e3e8)] bg-[var(--prise-surface-soft,#edf5f7)] text-[var(--prise-text-secondary,#607681)]';
}

export function statusTone(status?: string) {
  if (status === 'qualified' || status === 'confirmed' || status === 'completed') {
    return 'border-[#23875b]/30 bg-[#23875b]/10 text-[#23875b]';
  }
  if (status === 'failed' || status === 'cancelled' || status === 'policy_blocked') {
    return 'border-[#d6383e]/30 bg-[#d6383e]/10 text-[#d6383e]';
  }
  if (status === 'in_progress' || status === 'queued' || status === 'booked') {
    return 'border-[#b36b00]/30 bg-[#b36b00]/10 text-[#b36b00]';
  }
  return 'border-[var(--prise-border,#d5e3e8)] bg-[var(--prise-surface-soft,#edf5f7)] text-[var(--prise-text-secondary,#607681)]';
}

/* ---------------- PrISE Card Component ---------------- */

export function Card({
  children,
  className = '',
  ...props
}: React.HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={`rounded-[var(--radius-card,20px)] border border-[var(--prise-border,#d5e3e8)] bg-[var(--prise-surface,#ffffff)] p-5 sm:p-6 shadow-[var(--shadow-card,0_10px_30px_rgb(30_73_91_/_8%))] transition-all ${className}`}
      {...props}
    >
      {children}
    </section>
  );
}

/* ---------------- PrISE Button Component ---------------- */

export function Button({
  children,
  variant = 'secondary',
  size = 'default',
  className = '',
  ...props
}: {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger' | 'outline';
  size?: 'default' | 'sm' | 'icon';
  className?: string;
  [key: string]: unknown;
}) {
  const base =
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-button,12px)] font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--prise-primary)] focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50 cursor-pointer [&_svg]:pointer-events-none [&_svg]:shrink-0';
  const styles = {
    primary:
      'bg-[var(--prise-primary,#347f9b)] text-white border border-[var(--prise-primary,#347f9b)] hover:bg-[var(--prise-primary-dark,#1d5b73)] shadow-sm active:scale-[0.99]',
    secondary:
      'bg-[var(--prise-surface,#ffffff)] text-[var(--prise-text,#142b36)] border border-[var(--prise-border,#d5e3e8)] hover:bg-[var(--prise-surface-soft,#edf5f7)] shadow-sm active:scale-[0.99]',
    quiet:
      'bg-transparent text-[var(--prise-text-secondary,#607681)] border border-transparent hover:bg-[var(--prise-surface-soft,#edf5f7)] hover:text-[var(--prise-text,#142b36)]',
    danger:
      'bg-[var(--prise-action,#e5393f)] text-white border border-[var(--prise-action,#e5393f)] hover:bg-[#b82e33] shadow-sm active:scale-[0.99]',
    outline:
      'border border-[var(--prise-border,#d5e3e8)] bg-transparent text-[var(--prise-text,#142b36)] hover:bg-[var(--prise-surface-soft,#edf5f7)] shadow-sm',
  };
  const sizes = {
    default: 'min-h-[44px] px-4 py-2.5 text-sm',
    sm: 'min-h-[36px] px-3 py-1.5 text-xs',
    icon: 'h-11 w-11 p-0',
  };
  return (
    <button
      data-testid={props['data-testid'] as string}
      {...props}
      className={`${base} ${styles[variant]} ${sizes[size]} ${className}`}
    >
      {children}
    </button>
  );
}

/* ---------------- PrISE Status Badge & Badges ---------------- */

export function StatusBadge({
  status,
  label,
  className = '',
}: {
  status?: 'success' | 'warning' | 'danger' | 'info' | 'neutral' | string;
  label?: string;
  className?: string;
}) {
  const normalized = (status || '').toLowerCase();
  let toneClass = 'bg-[var(--prise-surface-soft,#edf5f7)] text-[var(--prise-text-secondary,#607681)] border border-[var(--prise-border,#d5e3e8)]';

  if (['success', 'qualified', 'confirmed', 'completed', 'active', 'good', 'live'].includes(normalized)) {
    toneClass = 'bg-[#23875b]/10 text-[#23875b] border border-[#23875b]/25';
  } else if (['warning', 'warm', 'pending', 'in_progress', 'queued', 'booked'].includes(normalized)) {
    toneClass = 'bg-[#b36b00]/10 text-[#b36b00] border border-[#b36b00]/25';
  } else if (['danger', 'alert', 'hot', 'failed', 'cancelled', 'policy_blocked', 'revoked'].includes(normalized)) {
    toneClass = 'bg-[#d6383e]/10 text-[#d6383e] border border-[#d6383e]/25';
  } else if (['info'].includes(normalized)) {
    toneClass = 'bg-[#287a9b]/10 text-[#287a9b] border border-[#287a9b]/25';
  }

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider ${toneClass} ${className}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
      {label || status}
    </span>
  );
}

export function Badge({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider bg-[var(--prise-surface-soft,#edf5f7)] text-[var(--prise-text-secondary,#607681)] border border-[var(--prise-border,#d5e3e8)] ${className}`}>
      {children}
    </span>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-[12px] bg-[var(--prise-surface-soft,#edf5f7)] ${className}`} />;
}

/* ---------------- Empty State & Error State ---------------- */

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
    <div className="flex min-h-[220px] flex-col items-center justify-center rounded-[var(--radius-card,20px)] border border-dashed border-[var(--prise-border,#d5e3e8)] bg-[var(--prise-surface,#ffffff)]/60 p-8 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--prise-surface-soft,#edf5f7)] text-[var(--prise-primary,#347f9b)]">
        <Icon size={20} />
      </div>
      <h3 className="font-bold text-[var(--prise-text,#142b36)] text-base">{title}</h3>
      <p className="mt-1 max-w-sm text-sm leading-relaxed text-[var(--prise-text-secondary,#607681)]">{description}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function ErrorState({ retry }: { retry?: () => void }) {
  return (
    <div className="flex min-h-[200px] flex-col items-center justify-center rounded-[var(--radius-card,20px)] border border-[#d6383e]/25 bg-[#d6383e]/5 p-8 text-center">
      <AlertTriangle className="mb-3 text-[#d6383e]" size={24} />
      <h3 className="font-bold text-[var(--prise-text,#142b36)]">Could not load this view</h3>
      <p className="mt-1 text-sm text-[var(--prise-text-secondary,#607681)]">The service did not respond. Your work is safe.</p>
      {retry && (
        <Button variant="primary" className="mt-5" onClick={retry} data-testid="button-retry">
          <RefreshCw size={14} /> Try again
        </Button>
      )}
    </div>
  );
}

export function ConsentBadge({ status, unknownLabel = 'Consent unknown' }: { status?: string; unknownLabel?: string }) {
  if (status === 'valid') return <StatusBadge status="success" label="Consent on file" />;
  if (status === 'revoked') return <StatusBadge status="danger" label="Consent revoked" />;
  return <StatusBadge status="warning" label={unknownLabel} />;
}

export function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--prise-text-secondary,#607681)]">{label}</p>
      <p className="mt-1 truncate font-medium text-[var(--prise-text,#142b36)]">{value}</p>
    </div>
  );
}

/* ---------------- PrISE MetricCard Component ---------------- */

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
  tone?: 'default' | 'warm' | 'alert' | 'good' | 'info';
  href?: string;
}) {
  const toneIconStyles = {
    default: 'bg-[var(--prise-surface-soft,#edf5f7)] text-[var(--prise-primary,#347f9b)]',
    warm: 'bg-[#b36b00]/10 text-[#b36b00]',
    alert: 'bg-[#d6383e]/10 text-[#d6383e]',
    good: 'bg-[#23875b]/10 text-[#23875b]',
    info: 'bg-[#287a9b]/10 text-[#287a9b]',
  };

  const content = (
    <div
      className="group rounded-[var(--radius-card,20px)] border border-[var(--prise-border,#d5e3e8)] bg-[var(--prise-surface,#ffffff)] p-5 shadow-[var(--shadow-card,0_10px_30px_rgb(30_73_91_/_8%))] transition-all hover:shadow-[var(--shadow-floating,0_18px_50px_rgb(18_54_69_/_16%))] hover:-translate-y-0.5"
    >
      <div className="flex items-start justify-between">
        <span className={`flex h-10 w-10 items-center justify-center rounded-[14px] ${toneIconStyles[tone]}`}>
          <Icon size={20} strokeWidth={2.2} />
        </span>
      </div>
      <div className="mt-4">
        <strong className="block text-3xl font-extrabold tracking-tight text-[var(--prise-text,#142b36)] font-mono">
          {value}
        </strong>
        <p className="mt-1 text-sm font-bold text-[var(--prise-text,#142b36)]">
          {label}
        </p>
        <p className="mt-0.5 text-xs text-[var(--prise-text-secondary,#607681)]">
          {detail}
        </p>
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

/* ---------------- ActionNotice Banner Component ---------------- */

export function ActionNotice({
  message,
  count,
  actionLabel = 'Review',
  href,
  onAction,
  tone = 'default',
}: {
  message: string;
  count?: number | string;
  actionLabel?: string;
  href?: string;
  onAction?: () => void;
  tone?: 'default' | 'success' | 'warning' | 'danger';
}) {
  const toneStyles = {
    default: 'bg-[var(--prise-surface,#ffffff)] border-[var(--prise-border,#d5e3e8)] text-[var(--prise-text,#142b36)]',
    success: 'bg-[#23875b]/8 border-[#23875b]/30 text-[#142b36]',
    warning: 'bg-[#b36b00]/8 border-[#b36b00]/30 text-[#142b36]',
    danger: 'bg-[#d6383e]/8 border-[#d6383e]/30 text-[#142b36]',
  };

  const content = (
    <div className={`flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-[var(--radius-card,20px)] border p-4 sm:px-6 shadow-[var(--shadow-card,0_10px_30px_rgb(30_73_91_/_8%))] ${toneStyles[tone]}`}>
      <div className="flex items-center gap-3">
        {count !== undefined && (
          <span className="font-extrabold text-[var(--prise-text,#142b36)]">
            {count}
          </span>
        )}
        <span className="text-sm font-medium text-[var(--prise-text,#142b36)]">
          {message}
        </span>
      </div>
      {actionLabel && (
        <span className="inline-flex items-center gap-1.5 text-sm font-bold text-[var(--prise-primary,#347f9b)] hover:text-[var(--prise-primary-dark,#1d5b73)] transition">
          {actionLabel} &rarr;
        </span>
      )}
    </div>
  );

  if (href) {
    return <Link href={href}>{content}</Link>;
  }
  if (onAction) {
    return <button onClick={onAction} className="w-full text-left">{content}</button>;
  }
  return content;
}

/* ---------------- Drawer Slide-Over Panel ---------------- */

export function Drawer({
  isOpen,
  onClose,
  title,
  description,
  children,
  footer,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  if (!isOpen) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-[rgba(18,54,69,0.35)] backdrop-blur-sm transition-opacity"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-full w-full max-w-xl flex-col bg-[var(--prise-surface,#ffffff)] border-l border-[var(--prise-border,#d5e3e8)] shadow-[var(--shadow-floating,0_18px_50px_rgb(18_54_69_/_16%))] animate-in slide-in-from-right duration-300">
        <div className="flex items-center justify-between border-b border-[var(--prise-border,#d5e3e8)] px-6 py-5">
          <div>
            <h2 className="text-lg font-bold text-[var(--prise-text,#142b36)]">{title}</h2>
            {description && (
              <p className="mt-0.5 text-xs text-[var(--prise-text-secondary,#607681)]">{description}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--prise-text-secondary,#607681)] hover:bg-[var(--prise-surface-soft,#edf5f7)] hover:text-[var(--prise-text,#142b36)] transition cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-5">{children}</div>
        {footer && (
          <div className="border-t border-[var(--prise-border,#d5e3e8)] bg-[var(--prise-surface-soft,#edf5f7)]/50 px-6 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- Form Controls (44px min height, 12px radius) ---------------- */

export function Input({
  className = '',
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`flex min-h-[44px] h-11 w-full rounded-[var(--radius-input,12px)] border border-[var(--prise-border,#d5e3e8)] bg-[var(--prise-surface,#ffffff)] px-3.5 py-2 text-sm text-[var(--prise-text,#142b36)] placeholder:text-[var(--prise-text-muted,#82939c)] outline-none focus:border-transparent focus:ring-2 focus:ring-[var(--prise-primary,#347f9b)] focus:ring-offset-1 disabled:bg-[var(--prise-surface-soft,#edf5f7)] disabled:text-[var(--prise-text-muted,#82939c)] transition-all ${className}`}
    />
  );
}

export function Select({
  className = '',
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`flex min-h-[44px] h-11 w-full rounded-[var(--radius-input,12px)] border border-[var(--prise-border,#d5e3e8)] bg-[var(--prise-surface,#ffffff)] px-3.5 py-2 text-sm text-[var(--prise-text,#142b36)] outline-none focus:border-transparent focus:ring-2 focus:ring-[var(--prise-primary,#347f9b)] focus:ring-offset-1 disabled:bg-[var(--prise-surface-soft,#edf5f7)] transition-all ${className}`}
    />
  );
}

export function TextArea({
  className = '',
  testId,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { testId?: string }) {
  return (
    <textarea
      {...props}
      data-testid={testId}
      className={`flex min-h-[88px] w-full rounded-[var(--radius-input,12px)] border border-[var(--prise-border,#d5e3e8)] bg-[var(--prise-surface,#ffffff)] px-3.5 py-2.5 text-sm text-[var(--prise-text,#142b36)] placeholder:text-[var(--prise-text-muted,#82939c)] outline-none focus:border-transparent focus:ring-2 focus:ring-[var(--prise-primary,#347f9b)] focus:ring-offset-1 disabled:bg-[var(--prise-surface-soft,#edf5f7)] transition-all ${className}`}
    />
  );
}

export function Toggle({
  label,
  detail,
  checked,
  onChange,
  testId,
}: {
  label: string;
  detail?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-center justify-between rounded-[var(--radius-input,12px)] border border-[var(--prise-border,#d5e3e8)] bg-[var(--prise-surface,#ffffff)] p-3.5 text-left transition hover:bg-[var(--prise-surface-soft,#edf5f7)] cursor-pointer"
      data-testid={testId}
    >
      <span>
        <span className="block text-sm font-bold text-[var(--prise-text,#142b36)]">{label}</span>
        {detail && (
          <span className="mt-0.5 block text-xs text-[var(--prise-text-secondary,#607681)]">{detail}</span>
        )}
      </span>
      <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? 'bg-[var(--prise-primary,#347f9b)]' : 'bg-[var(--prise-border,#d5e3e8)]'}`}>
        <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
      </span>
    </button>
  );
}

export function Checkbox({
  checked,
  onChange,
  className = '',
  ...props
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
  [key: string]: unknown;
}) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
      className={`h-4 w-4 rounded border-[var(--prise-border,#d5e3e8)] text-[var(--prise-primary,#347f9b)] focus:ring-2 focus:ring-[var(--prise-primary,#347f9b)] ${className}`}
      {...props}
    />
  );
}

/* ---------------- Links ---------------- */

export function QuietLink({
  href,
  children,
  className = '',
  ...props
}: {
  href: string;
  children: ReactNode;
  className?: string;
  [key: string]: unknown;
}) {
  return (
    <Link
      href={href}
      {...props}
      className={`inline-flex items-center gap-1 text-xs font-bold text-[var(--prise-primary,#347f9b)] hover:text-[var(--prise-primary-dark,#1d5b73)] transition ${className}`}
    >
      {children}
    </Link>
  );
}

/* ---------------- Tables (Quiet header, generous spacing) ---------------- */

export function Table({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`overflow-x-auto rounded-[var(--radius-card,20px)] border border-[var(--prise-border,#d5e3e8)] bg-[var(--prise-surface,#ffffff)] shadow-[var(--shadow-card,0_10px_30px_rgb(30_73_91_/_8%))] ${className}`}>
      <table className="w-full text-sm caption-bottom border-collapse">{children}</table>
    </div>
  );
}

export function TableHeader({ children }: { children?: ReactNode }) {
  return <thead className="border-b border-[var(--prise-border,#d5e3e8)] bg-[var(--prise-surface-soft,#edf5f7)]">{children}</thead>;
}

export function TableBody({ children }: { children?: ReactNode }) {
  return <tbody className="divide-y divide-[var(--prise-border,#d5e3e8)]">{children}</tbody>;
}

export function TableRow({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return (
    <tr className={`transition-colors hover:bg-[var(--prise-surface-soft,#edf5f7)]/50 ${className}`}>{children}</tr>
  );
}

export function TableHead({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return (
    <th className={`h-11 px-5 text-left align-middle font-bold text-[11px] uppercase tracking-[.14em] text-[var(--prise-text-secondary,#607681)] ${className}`}>
      {children}
    </th>
  );
}

export function TableCell({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return (
    <td className={`px-5 py-4 align-middle text-[var(--prise-text,#142b36)] ${className}`}>
      {children}
    </td>
  );
}

/* ---------------- Page Layout & Hierarchy ---------------- */

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end mb-6">
      <div>
        {eyebrow && (
          <p className="text-[11px] font-bold uppercase tracking-[.18em] text-[var(--prise-primary,#347f9b)] mb-1">
            {eyebrow}
          </p>
        )}
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[var(--prise-text,#142b36)]">
          {title}
        </h1>
        {description && (
          <p className="mt-1 text-sm leading-relaxed text-[var(--prise-text-secondary,#607681)] max-w-2xl">
            {description}
          </p>
        )}
      </div>
      {action && <div className="flex items-center gap-2.5 shrink-0">{action}</div>}
    </div>
  );
}

export function Section({
  title,
  description,
  action,
  children,
  className = '',
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const hasHead = Boolean(title || description || action);
  return (
    <section className={`rounded-[var(--radius-card,20px)] border border-[var(--prise-border,#d5e3e8)] bg-[var(--prise-surface,#ffffff)] shadow-[var(--shadow-card,0_10px_30px_rgb(30_73_91_/_8%))] ${className}`}>
      {hasHead && (
        <div className="border-b border-[var(--prise-border,#d5e3e8)] px-6 py-4 flex items-center justify-between">
          <div>
            {title && <h2 className="font-bold text-[var(--prise-text,#142b36)] text-base">{title}</h2>}
            {description && (
              <p className="mt-0.5 text-xs text-[var(--prise-text-secondary,#607681)]">{description}</p>
            )}
          </div>
          {action && <div className="ml-4 shrink-0 flex items-center gap-2">{action}</div>}
        </div>
      )}
      <div className="p-6">{children}</div>
    </section>
  );
}

export function SectionBody({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`p-6 ${className}`}>{children}</div>;
}

export function Separator({ className = '' }: { className?: string }) {
  return <div className={`border-t border-[var(--prise-border,#d5e3e8)] my-6 ${className}`} />;
}
