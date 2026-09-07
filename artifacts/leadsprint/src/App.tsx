import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, SignIn, SignUp, useAuth, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import {
  Activity as ActivityIcon,
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  Bell,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Clock3,
  Filter,
  Flame,
  Headphones,
  LayoutDashboard,
  Loader2,
  LogOut,
  Menu,
  MessageSquare,
  MoreHorizontal,
  Phone,
  PhoneCall,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  Upload,
  UsersRound,
  X,
} from 'lucide-react';
import {
  getGetAppointmentsQueryKey,
  getGetAuthMeQueryKey,
  getGetBusinessSettingsQueryKey,
  getGetCallQueryKey,
  getGetCallsQueryKey,
  getGetLeadQueryKey,
  getGetLeadsQueryKey,
  useBookAppointment,
  useGetAppointments,
  useGetAuthMe,
  useGetAvailability,
  useGetBusinessSettings,
  useGetCall,
  useGetCalls,
  useGetActivity,
  useGetLead,
  useHealthCheck,
  useGetLeads,
  useGetToday,
  useGetUsage,
  useGetWeeklyReport,
  useImportLeads,
  useStartCall,
  useSuppressLead,
  useUpdateBusinessSettings,
  useUpdateLead,
} from '@workspace/api-client-react';
import { Link, Redirect, Route, Router as WouterRouter, Switch, useLocation, useRoute } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();

const navItems = [
  { href: '/workspace', label: 'Today', icon: LayoutDashboard },
  { href: '/workspace/leads', label: 'Leads', icon: UsersRound },
  { href: '/workspace/calls', label: 'Calls', icon: PhoneCall },
  { href: '/workspace/appointments', label: 'Appointments', icon: CalendarDays },
  { href: '/workspace/reports', label: 'Reports', icon: BarChart3 },
  { href: '/workspace/business-settings', label: 'Business settings', icon: Settings2 },
];

const pageMeta: Record<string, { eyebrow: string; title: string; description: string }> = {
  '/workspace': { eyebrow: 'Operator desk', title: 'Today', description: 'The handoffs that need a human touch.' },
  '/workspace/leads': { eyebrow: 'Pipeline', title: 'Leads', description: 'Find the next best conversation.' },
  '/workspace/calls': { eyebrow: 'Voice desk', title: 'Calls', description: 'A clear trail for every attempted connection.' },
  '/workspace/appointments': { eyebrow: 'Calendar', title: 'Appointments', description: 'Verified meetings, ready for the team.' },
  '/workspace/reports': { eyebrow: 'Pilot pulse', title: 'Reports', description: 'A grounded view of your weekly operation.' },
  '/workspace/business-settings': { eyebrow: 'Control room', title: 'Business settings', description: 'Policy first. Then automation.' },
};

// Local development shortcut: when the build is made with
// VITE_LEADSPRINT_DEMO_AUTH=true (and the API server runs with
// LEADSPRINT_DEMO_AUTH=true / NODE_ENV != production), the console skips
// Clerk entirely and talks to the seeded demo workspace. Never build a
// public deployment with this flag set — it removes sign-in completely.
const DEMO_AUTH = import.meta.env.VITE_LEADSPRINT_DEMO_AUTH === 'true';

const clerkPubKey = DEMO_AUTH
  ? ''
  : publishableKeyFromHost(
      window.location.hostname,
      import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
    );
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || '/'
    : path;
}

function formatTime(value?: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
}

function relativeTime(value?: string | null) {
  if (!value) return 'No activity yet';
  const minutes = Math.max(1, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1440)}d ago`;
}

function initials(name = '') {
  return name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'LS';
}

function scoreTone(score?: string) {
  if (score === 'hot') return 'bg-[#f7d6c7] text-[#8d371f]';
  if (score === 'warm') return 'bg-[#f5e6b6] text-[#745817]';
  return 'bg-[#dce8e4] text-[#285b4e]';
}

function statusTone(status?: string) {
  if (status === 'qualified' || status === 'confirmed' || status === 'completed') return 'bg-[#d7e9df] text-[#24634f]';
  if (status === 'failed' || status === 'cancelled' || status === 'policy_blocked') return 'bg-[#f7d6c7] text-[#8d371f]';
  if (status === 'in_progress' || status === 'queued' || status === 'booked') return 'bg-[#f5e6b6] text-[#745817]';
  return 'bg-[#e6e7df] text-[#59605b]';
}

function Button({ children, variant = 'secondary', className = '', ...props }: { children: ReactNode; variant?: 'primary' | 'secondary' | 'quiet' | 'danger'; className?: string; [key: string]: unknown }) {
  const styles = {
    primary: 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] border-[hsl(var(--primary))] hover:brightness-110',
    secondary: 'bg-[hsl(var(--card))] text-foreground border-border hover:bg-[hsl(var(--muted))]',
    quiet: 'bg-transparent text-muted-foreground border-transparent hover:bg-[hsl(var(--muted))] hover:text-foreground',
    danger: 'bg-transparent text-[hsl(var(--destructive))] border-[hsl(var(--destructive)/.35)] hover:bg-[hsl(var(--destructive)/.08)]',
  };
  return <button data-testid={props['data-testid'] as string} {...props} className={`inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`}>{children}</button>;
}

function Badge({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center rounded-md px-2 py-1 text-[11px] font-bold uppercase tracking-[.08em] ${className}`}>{children}</span>;
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-[hsl(var(--muted))] ${className}`} />;
}

function EmptyState({ icon: Icon = Sparkles, title, description, action }: { icon?: typeof Sparkles; title: string; description: string; action?: ReactNode }) {
  return <div className="flex min-h-[280px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-[hsl(var(--card)/.45)] p-8 text-center">
    <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-[hsl(var(--secondary)/.35)] text-[hsl(var(--primary))]"><Icon size={20} /></div>
    <h3 className="font-semibold text-foreground">{title}</h3>
    <p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">{description}</p>
    {action && <div className="mt-5">{action}</div>}
  </div>;
}

function ErrorState({ retry }: { retry?: () => void }) {
  return <div className="flex min-h-[220px] flex-col items-center justify-center rounded-xl border border-[hsl(var(--destructive)/.25)] bg-[hsl(var(--destructive)/.04)] p-8 text-center">
    <AlertTriangle className="mb-3 text-[hsl(var(--destructive))]" size={22} />
    <h3 className="font-semibold">Could not load this desk</h3>
    <p className="mt-1 text-sm text-muted-foreground">The service did not respond. Your work is safe.</p>
    {retry && <Button className="mt-4" onClick={retry} data-testid="button-retry"><RefreshCw size={14} /> Try again</Button>}
  </div>;
}

function useClerkSignOutAction() {
  const { signOut } = useClerk();
  return (redirectUrl: string) => signOut({ redirectUrl });
}

function useDemoSignOutAction() {
  // No Clerk session exists in demo auth mode — "sign out" just returns
  // to the landing page.
  return async (_redirectUrl: string) => {};
}

const useSignOutAction = DEMO_AUTH ? useDemoSignOutAction : useClerkSignOutAction;

function DemoAuthBanner() {
  if (!DEMO_AUTH) return null;
  return <div className="flex items-center justify-center gap-2 bg-[hsl(var(--destructive)/.12)] px-4 py-2 text-center text-[11px] font-semibold uppercase tracking-[.14em] text-[hsl(var(--destructive))]" data-testid="banner-demo-auth">
    <ShieldCheck size={14} /> Demo auth — sign-in disabled, seeded workspace, local use only
  </div>;
}

function Shell({ children, session }: { children: ReactNode; session: any }) {
  const [location, setLocation] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const health = useHealthCheck();
  const signOutAction = useSignOutAction();
  const meta = pageMeta[location] ?? pageMeta['/workspace'];
  const business = session?.business;
  const user = session?.user;
  const handleSignOut = () => signOutAction(basePath || '/').then(() => setLocation('/'));

  return <div className="min-h-[100dvh] bg-background text-foreground">
    <aside className={`fixed inset-y-0 left-0 z-30 flex w-[248px] flex-col bg-[hsl(var(--sidebar))] px-4 py-5 text-[hsl(var(--sidebar-foreground))] transition-transform duration-300 md:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
      <div className="flex items-center justify-between px-3">
        <Link href="/workspace" className="flex items-center gap-3" data-testid="link-brand">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[hsl(var(--sidebar-primary))] font-mono text-sm font-bold text-[hsl(var(--sidebar-primary-foreground))]">LS</span>
          <span><span className="block text-[15px] font-bold tracking-[-.02em]">LeadSprint</span><span className="block text-[10px] uppercase tracking-[.2em] text-[hsl(var(--sidebar-foreground)/.52)]">Operator console</span></span>
        </Link>
        <button className="text-[hsl(var(--sidebar-foreground)/.65)] md:hidden" onClick={() => setMobileOpen(false)} data-testid="button-close-menu"><X size={18} /></button>
      </div>
      <div className="mt-9 px-3 text-[10px] font-bold uppercase tracking-[.2em] text-[hsl(var(--sidebar-foreground)/.42)]">Workspace</div>
      <nav className="mt-3 space-y-1" aria-label="Main navigation">
        {navItems.map((item) => {
          const active = item.href === location;
          const Icon = item.icon;
          return <Link key={item.href} href={item.href} onClick={() => setMobileOpen(false)} data-testid={`link-nav-${item.label.toLowerCase().replaceAll(' ', '-')}`} className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${active ? 'bg-[hsl(var(--sidebar-primary)/.16)] text-[hsl(var(--sidebar-primary))]' : 'text-[hsl(var(--sidebar-foreground)/.68)] hover:bg-[hsl(var(--sidebar-accent))] hover:text-[hsl(var(--sidebar-foreground))]'}`}>
            <Icon size={17} strokeWidth={active ? 2.4 : 1.8} /><span>{item.label}</span>{active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[hsl(var(--sidebar-primary))]" />}
          </Link>;
        })}
      </nav>
      <div className="mt-auto">
        <div className="mb-4 rounded-xl border border-[hsl(var(--sidebar-border))] bg-[hsl(var(--sidebar-accent)/.6)] p-3">
          <div className="flex items-center gap-2 text-xs font-semibold"><span className={`h-2 w-2 rounded-full ${health.isError ? 'bg-[hsl(var(--destructive))]' : 'animate-pulse-dot bg-[hsl(var(--sidebar-primary))]'}`} />{health.isError ? 'Service needs attention' : 'Systems operational'}</div>
          <p className="mt-2 text-[11px] leading-5 text-[hsl(var(--sidebar-foreground)/.5)]">Policy checks stay visible before any call is placed.</p>
        </div>
        <div className="flex items-center gap-3 border-t border-[hsl(var(--sidebar-border))] px-2 pt-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[hsl(var(--sidebar-primary)/.18)] font-mono text-[11px] text-[hsl(var(--sidebar-primary))]">{initials(user?.name)}</div>
          <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{user?.name || 'Operator'}</p><p className="truncate text-[11px] text-[hsl(var(--sidebar-foreground)/.5)]">{business?.name || 'Workspace'}</p></div>
           <button className="text-[hsl(var(--sidebar-foreground)/.55)] hover:text-[hsl(var(--sidebar-primary))]" onClick={handleSignOut} data-testid="button-logout" title="Sign out"><LogOut size={15} /></button>
        </div>
      </div>
    </aside>
    {mobileOpen && <button className="fixed inset-0 z-20 bg-[#102632]/40 md:hidden" onClick={() => setMobileOpen(false)} data-testid="button-close-overlay" aria-label="Close menu" />}
    <main className="min-h-[100dvh] md:pl-[248px]">
      <DemoAuthBanner />
      <header className="sticky top-0 z-10 border-b border-border bg-[hsl(var(--background)/.9)] backdrop-blur-xl">
        <div className="flex h-[76px] items-center justify-between px-5 sm:px-8 lg:px-10">
          <div className="flex items-center gap-3">
            <button className="rounded-lg p-2 text-muted-foreground hover:bg-[hsl(var(--muted))] md:hidden" onClick={() => setMobileOpen(true)} data-testid="button-open-menu"><Menu size={20} /></button>
            <div><p className="text-[10px] font-bold uppercase tracking-[.19em] text-[hsl(var(--accent))]">{meta.eyebrow}</p><h1 className="mt-0.5 text-xl font-bold tracking-[-.03em]">{meta.title}</h1></div>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            <span className="hidden text-xs text-muted-foreground sm:block">{business?.market === 'IN' ? 'India' : 'United States'} · {business?.timezone || 'Timezone not set'}</span>
            <button className="relative rounded-lg p-2 text-muted-foreground transition-colors hover:bg-[hsl(var(--muted))] hover:text-foreground" data-testid="button-notifications" title="Notifications"><Bell size={18} /><span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[hsl(var(--secondary))]" /></button>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-[1500px] px-5 py-7 sm:px-8 lg:px-10">{children}</div>
    </main>
  </div>;
}

function ClerkAuthGate({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  const auth = useGetAuthMe({ query: { queryKey: getGetAuthMeQueryKey(), enabled: isLoaded && Boolean(isSignedIn) } });
  if (!isLoaded || (isSignedIn && auth.isLoading)) return <AuthSkeleton />;
  if (!isSignedIn) return <LandingPage />;
  if (auth.isError || !auth.data) return <AuthError />;
  return <Shell session={auth.data}>{children}</Shell>;
}

function DemoAuthGate({ children }: { children: ReactNode }) {
  const auth = useGetAuthMe({ query: { queryKey: getGetAuthMeQueryKey() } });
  if (auth.isLoading) return <AuthSkeleton />;
  if (auth.isError || !auth.data) return <AuthError />;
  return <Shell session={auth.data}>{children}</Shell>;
}

const AuthGate = DEMO_AUTH ? DemoAuthGate : ClerkAuthGate;

function AuthSkeleton() {
  return <div className="min-h-[100dvh] bg-background p-8"><div className="mx-auto max-w-[1200px]"><Skeleton className="h-8 w-36" /><div className="mt-14 grid gap-5 sm:grid-cols-3"><Skeleton className="h-32" /><Skeleton className="h-32" /><Skeleton className="h-32" /></div></div></div>;
}

function LandingPage() {
  return <div className="flex min-h-[100dvh] items-center justify-center bg-[hsl(var(--background))] px-5 py-12">
    <div className="grid w-full max-w-[1050px] gap-10 rounded-3xl border border-border bg-[hsl(var(--card))] p-7 shadow-[0_24px_90px_hsl(209_43%_22%/.1)] md:grid-cols-[1.15fr_.85fr] md:p-12">
      <div className="flex flex-col justify-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[hsl(var(--primary))] font-mono text-sm font-bold text-[hsl(var(--primary-foreground))]">LS</div>
        <p className="mt-10 text-[10px] font-bold uppercase tracking-[.22em] text-[hsl(var(--accent))]">Lead response engine</p>
        <h1 className="mt-3 max-w-xl text-4xl font-bold tracking-[-.06em] sm:text-5xl">Turn every enquiry into a human-ready handoff.</h1>
        <p className="mt-5 max-w-lg text-base leading-7 text-muted-foreground">A policy-first operator console for real-estate teams running US and India market profiles.</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/sign-in" className="inline-flex items-center justify-center rounded-lg bg-[hsl(var(--primary))] px-4 py-3 text-sm font-bold text-[hsl(var(--primary-foreground))] transition hover:brightness-110" data-testid="link-sign-in">Sign in to workspace</Link>
          <Link href="/sign-up" className="inline-flex items-center justify-center rounded-lg border border-border px-4 py-3 text-sm font-bold text-foreground transition hover:bg-[hsl(var(--muted))]" data-testid="link-sign-up">Create workspace</Link>
        </div>
      </div>
      <div className="rounded-2xl bg-[hsl(var(--primary))] p-6 text-[hsl(var(--primary-foreground))] md:p-8">
        <p className="text-[10px] font-bold uppercase tracking-[.2em] text-[hsl(var(--secondary))]">Built for the moment after the form fill</p>
        <div className="mt-8 space-y-5">
          {['Qualify with approved language', 'Escalate when a human is needed', 'Book only verified appointments'].map((item, index) => <div key={item} className="flex items-start gap-3 border-t border-[hsl(var(--primary-foreground)/.15)] pt-5"><span className="font-mono text-xs text-[hsl(var(--secondary))]">0{index + 1}</span><p className="text-sm font-semibold leading-6">{item}</p></div>)}
        </div>
      </div>
    </div>
  </div>;
}

function AuthError() {
  const signOutAction = useSignOutAction();
  return <div className="flex min-h-[100dvh] items-center justify-center bg-background px-5"><div className="w-full max-w-[420px] rounded-2xl border border-border bg-[hsl(var(--card))] p-8 text-center"><AlertTriangle className="mx-auto text-[hsl(var(--destructive))]" size={24} /><h1 className="mt-4 text-xl font-bold">Workspace setup is incomplete</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">Your sign-in is valid, but the operator workspace could not be loaded. Try again or sign out.</p><div className="mt-6 flex justify-center gap-2"><Button onClick={() => window.location.reload()} variant="primary">Try again</Button><Button onClick={() => signOutAction(basePath || '/')}>Sign out</Button></div></div></div>;
}

function MetricCard({ label, value, detail, icon: Icon, tone = 'default', href }: { label: string; value: number | string; detail: string; icon: typeof UsersRound; tone?: 'default' | 'warm' | 'alert' | 'good'; href?: string }) {
  const content = <div className={`group rounded-xl border border-border bg-[hsl(var(--card))] p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_24px_hsl(209_43%_22%/.08)] ${tone === 'warm' ? 'border-[hsl(var(--secondary)/.45)]' : tone === 'alert' ? 'border-[hsl(var(--destructive)/.3)]' : tone === 'good' ? 'border-[hsl(var(--accent)/.3)]' : ''}`}>
    <div className="flex items-start justify-between"><span className="text-xs font-semibold text-muted-foreground">{label}</span><span className={`rounded-lg p-2 ${tone === 'warm' ? 'bg-[hsl(var(--secondary)/.25)] text-[hsl(var(--primary))]' : tone === 'alert' ? 'bg-[hsl(var(--destructive)/.1)] text-[hsl(var(--destructive))]' : tone === 'good' ? 'bg-[hsl(var(--accent)/.12)] text-[hsl(var(--accent))]' : 'bg-[hsl(var(--muted))] text-muted-foreground'}`}><Icon size={16} /></span></div>
    <div className="mt-4 flex items-end justify-between"><strong className="font-mono text-3xl tracking-[-.08em]">{value}</strong><span className="mb-1 text-right text-[11px] leading-4 text-muted-foreground">{detail}</span></div>
  </div>;
  return href ? <Link href={href} data-testid={`link-metric-${label.toLowerCase().replaceAll(' ', '-')}`}>{content}</Link> : content;
}

function TodayPage() {
  const today = useGetToday();
  const activity = useGetActivity({ limit: 8 });
  if (today.isLoading) return <div className="space-y-6"><Skeleton className="h-16 w-3/4" /><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[1, 2, 3, 4, 5, 6].map((n) => <Skeleton key={n} className="h-32" />)}</div></div>;
  if (today.isError || !today.data) return <ErrorState retry={() => today.refetch()} />;
  const { metrics, setup_warnings, upcoming, recent_activity } = today.data;
  const events = activity.data?.length ? activity.data : recent_activity;
  return <div className="animate-rise-in space-y-7">
    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><p className="text-sm text-muted-foreground">{today.data.date_label}</p><h2 className="mt-1 max-w-xl text-2xl font-bold tracking-[-.045em] sm:text-3xl">Good morning. Here’s where the desk stands.</h2></div><Link href="/workspace/leads" data-testid="link-review-leads" className="inline-flex items-center gap-2 self-start rounded-lg bg-[hsl(var(--secondary))] px-3.5 py-2.5 text-sm font-bold text-[hsl(var(--secondary-foreground))] transition hover:brightness-105 sm:self-auto">Review new leads <ChevronRight size={16} /></Link></div>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <MetricCard label="New leads" value={metrics.new_leads} detail="awaiting a first touch" icon={UsersRound} tone="warm" href="/workspace/leads" />
      <MetricCard label="Calls in progress" value={metrics.calls_in_progress} detail="live right now" icon={PhoneCall} tone="good" href="/workspace/calls" />
      <MetricCard label="Hot leads" value={metrics.hot_leads} detail="high intent signals" icon={Flame} tone="warm" href="/workspace/leads" />
      <MetricCard label="Appointments today" value={metrics.appointments_today} detail="verified meetings" icon={CalendarDays} tone="good" href="/workspace/appointments" />
      <MetricCard label="Failed calls" value={metrics.failed_calls} detail="need an operator look" icon={AlertTriangle} tone={metrics.failed_calls ? 'alert' : 'default'} href="/workspace/calls" />
      <MetricCard label="Unresolved messages" value={metrics.unresolved_messages} detail="waiting on a reply" icon={MessageSquare} tone={metrics.unresolved_messages ? 'warm' : 'default'} />
    </div>
    {setup_warnings.length > 0 && <section className="rounded-xl border border-[hsl(var(--secondary)/.55)] bg-[hsl(var(--secondary)/.14)] p-5"><div className="flex items-start gap-3"><div className="rounded-lg bg-[hsl(var(--secondary)/.45)] p-2 text-[hsl(var(--primary))]"><ShieldCheck size={18} /></div><div className="flex-1"><div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="font-bold">Setup checks before you dial</h3><Link href="/workspace/business-settings" className="text-xs font-bold text-[hsl(var(--accent))] hover:underline" data-testid="link-fix-settings">Open settings <ArrowUpRight size={13} className="ml-1 inline" /></Link></div><div className="mt-3 grid gap-2 sm:grid-cols-2">{setup_warnings.map((warning, index) => <div key={warning} className="flex items-start gap-2 text-sm text-[hsl(var(--foreground)/.78)]"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[hsl(var(--secondary-foreground))]" />{warning}</div>)}</div></div></div></section>}
    <div className="grid gap-5 xl:grid-cols-[1.15fr_.85fr]">
      <section className="rounded-xl border border-border bg-[hsl(var(--card))]"><div className="flex items-center justify-between border-b border-border px-5 py-4"><div><h3 className="font-bold">Upcoming handoffs</h3><p className="mt-0.5 text-xs text-muted-foreground">Confirmed meetings on the calendar</p></div><Link href="/workspace/appointments" className="text-xs font-bold text-[hsl(var(--accent))]" data-testid="link-all-appointments">View all</Link></div>
        {upcoming.length === 0 ? <EmptyState icon={CalendarDays} title="No appointments on deck" description="Verified bookings will appear here once a lead chooses a slot." /> : <div className="divide-y divide-border">{upcoming.slice(0, 5).map((appointment) => <div key={appointment.id} className="flex items-center gap-3 px-5 py-4"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--muted))] font-mono text-xs text-[hsl(var(--primary))]">{formatTime(appointment.start_time)}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{appointment.lead_name}</p><p className="truncate text-xs text-muted-foreground">{appointment.service_or_property} · {appointment.calendar_provider}</p></div><Badge className={statusTone(appointment.status)}>{appointment.status}</Badge></div>)}</div>}
      </section>
      <section className="rounded-xl border border-border bg-[hsl(var(--card))]"><div className="border-b border-border px-5 py-4"><h3 className="font-bold">Recent activity</h3><p className="mt-0.5 text-xs text-muted-foreground">The last few desk movements</p></div>
        {!events?.length ? <EmptyState icon={ActivityIcon} title="The desk is quiet" description="Lead, call, booking, and import events will land here." /> : <div className="divide-y divide-border">{events.slice(0, 6).map((event) => <div key={event.id} className="flex gap-3 px-5 py-4"><div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--muted))] text-[hsl(var(--accent))]"><CircleDot size={13} /></div><div className="min-w-0"><p className="text-sm font-semibold">{event.title}</p><p className="mt-0.5 text-xs leading-5 text-muted-foreground">{event.detail}</p><p className="mt-1 font-mono text-[10px] text-muted-foreground">{relativeTime(event.created_at)}</p></div></div>)}</div>}
      </section>
    </div>
  </div>;
}

function LeadDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const lead = useGetLead(id, { query: { enabled: !!id, queryKey: getGetLeadQueryKey(id) } });
  const update = useUpdateLead();
  const suppress = useSuppressLead();
  const startCall = useStartCall();
  const availability = useGetAvailability();
  const book = useBookAppointment();
  const [bookDate, setBookDate] = useState(new Date().toISOString().slice(0, 10));
  const [message, setMessage] = useState('');
  const data = lead.data;
  if (lead.isLoading) return <div className="fixed inset-0 z-40 flex justify-end bg-[#102632]/30"><div className="h-full w-full max-w-[540px] bg-[hsl(var(--card))] p-6"><Skeleton className="h-8 w-1/2" /><Skeleton className="mt-8 h-40" /></div></div>;
  if (lead.isError || !data) return <div className="fixed inset-0 z-40 flex justify-end bg-[#102632]/30"><div className="h-full w-full max-w-[540px] bg-[hsl(var(--card))] p-6"><ErrorState retry={() => lead.refetch()} /><Button onClick={onClose} data-testid="button-close-lead-error">Close</Button></div></div>;
  const patch = (payload: any, successMessage: string) => update.mutate({ id, data: payload }, { onSuccess: (updated) => { queryClient.setQueryData(getGetLeadQueryKey(id), updated); queryClient.invalidateQueries({ queryKey: getGetLeadsQueryKey() }); setMessage(successMessage); } });
  const handleCall = () => startCall.mutate({ data: { lead_id: id } }, { onSuccess: () => { setMessage('Call queued. Watch Calls for the provider handoff.'); queryClient.invalidateQueries({ queryKey: getGetCallsQueryKey() }); } });
  const checkAvailability = () => availability.mutate({ data: { lead_id: id, date: bookDate } });
  return <div className="fixed inset-0 z-40 flex justify-end bg-[#102632]/30" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="flex h-full w-full max-w-[560px] flex-col overflow-hidden bg-[hsl(var(--card))] shadow-[-20px_0_60px_hsl(209_43%_22%/.16)]">
    <div className="flex items-start justify-between border-b border-border p-6"><div className="flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-full bg-[hsl(var(--secondary)/.45)] font-mono text-sm font-bold text-[hsl(var(--primary))]">{initials(data.name)}</div><div><p className="text-lg font-bold tracking-[-.03em]">{data.name}</p><p className="text-xs text-muted-foreground">{data.source} · {data.campaign || 'No campaign'}</p></div></div><button className="rounded-lg p-2 text-muted-foreground hover:bg-[hsl(var(--muted))]" onClick={onClose} data-testid="button-close-lead"><X size={18} /></button></div>
    <div className="scrollbar-subtle flex-1 overflow-y-auto p-6">
      {message && <div className="mb-5 flex items-center gap-2 rounded-lg bg-[hsl(var(--accent)/.1)] px-3 py-2.5 text-xs font-semibold text-[hsl(var(--accent))]"><CheckCircle2 size={15} />{message}</div>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><div className="rounded-lg bg-[hsl(var(--muted)/.65)] p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Intent</p><p className="mt-1 font-mono text-xl font-bold">{data.intent_score}</p></div><div className="rounded-lg bg-[hsl(var(--muted)/.65)] p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Score</p><div className="mt-1"><Badge className={scoreTone(data.score)}>{data.score}</Badge></div></div><div className="rounded-lg bg-[hsl(var(--muted)/.65)] p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Status</p><div className="mt-1"><Badge className={statusTone(data.status)}>{data.status}</Badge></div></div><div className="rounded-lg bg-[hsl(var(--muted)/.65)] p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Last call</p><p className="mt-1 text-xs font-semibold">{data.last_call ? relativeTime(data.last_call) : 'Never'}</p></div></div>
      <div className="mt-6 flex flex-wrap gap-2"><Button variant="primary" onClick={handleCall} disabled={startCall.isPending || data.suppressed} data-testid="button-call-lead"><PhoneCall size={15} />{startCall.isPending ? 'Queueing…' : 'Call now'}</Button><Button onClick={() => patch({ status: 'qualified', qualification_status: 'operator_confirmed' }, 'Lead marked qualified.')} data-testid="button-qualify-lead"><Check size={15} />Mark qualified</Button><Button onClick={() => patch({ status: 'contacted', next_action: 'Follow up with operator' }, 'Follow-up added to next action.')} data-testid="button-follow-up"><Clock3 size={15} />Follow up</Button>{!data.suppressed && <Button variant="danger" onClick={() => suppress.mutate({ id, data: { reason: 'Operator suppression' } }, { onSuccess: () => { setMessage('Lead suppressed from future calls.'); queryClient.invalidateQueries({ queryKey: getGetLeadsQueryKey() }); queryClient.setQueryData(getGetLeadQueryKey(id), (old: any) => old ? { ...old, suppressed: true, status: 'suppressed' } : old); } })} data-testid="button-suppress-lead"><ShieldCheck size={15} />Suppress</Button>}</div>
      <section className="mt-7"><h3 className="text-xs font-bold uppercase tracking-[.15em] text-muted-foreground">Lead context</h3><div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-4 text-sm"><Info label="Phone" value={data.phone} /><Info label="Email" value={data.email || 'Not provided'} /><Info label="Property" value={data.property_type} /><Info label="Project" value={data.project} /><Info label="Location" value={data.location} /><Info label="Budget" value={data.budget_label} /><Info label="Timeline" value={data.timeline} /><Info label="Language" value={data.preferred_language} /></div></section>
      <section className="mt-7 rounded-xl border border-border p-4"><div className="flex items-center justify-between"><div><h3 className="font-bold">Verified booking</h3><p className="mt-1 text-xs text-muted-foreground">Check live availability before offering a slot.</p></div><CalendarDays size={18} className="text-[hsl(var(--accent))]" /></div><div className="mt-4 flex gap-2"><input type="date" value={bookDate} onChange={(event) => setBookDate(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm" data-testid="input-availability-date" /><Button onClick={checkAvailability} disabled={availability.isPending} data-testid="button-check-availability">{availability.isPending ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}Check</Button></div>{availability.data && <div className="mt-3 space-y-2">{availability.data.length === 0 ? <p className="text-xs text-muted-foreground">No open slots for this date.</p> : availability.data.map((slot) => <button key={slot.start_time} onClick={() => book.mutate({ data: { lead_id: id, slot_start: slot.start_time, slot_end: slot.end_time } }, { onSuccess: () => { setMessage('Appointment booked and verified.'); queryClient.invalidateQueries({ queryKey: getGetAppointmentsQueryKey() }); } })} className="flex w-full items-center justify-between rounded-lg border border-border px-3 py-2 text-left text-sm transition hover:border-[hsl(var(--accent))] hover:bg-[hsl(var(--accent)/.06)]" data-testid={`button-book-slot-${slot.start_time}`}><span>{slot.label}</span><ChevronRight size={14} className="text-muted-foreground" /></button>)}</div>}</section>
      <section className="mt-6 rounded-xl bg-[hsl(var(--muted)/.55)] p-4"><p className="text-[10px] font-bold uppercase tracking-[.15em] text-muted-foreground">Next action</p><p className="mt-2 text-sm font-semibold">{data.next_action || 'No next action set'}</p><p className="mt-1 text-xs text-muted-foreground">Qualification: {data.qualification_status || 'Not reviewed'}</p></section>
    </div>
  </div></div>;
}

function Info({ label, value }: { label: string; value: string }) {
  return <div><p className="text-[11px] text-muted-foreground">{label}</p><p className="mt-1 truncate font-medium">{value}</p></div>;
}

function LeadsPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [score, setScore] = useState('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const importLeads = useImportLeads();
  const params = useMemo(() => ({ ...(search ? { search } : {}), ...(status !== 'all' ? { status: status as any } : {}), ...(score !== 'all' ? { score: score as any } : {}) }), [search, status, score]);
  const leads = useGetLeads(params);
  const startCall = useStartCall();
  const queryClient = useQueryClient();
  const handleImport = (event: any) => {
    const file = event.target.files?.[0] as File | undefined;
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const lines = String(reader.result || '').trim().split(/\r?\n/);
      const [header, ...rows] = lines;
      const keys = header.split(',').map((key) => key.trim().toLowerCase());
      const parsed = rows.filter(Boolean).map((line) => { const values = line.split(',').map((value) => value.trim()); return keys.reduce((record: any, key, index) => { record[key] = values[index] || ''; return record; }, {}); });
      importLeads.mutate({ data: { rows: parsed as any } }, { onSuccess: () => { setShowImport(false); queryClient.invalidateQueries({ queryKey: getGetLeadsQueryKey() }); } });
    };
    reader.readAsText(file);
  };
  return <div className="animate-rise-in space-y-5">
    <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end"><div><p className="text-sm text-muted-foreground">A lead is a conversation waiting for context.</p><div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><span className="font-mono text-foreground">{leads.data?.length ?? '—'}</span> visible leads <span className="text-border">/</span> sorted by latest signal</div></div><div className="flex gap-2"><Button onClick={() => setShowImport(true)} data-testid="button-open-import"><Upload size={15} />Import CSV</Button><Link href="/workspace/leads" data-testid="link-refresh-leads" className="inline-flex items-center gap-2 rounded-lg border border-border bg-[hsl(var(--card))] px-3 py-2 text-sm font-semibold hover:bg-[hsl(var(--muted))]"><RefreshCw size={15} />Refresh</Link></div></div>
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-[hsl(var(--card))] p-3 md:flex-row"><div className="relative min-w-0 flex-1"><Search className="absolute left-3 top-2.5 text-muted-foreground" size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, phone, project…" className="w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-sm outline-none focus:border-[hsl(var(--accent))]" data-testid="input-search-leads" /></div><div className="flex gap-2"><select value={status} onChange={(event) => setStatus(event.target.value)} className="rounded-lg border border-input bg-background px-3 py-2 text-sm" data-testid="select-lead-status"><option value="all">All statuses</option><option value="new">New</option><option value="contacted">Contacted</option><option value="qualified">Qualified</option><option value="booked">Booked</option><option value="suppressed">Suppressed</option></select><select value={score} onChange={(event) => setScore(event.target.value)} className="rounded-lg border border-input bg-background px-3 py-2 text-sm" data-testid="select-lead-score"><option value="all">All scores</option><option value="hot">Hot</option><option value="warm">Warm</option><option value="cold">Cold</option></select><Button variant="quiet" className="px-2" data-testid="button-filter-leads"><Filter size={16} /></Button></div></div>
    {leads.isLoading ? <div className="space-y-2">{[1, 2, 3, 4, 5].map((n) => <Skeleton key={n} className="h-20" />)}</div> : leads.isError ? <ErrorState retry={() => leads.refetch()} /> : !leads.data?.length ? <EmptyState icon={UsersRound} title="No leads match that view" description="Try clearing a filter or import a normalized CSV to start the desk." action={<Button onClick={() => { setSearch(''); setStatus('all'); setScore('all'); }} data-testid="button-clear-lead-filters">Clear filters</Button>} /> : <div className="overflow-hidden rounded-xl border border-border bg-[hsl(var(--card))]"><div className="hidden grid-cols-[minmax(220px,1.3fr)_1fr_1fr_1fr_120px] gap-4 border-b border-border bg-[hsl(var(--muted)/.55)] px-5 py-3 text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground md:grid"><span>Lead</span><span>Intent</span><span>Need</span><span>Next action</span><span /></div><div className="divide-y divide-border">{leads.data.map((lead) => <div key={lead.id} className="grid gap-3 px-4 py-4 transition hover:bg-[hsl(var(--muted)/.32)] md:grid-cols-[minmax(220px,1.3fr)_1fr_1fr_1fr_120px] md:items-center md:gap-4 md:px-5" data-testid={`row-lead-${lead.id}`}><button className="flex min-w-0 items-center gap-3 text-left" onClick={() => setSelected(lead.id)} data-testid={`button-open-lead-${lead.id}`}><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--secondary)/.35)] font-mono text-[11px] font-bold text-[hsl(var(--primary))]">{initials(lead.name)}</span><span className="min-w-0"><span className="block truncate text-sm font-bold">{lead.name}</span><span className="mt-0.5 block truncate text-xs text-muted-foreground">{lead.phone} · {lead.project}</span></span></button><div className="flex items-center gap-2"><Badge className={scoreTone(lead.score)}>{lead.score}</Badge><span className="font-mono text-xs text-muted-foreground">{lead.intent_score}/100</span></div><div><p className="text-sm font-medium">{lead.property_type}</p><p className="mt-0.5 text-xs text-muted-foreground">{lead.budget_label} · {lead.timeline}</p></div><div><p className="text-sm font-medium">{lead.next_action || 'Review lead'}</p><p className="mt-0.5 text-xs text-muted-foreground">{relativeTime(lead.last_call || lead.created_at)}</p></div><div className="flex items-center justify-end gap-1"><button onClick={() => startCall.mutate({ data: { lead_id: lead.id } }, { onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetCallsQueryKey() }) })} disabled={lead.suppressed || startCall.isPending} className="rounded-lg p-2 text-[hsl(var(--accent))] hover:bg-[hsl(var(--accent)/.1)] disabled:opacity-40" title="Call now" data-testid={`button-call-row-${lead.id}`}><Phone size={16} /></button><button onClick={() => setSelected(lead.id)} className="rounded-lg p-2 text-muted-foreground hover:bg-[hsl(var(--muted))]" title="Open details" data-testid={`button-details-row-${lead.id}`}><ChevronRight size={16} /></button></div></div>)}</div></div>}
    {selected && <LeadDetail id={selected} onClose={() => setSelected(null)} />}
    {showImport && <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#102632]/35 p-5"><div className="w-full max-w-[440px] rounded-2xl border border-border bg-[hsl(var(--card))] p-6 shadow-2xl"><div className="flex items-start justify-between"><div><h2 className="text-lg font-bold">Import lead rows</h2><p className="mt-1 text-sm text-muted-foreground">Use a CSV with name and phone columns.</p></div><button onClick={() => setShowImport(false)} data-testid="button-close-import"><X size={18} /></button></div><label className="mt-6 flex cursor-pointer flex-col items-center rounded-xl border border-dashed border-[hsl(var(--accent)/.5)] bg-[hsl(var(--accent)/.04)] p-8 text-center hover:bg-[hsl(var(--accent)/.08)]"><Upload className="text-[hsl(var(--accent))]" size={22} /><span className="mt-3 text-sm font-semibold">Choose CSV file</span><span className="mt-1 text-xs text-muted-foreground">Rows are normalized before import.</span><input type="file" accept=".csv,text/csv" onChange={handleImport} className="hidden" data-testid="input-import-csv" /></label>{importLeads.isPending && <p className="mt-3 text-xs text-muted-foreground">Importing rows…</p>}{importLeads.isError && <p className="mt-3 text-xs text-[hsl(var(--destructive))]">Import failed. Check required columns.</p>}<Button variant="quiet" className="mt-5 w-full" onClick={() => setShowImport(false)} data-testid="button-cancel-import">Cancel</Button></div></div>}
  </div>;
}

function CallsPage() {
  const [status, setStatus] = useState('all');
  const [selected, setSelected] = useState<string | null>(null);
  const calls = useGetCalls(status === 'all' ? undefined : { status: status as any });
  const call = useGetCall(selected || '', { query: { enabled: !!selected, queryKey: getGetCallQueryKey(selected || '') } });
  const startCall = useStartCall();
  if (calls.isLoading) return <div className="space-y-3">{[1, 2, 3, 4, 5].map((n) => <Skeleton key={n} className="h-24" />)}</div>;
  if (calls.isError) return <ErrorState retry={() => calls.refetch()} />;
  return <div className="animate-rise-in space-y-5"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><p className="text-sm text-muted-foreground">Provider events, operator decisions, and the human-readable result.</p></div><select value={status} onChange={(event) => setStatus(event.target.value)} className="w-fit rounded-lg border border-input bg-[hsl(var(--card))] px-3 py-2 text-sm" data-testid="select-call-status"><option value="all">All call states</option><option value="completed">Completed</option><option value="in_progress">In progress</option><option value="failed">Failed</option><option value="uncertain">Uncertain</option><option value="policy_blocked">Policy blocked</option></select></div>{!calls.data?.length ? <EmptyState icon={Headphones} title="No calls in this window" description="When a lead is called, provider state and outcome will be kept here." /> : <div className="overflow-hidden rounded-xl border border-border bg-[hsl(var(--card))]"><div className="hidden grid-cols-[1.25fr_1fr_1fr_1fr_1.4fr_40px] gap-4 border-b border-border bg-[hsl(var(--muted)/.55)] px-5 py-3 text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground md:grid"><span>Lead</span><span>Provider</span><span>State</span><span>Duration</span><span>Outcome</span><span /></div><div className="divide-y divide-border">{calls.data.map((item) => <div key={item.id} className="grid gap-3 px-4 py-4 md:grid-cols-[1.25fr_1fr_1fr_1fr_1.4fr_40px] md:items-center md:gap-4 md:px-5" data-testid={`row-call-${item.id}`}><div><button onClick={() => setSelected(item.id)} className="text-left text-sm font-bold hover:text-[hsl(var(--accent))]" data-testid={`button-open-call-${item.id}`}>{item.lead_name}</button><p className="mt-0.5 text-xs text-muted-foreground">{item.phone} · {formatDate(item.started_at)}</p></div><div className="text-sm"><span className="font-medium">{item.provider}</span>{item.transferred && <span className="ml-2 text-[11px] text-[hsl(var(--accent))]">Transferred</span>}</div><div><Badge className={statusTone(item.status)}>{item.status.replaceAll('_', ' ')}</Badge></div><div className="font-mono text-xs text-muted-foreground">{item.duration_seconds ? `${Math.floor(item.duration_seconds / 60)}m ${item.duration_seconds % 60}s` : '—'}</div><div><p className="line-clamp-2 text-sm">{item.outcome || item.summary || 'No outcome recorded'}</p>{item.error_state && <p className="mt-1 text-xs text-[hsl(var(--destructive))]">{item.error_state}</p>}</div><button className="rounded-lg p-2 text-muted-foreground hover:bg-[hsl(var(--muted))]" onClick={() => setSelected(item.id)} data-testid={`button-call-menu-${item.id}`}><MoreHorizontal size={16} /></button></div>)}</div></div>}{selected && <div className="fixed inset-0 z-40 flex justify-end bg-[#102632]/30" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}><div className="h-full w-full max-w-[510px] overflow-y-auto bg-[hsl(var(--card))] p-6"><div className="flex justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-[hsl(var(--accent))]">Call detail</p><h2 className="mt-1 text-2xl font-bold">{call.data?.lead_name || 'Call'}</h2></div><button onClick={() => setSelected(null)} data-testid="button-close-call"><X size={18} /></button></div>{call.isLoading ? <div className="mt-8 space-y-3"><Skeleton className="h-24" /><Skeleton className="h-40" /></div> : call.data && <><div className="mt-6 grid grid-cols-2 gap-3"><Info label="State" value={call.data.status.replaceAll('_', ' ')} /><Info label="Provider" value={call.data.provider} /><Info label="Started" value={formatTime(call.data.started_at)} /><Info label="Duration" value={call.data.duration_seconds ? `${call.data.duration_seconds}s` : '—'} /></div><div className="mt-6 rounded-xl bg-[hsl(var(--muted)/.55)] p-4"><p className="text-[10px] font-bold uppercase tracking-[.15em] text-muted-foreground">Summary</p><p className="mt-2 text-sm leading-6">{call.data.summary || 'No summary recorded.'}</p></div><div className="mt-4 flex gap-2"><Badge className={call.data.booked ? statusTone('confirmed') : statusTone('created')}>{call.data.booked ? 'Appointment booked' : 'No booking'}</Badge>{call.data.transferred && <Badge className={statusTone('qualified')}>Transferred</Badge>}</div></>}{call.data?.error_state && <div className="mt-5 rounded-lg border border-[hsl(var(--destructive)/.25)] p-4 text-sm text-[hsl(var(--destructive))]"><AlertTriangle size={15} className="mr-2 inline" />{call.data.error_state}</div>}<Button variant="primary" className="mt-7" onClick={() => { if (call.data) startCall.mutate({ data: { lead_id: call.data.lead_id } }); }} disabled={!call.data || startCall.isPending} data-testid="button-retry-call"><PhoneCall size={15} />Retry call</Button></div></div>}</div>;
}

function AppointmentsPage() {
  const appointments = useGetAppointments();
  if (appointments.isLoading) return <div className="space-y-3">{[1, 2, 3].map((n) => <Skeleton key={n} className="h-24" />)}</div>;
  if (appointments.isError) return <ErrorState retry={() => appointments.refetch()} />;
  return <div className="animate-rise-in space-y-6"><div><p className="text-sm text-muted-foreground">Every row below has a source lead and a calendar confirmation.</p></div>{!appointments.data?.length ? <EmptyState icon={CalendarDays} title="No verified appointments yet" description="Once a lead books through the approved calendar, it will be visible here." /> : <div className="grid gap-4 lg:grid-cols-2">{appointments.data.map((appointment) => <div key={appointment.id} className="rounded-xl border border-border bg-[hsl(var(--card))] p-5 transition hover:-translate-y-0.5 hover:shadow-[0_8px_24px_hsl(209_43%_22%/.08)]" data-testid={`card-appointment-${appointment.id}`}><div className="flex items-start justify-between gap-4"><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[hsl(var(--accent)/.11)] font-mono text-xs font-bold text-[hsl(var(--accent))]">{formatTime(appointment.start_time)}</div><div><h3 className="font-bold">{appointment.lead_name}</h3><p className="mt-0.5 text-xs text-muted-foreground">{appointment.service_or_property}</p></div></div><Badge className={statusTone(appointment.status)}>{appointment.status}</Badge></div><div className="mt-5 grid grid-cols-2 gap-y-3 border-t border-border pt-4 text-sm"><Info label="Date" value={formatDate(appointment.start_time)} /><Info label="Timezone" value={appointment.timezone} /><Info label="Calendar" value={appointment.calendar_provider} /><Info label="External ID" value={appointment.external_id} /></div><Link href="/workspace/leads" className="mt-5 inline-flex items-center gap-1 text-xs font-bold text-[hsl(var(--accent))]" data-testid={`link-source-lead-${appointment.id}`}>Open source lead <ChevronRight size={13} /></Link></div>)}</div>}</div>;
}

function SettingsPage() {
  const settings = useGetBusinessSettings();
  const update = useUpdateBusinessSettings();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<any>(null);
  if (settings.isLoading) return <div className="space-y-4"><Skeleton className="h-24" /><Skeleton className="h-96" /></div>;
  if (settings.isError || !settings.data) return <ErrorState retry={() => settings.refetch()} />;
  const data = draft || settings.data;
  const set = (key: string, value: any) => setDraft((current: any) => ({ ...(current || settings.data), [key]: value }));
  const save = (event: FormEvent) => { event.preventDefault(); const payload = { market: data.market, timezone: data.timezone, transfer_number: data.transfer_number, project_name: data.project_name, approved_faq: data.approved_faq, qualification_questions: data.qualification_questions, recording_disclosure: data.recording_disclosure, ai_disclosure: data.ai_disclosure, quiet_hours: data.quiet_hours, max_call_attempts: Number(data.max_call_attempts) }; update.mutate({ data: payload }, { onSuccess: (updated) => { setDraft(updated); queryClient.setQueryData(getGetBusinessSettingsQueryKey(), updated); } }); };
  return <form onSubmit={save} className="animate-rise-in space-y-6"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><p className="text-sm text-muted-foreground">These settings gate what the operator console is allowed to do.</p></div><Button variant="primary" type="submit" disabled={update.isPending} data-testid="button-save-settings">{update.isPending && <Loader2 size={15} className="animate-spin" />}{update.isPending ? 'Saving…' : 'Save changes'}</Button></div><div className="grid gap-5 xl:grid-cols-[1.2fr_.8fr]"><section className="rounded-xl border border-border bg-[hsl(var(--card))] p-5"><SectionTitle icon={SlidersHorizontal} title="Business context" detail="How LeadSprint speaks for your desk." /><div className="mt-6 grid gap-4 sm:grid-cols-2"><Field label="Business name" value={data.name} disabled testId="input-business-name" /><Field label="Project / desk name" value={data.project_name} onChange={(value) => set('project_name', value)} testId="input-project-name" /><label className="block text-sm font-semibold">Market<select value={data.market} onChange={(event) => set('market', event.target.value)} className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm" data-testid="select-market"><option value="US">United States</option><option value="IN">India</option></select></label><Field label="Timezone" value={data.timezone} onChange={(value) => set('timezone', value)} testId="input-timezone" /><Field label="Transfer number" value={data.transfer_number} onChange={(value) => set('transfer_number', value)} testId="input-transfer-number" /><Field label="Quiet hours" value={data.quiet_hours} onChange={(value) => set('quiet_hours', value)} testId="input-quiet-hours" /></div><div className="mt-5 grid gap-3 sm:grid-cols-2"><Toggle label="Recording disclosure" detail="Tell the caller when calls are recorded." checked={data.recording_disclosure} onChange={(value) => set('recording_disclosure', value)} testId="toggle-recording" /><Toggle label="AI disclosure" detail="Make the assistant identity clear." checked={data.ai_disclosure} onChange={(value) => set('ai_disclosure', value)} testId="toggle-ai" /></div></section><section className="rounded-xl border border-border bg-[hsl(var(--card))] p-5"><SectionTitle icon={ShieldCheck} title="Policy controls" detail="Guardrails for safe follow-through." /><div className="mt-6 space-y-4"><label className="block text-sm font-semibold">Maximum call attempts<input type="number" min="1" max="10" value={data.max_call_attempts} onChange={(event) => set('max_call_attempts', event.target.value)} className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm" data-testid="input-max-attempts" /></label><div className="rounded-lg bg-[hsl(var(--muted)/.6)] p-4"><p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Connected services</p><div className="mt-4 space-y-3"><ServiceRow label="Retell agent" value={data.retell_agent_id} /><ServiceRow label="Cal.com event type" value={data.cal_event_type_id} /></div></div></div></section></div><section className="rounded-xl border border-border bg-[hsl(var(--card))] p-5"><SectionTitle icon={MessageSquare} title="Approved language" detail="Keep the assistant inside the lines your team trusts." /><div className="mt-6 grid gap-5 lg:grid-cols-2"><TextArea label="Approved FAQ" value={data.approved_faq} onChange={(value) => set('approved_faq', value)} testId="textarea-approved-faq" /><TextArea label="Qualification questions" value={(data.qualification_questions || []).join('\\n')} onChange={(value) => set('qualification_questions', value.split('\\n').filter(Boolean))} testId="textarea-qualification" /></div><div className="mt-5"><TextArea label="Escalation rules" value={data.escalation_rules} disabled testId="textarea-escalation" /></div></section></form>;
}

function SectionTitle({ icon: Icon, title, detail }: { icon: typeof ShieldCheck; title: string; detail: string }) {
  return <div className="flex items-start gap-3"><div className="rounded-lg bg-[hsl(var(--accent)/.1)] p-2 text-[hsl(var(--accent))]"><Icon size={17} /></div><div><h2 className="font-bold">{title}</h2><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div></div>;
}
function Field({ label, value, onChange, disabled, testId }: { label: string; value: string; onChange?: (value: string) => void; disabled?: boolean; testId: string }) {
  return <label className="block text-sm font-semibold">{label}<input value={value || ''} onChange={(event) => onChange?.(event.target.value)} disabled={disabled} className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-[hsl(var(--accent))] disabled:bg-[hsl(var(--muted)/.5)] disabled:text-muted-foreground" data-testid={testId} /></label>;
}
function TextArea({ label, value, onChange, disabled, testId }: { label: string; value: string; onChange?: (value: string) => void; disabled?: boolean; testId: string }) {
  return <label className="block text-sm font-semibold">{label}<textarea value={value || ''} onChange={(event) => onChange?.(event.target.value)} disabled={disabled} rows={5} className="mt-2 w-full resize-y rounded-lg border border-input bg-background px-3 py-2.5 text-sm leading-6 outline-none focus:border-[hsl(var(--accent))] disabled:bg-[hsl(var(--muted)/.5)]" data-testid={testId} /></label>;
}
function Toggle({ label, detail, checked, onChange, testId }: { label: string; detail: string; checked: boolean; onChange: (value: boolean) => void; testId: string }) {
  return <button type="button" onClick={() => onChange(!checked)} className="flex items-center justify-between rounded-lg border border-border p-3 text-left transition hover:bg-[hsl(var(--muted)/.5)]" data-testid={testId}><span><span className="block text-sm font-semibold">{label}</span><span className="mt-1 block text-xs font-normal text-muted-foreground">{detail}</span></span><span className={`relative h-5 w-9 rounded-full transition-colors ${checked ? 'bg-[hsl(var(--accent))]' : 'bg-[hsl(var(--border))]'}`}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-[hsl(var(--card))] shadow transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} /></span></button>;
}
function ServiceRow({ label, value }: { label: string; value?: string | null }) {
  return <div className="flex items-center justify-between gap-3"><span className="text-sm font-medium">{label}</span>{value ? <Badge className="bg-[hsl(var(--accent)/.12)] text-[hsl(var(--accent))]"><Check size={12} className="mr-1" />Connected</Badge> : <Badge className="bg-[hsl(var(--secondary)/.28)] text-[hsl(var(--primary))]">Not configured</Badge>}</div>;
}

function ReportsPage() {
  const report = useGetWeeklyReport();
  const usage = useGetUsage();
  if (report.isLoading || usage.isLoading) return <div className="space-y-5"><Skeleton className="h-32" /><div className="grid gap-4 sm:grid-cols-3"><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /></div></div>;
  if (report.isError || usage.isError || !report.data || !usage.data) return <ErrorState retry={() => { report.refetch(); usage.refetch(); }} />;
  const data = report.data;
  const bars = [{ label: 'Leads received', value: data.leads_received }, { label: 'Calls attempted', value: data.calls_attempted }, { label: 'Qualified leads', value: data.qualified_leads }, { label: 'Appointments', value: data.appointments_booked }];
  return <div className="animate-rise-in space-y-7"><div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end"><div><p className="text-sm text-muted-foreground">{data.period_label}</p><h2 className="mt-1 text-2xl font-bold tracking-[-.04em]">A weekly pulse, not a vanity dashboard.</h2></div><span className="font-mono text-xs text-muted-foreground">Updated just now</span></div><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[{ label: 'Leads received', value: data.leads_received, detail: 'new enquiries', icon: UsersRound }, { label: 'Connected calls', value: data.calls_connected, detail: `${data.calls_attempted} attempted`, icon: PhoneCall }, { label: 'Qualified', value: data.qualified_leads, detail: 'operator-confirmed', icon: Target }, { label: 'Appointments', value: data.appointments_booked, detail: `${data.transfer_rate}% transfer rate`, icon: CalendarDays }].map((item) => <div key={item.label} className="rounded-xl border border-border bg-[hsl(var(--card))] p-5"><div className="flex justify-between"><p className="text-xs font-semibold text-muted-foreground">{item.label}</p><item.icon size={17} className="text-[hsl(var(--accent))]" /></div><p className="mt-5 font-mono text-3xl font-bold tracking-[-.07em]">{item.value}</p><p className="mt-1 text-xs text-muted-foreground">{item.detail}</p></div>)}</div><div className="grid gap-5 lg:grid-cols-[1.1fr_.9fr]"><section className="rounded-xl border border-border bg-[hsl(var(--card))] p-5"><h3 className="font-bold">Funnel movement</h3><p className="mt-1 text-xs text-muted-foreground">Counts across the current pilot period.</p><div className="mt-7 space-y-5">{bars.map((bar, index) => <div key={bar.label}><div className="mb-2 flex justify-between text-sm"><span className="font-semibold">{bar.label}</span><span className="font-mono text-xs text-muted-foreground">{bar.value}</span></div><div className="h-2 overflow-hidden rounded-full bg-[hsl(var(--muted))]"><div className="h-full rounded-full bg-[hsl(var(--accent))] transition-all" style={{ width: `${Math.max(7, Math.min(100, (bar.value / Math.max(1, data.leads_received)) * 100))}%`, opacity: 1 - index * .13 }} /></div></div>)}</div><div className="mt-7 grid grid-cols-2 gap-4 border-t border-border pt-5"><Info label="Failed actions" value={String(data.failed_actions)} /><Info label="Voice minutes" value={String(data.voice_minutes)} /></div></section><section className="rounded-xl border border-border bg-[hsl(var(--primary))] p-5 text-[hsl(var(--primary-foreground))]"><div className="flex items-start justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-[hsl(var(--secondary))]">Current usage</p><h3 className="mt-2 text-xl font-bold">{usage.data.period_label}</h3></div><ActivityIcon size={19} className="text-[hsl(var(--secondary))]" /></div><div className="mt-8"><div className="flex items-end justify-between"><span className="text-sm text-[hsl(var(--primary-foreground)/.7)]">Voice minutes</span><span className="font-mono text-sm">{usage.data.voice_minutes} / {usage.data.included_minutes}</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-[hsl(var(--primary-foreground)/.16)]"><div className="h-full rounded-full bg-[hsl(var(--secondary))]" style={{ width: `${Math.min(100, (usage.data.voice_minutes / Math.max(1, usage.data.included_minutes)) * 100)}%` }} /></div></div><div className="mt-7 grid grid-cols-2 gap-y-5 border-t border-[hsl(var(--primary-foreground)/.16)] pt-5"><div><p className="text-[11px] text-[hsl(var(--primary-foreground)/.55)]">SMS count</p><p className="mt-1 font-mono text-lg">{usage.data.sms_count}</p></div><div><p className="text-[11px] text-[hsl(var(--primary-foreground)/.55)]">Bookings</p><p className="mt-1 font-mono text-lg">{usage.data.booking_count}</p></div><div><p className="text-[11px] text-[hsl(var(--primary-foreground)/.55)]">Est. provider cost</p><p className="mt-1 font-mono text-lg">${usage.data.estimated_cost.toFixed(2)}</p></div></div></section></div></div>;
}

function DemoAuthNotice() {
  return <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4"><div className="w-full max-w-[420px] rounded-2xl border border-border bg-[hsl(var(--card))] p-8 text-center"><ShieldCheck className="mx-auto text-[hsl(var(--accent))]" size={24} /><h1 className="mt-4 text-xl font-bold">Sign-in is disabled</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">This build runs in demo auth mode, so there is no Clerk instance to sign in to. The workspace opens directly against the seeded demo business.</p><div className="mt-6 flex justify-center"><Link href="/workspace" className="inline-flex items-center justify-center rounded-lg bg-[hsl(var(--primary))] px-4 py-3 text-sm font-bold text-[hsl(var(--primary-foreground))]" data-testid="link-open-workspace">Open workspace</Link></div></div></div>;
}

function ClerkSignInPage() {
  return <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4"><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /></div>;
}

function ClerkSignUpPage() {
  return <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4"><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /></div>;
}

const SignInPage = DEMO_AUTH ? DemoAuthNotice : ClerkSignInPage;
const SignUpPage = DEMO_AUTH ? DemoAuthNotice : ClerkSignUpPage;

function ClerkHomeRoute() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <div className="min-h-[100dvh] bg-background p-8"><Skeleton className="mx-auto h-8 max-w-[1200px]" /></div>;
  return isSignedIn ? <Redirect to="/workspace" /> : <LandingPage />;
}

function DemoHomeRoute() {
  return <Redirect to="/workspace" />;
}

const HomeRoute = DEMO_AUTH ? DemoHomeRoute : ClerkHomeRoute;

function WorkspaceRoute() {
  return <ErrorBoundary><AuthGate><Switch><Route path="/workspace" component={TodayPage} /><Route path="/workspace/leads" component={LeadsPage} /><Route path="/workspace/calls" component={CallsPage} /><Route path="/workspace/appointments" component={AppointmentsPage} /><Route path="/workspace/business-settings" component={SettingsPage} /><Route path="/workspace/reports" component={ReportsPage} /><Route component={NotFound} /></Switch></AuthGate></ErrorBoundary>;
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const previousUserId = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (previousUserId.current !== undefined && previousUserId.current !== userId) queryClient.clear();
      previousUserId.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClient]);

  return null;
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "#183746",
    colorForeground: "#1f2d32",
    colorMutedForeground: "#667477",
    colorDanger: "#a84b2b",
    colorBackground: "#fbfaf5",
    colorInput: "#ffffff",
    colorInputForeground: "#1f2d32",
    colorNeutral: "#d9d8d0",
    fontFamily: "DM Sans, sans-serif",
    borderRadius: "0.75rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-[#fbfaf5] rounded-2xl w-[440px] max-w-full overflow-hidden",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-[#1f2d32]",
    headerSubtitle: "text-[#667477]",
    socialButtonsBlockButtonText: "text-[#1f2d32]",
    formFieldLabel: "text-[#1f2d32]",
    footerActionLink: "text-[#9c7125]",
    footerActionText: "text-[#667477]",
    dividerText: "text-[#667477]",
    identityPreviewEditButton: "text-[#9c7125]",
    formFieldSuccessText: "text-[#24634f]",
    alertText: "text-[#a84b2b]",
    logoBox: "mb-4",
    logoImage: "h-10 w-10 rounded-xl",
    socialButtonsBlockButton: "border-[#d9d8d0] bg-white hover:bg-[#f2f0e8]",
    formButtonPrimary: "bg-[#183746] hover:bg-[#244b5c]",
    formFieldInput: "border-[#d9d8d0] bg-white text-[#1f2d32]",
    footerAction: "bg-transparent",
    dividerLine: "bg-[#d9d8d0]",
    alert: "border-[#e7c6b8] bg-[#fff7f2]",
    otpCodeFieldInput: "border-[#d9d8d0] bg-white text-[#1f2d32]",
    formFieldRow: "text-[#1f2d32]",
    main: "bg-transparent",
  },
};

function Router() {
  return <Switch><Route path="/sign-in/*?" component={SignInPage} /><Route path="/sign-up/*?" component={SignUpPage} /><Route path="/" component={HomeRoute} /><Route component={WorkspaceRoute} /></Switch>;
}

function ClerkApp() {
  const [, setLocation] = useLocation();
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={clerkAppearance} signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} localization={{ signIn: { start: { title: "Welcome back", subtitle: "Sign in to access your workspace" } }, signUp: { start: { title: "Create your workspace", subtitle: "Start your LeadSprint operation" } } }} routerPush={(to) => setLocation(stripBase(to))} routerReplace={(to) => setLocation(stripBase(to), { replace: true })}><QueryClientProvider client={queryClient}><ClerkQueryClientCacheInvalidator /><Router /></QueryClientProvider></ClerkProvider>;
}

function DemoApp() {
  return <QueryClientProvider client={queryClient}><Router /></QueryClientProvider>;
}

function App() {
  return <WouterRouter base={basePath}>{DEMO_AUTH ? <DemoApp /> : <ClerkApp />}</WouterRouter>;
}

export default App;