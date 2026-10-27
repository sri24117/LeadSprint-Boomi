import { useEffect, useRef, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, SignIn, SignUp, useAuth, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import {
  AlertTriangle,
  BarChart3,
  Bell,
  Bot,
  CalendarDays,
  CheckCircle2,
  Clock,
  Compass,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  PhoneCall,
  Plus,
  Radio,
  Settings,
  Settings2,
  ShieldCheck,
  Sparkles,
  UsersRound,
  Wallet,
  X,
} from 'lucide-react';
import {
  getGetAuthMeQueryKey,
  useGetAuthMe,
  useHealthCheck,
} from '@workspace/api-client-react';
import { Link, Redirect, Route, Router as WouterRouter, Switch, useLocation } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { Button, Skeleton, initials } from '@/components/common';
import { resolveAuthMode } from '@/lib/authMode';
import NotFound from '@/pages/not-found';
import TodayPage from '@/pages/today';
import LeadsPage from '@/pages/leads';
import CallsPage from '@/pages/calls';
import AppointmentsPage from '@/pages/appointments';
import ReportsPage from '@/pages/reports';
import SettingsPage from '@/pages/settings';
import AgentsPage from '@/pages/agents';
import AgentBuilderPage from '@/pages/agent-builder';
import LiveCallsPage from '@/pages/live-calls';
import ContactsPage from '@/pages/contacts';
import CrmPage from '@/pages/crm';
import TeamsPage from '@/pages/teams';
import AnalyticsPage from '@/pages/analytics';
import BillingPage from '@/pages/billing';

const queryClient = new QueryClient();

interface NavItem {
  href: string;
  label: string;
  icon: any;
  badge?: string;
  subItems?: Array<{ href: string; label: string; icon: any }>;
}

const navItems: NavItem[] = [
  { href: '/workspace', label: 'Dashboard', icon: LayoutDashboard },
  {
    href: '/workspace/agents',
    label: 'AI Agents',
    icon: Bot,
    subItems: [{ href: '/workspace/agent-builder', label: 'Agent Builder', icon: Plus }],
  },
  { href: '/workspace/live-calls', label: 'Live Calls', icon: Radio, badge: 'Live' },
  { href: '/workspace/calls', label: 'Call History', icon: History },
  { href: '/workspace/contacts', label: 'Contacts', icon: UsersRound },
  { href: '/workspace/crm', label: 'CRM', icon: Compass },
  { href: '/workspace/teams', label: 'Teams', icon: UsersRound },
  { href: '/workspace/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/workspace/business-settings', label: 'Settings', icon: Settings },
  { href: '/workspace/billing', label: 'Billing', icon: Wallet },
];

const pageMeta: Record<string, { eyebrow: string; title: string; description: string }> = {
  '/workspace': { eyebrow: 'Console', title: 'Dashboard', description: 'Monitor conversational workforce, call throughput, and appointments.' },
  '/workspace/agents': { eyebrow: 'Console', title: 'AI Agents', description: 'Configure, duplicate, pause, or deploy conversational agents across standard business profiles.' },
  '/workspace/agent-builder': { eyebrow: 'Console / AI Agents', title: 'Agent Builder', description: 'Design conversational prompts, voices, LLM parameters, and tool integrations.' },
  '/workspace/live-calls': { eyebrow: 'Console', title: 'Live Calls', description: 'Supervise in-flight AI voice interactions and transfer to operators when required.' },
  '/workspace/calls': { eyebrow: 'Console', title: 'Call History', description: 'Audio recordings, full transcripts, turn-by-turn dialogue, and AI summaries.' },
  '/workspace/contacts': { eyebrow: 'Console', title: 'Contacts', description: 'Verified contact records, recipient timezones, and TCPA consent compliance.' },
  '/workspace/crm': { eyebrow: 'Console', title: 'CRM', description: 'Track leads from incoming enquiry to qualification and booked appointments.' },
  '/workspace/teams': { eyebrow: 'Console', title: 'Teams', description: 'Manage human operators, AI voice agent roles, and phone routing rules.' },
  '/workspace/analytics': { eyebrow: 'Console', title: 'Analytics', description: 'Deep conversion funnels, speech latency, call sentiment, and quota usage.' },
  '/workspace/business-settings': { eyebrow: 'Console', title: 'Settings', description: 'Quiet hours, regulatory compliance gates, webhook secrets, and phone numbers.' },
  '/workspace/billing': { eyebrow: 'Console', title: 'Billing', description: 'Voice minutes consumption, telephony carrier charges, and pilot tier.' },
  '/workspace/leads': { eyebrow: 'Console', title: 'Leads', description: 'Find the next best conversation.' },
  '/workspace/appointments': { eyebrow: 'Console', title: 'Appointments', description: 'Verified meetings, ready for the team.' },
  '/workspace/reports': { eyebrow: 'Console', title: 'Reports', description: 'A grounded view of your weekly operation.' },
};

// Local development shortcut
const rawClerkKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY?.trim();
const clerkPubKey = rawClerkKey
  ? publishableKeyFromHost(window.location.hostname, rawClerkKey)
  : '';

const AUTH_MODE = resolveAuthMode({
  demoFlag: import.meta.env.VITE_LEADSPRINT_DEMO_AUTH,
  clerkKey: clerkPubKey,
  isProd: import.meta.env.PROD,
});
const DEMO_AUTH = AUTH_MODE === 'demo';
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || '/'
    : path;
}

function useClerkSignOutAction() {
  const { signOut } = useClerk();
  return (redirectUrl: string) => signOut({ redirectUrl });
}

function useDemoSignOutAction() {
  return async (_redirectUrl: string) => {};
}

const useSignOutAction = DEMO_AUTH ? useDemoSignOutAction : useClerkSignOutAction;

function DemoAuthBanner() {
  if (!DEMO_AUTH) return null;
  return (
    <div
      className="flex items-center justify-center gap-2 bg-violet-50/90 border-b border-violet-100 px-4 py-1.5 text-center text-[11px] font-semibold tracking-wide text-violet-700"
      data-testid="banner-demo-auth"
    >
      <ShieldCheck size={13} /> BoomiSolutions Demo Workspace — Local environment active
    </div>
  );
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

  // Live ticking clock in header (matching screenshot e.g. 10:10:10 AM)
  const [currentTime, setCurrentTime] = useState('');
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(now.toLocaleTimeString('en-US', { hour12: true }));
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="min-h-[100dvh] bg-slate-50/50 text-slate-800">
      <aside
        className={`fixed inset-y-0 left-0 z-30 flex w-[235px] flex-col border-r border-slate-200/90 bg-white px-3 py-5 text-slate-700 transition-transform duration-300 md:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand Logo - BoomiSolutions */}
        <div className="flex items-center justify-between px-2">
          <Link href="/workspace" className="flex items-center gap-2.5" data-testid="link-brand">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-tr from-violet-600 to-indigo-500 text-white shadow-xs">
              <div className="flex items-end gap-0.5 h-3.5">
                <span className="w-0.5 bg-white rounded-full h-1.5"></span>
                <span className="w-0.5 bg-white rounded-full h-3.5"></span>
                <span className="w-0.5 bg-white rounded-full h-2.5"></span>
              </div>
            </div>
            <div>
              <span className="block text-sm font-bold tracking-tight text-slate-900">BoomiSolutions</span>
            </div>
          </Link>
          <button
            className="text-slate-400 hover:text-slate-600 md:hidden"
            onClick={() => setMobileOpen(false)}
            data-testid="button-close-menu"
          >
            <X size={18} />
          </button>
        </div>

        {/* Sidebar Nav Items */}
        <nav className="mt-7 space-y-1 overflow-y-auto px-1" aria-label="Main navigation">
          {navItems.map((item) => {
            const active = item.href === location || (item.subItems && item.subItems.some((s) => s.href === location));
            const Icon = item.icon;
            return (
              <div key={item.href} className="space-y-0.5">
                <Link
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  data-testid={`link-nav-${item.label.toLowerCase().replaceAll(' ', '-')}`}
                  className={`group flex items-center gap-3 rounded-xl px-3 py-2 text-xs font-semibold transition-all ${
                    active
                      ? 'bg-violet-50 text-violet-700 shadow-2xs font-bold'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  <Icon size={16} strokeWidth={active ? 2.3 : 1.8} className={active ? 'text-violet-600' : 'text-slate-400 group-hover:text-slate-600'} />
                  <span>{item.label}</span>
                  {item.badge && (
                    <span className="ml-auto rounded-full bg-red-50 border border-red-200 px-1.5 py-0.2 font-mono text-[9px] font-bold text-red-600 flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
                      {item.badge}
                    </span>
                  )}
                </Link>

                {/* Subitems if any (e.g. Agent Builder under AI Agents) */}
                {item.subItems && (
                  <div className="ml-7 pl-2 space-y-0.5 border-l border-slate-100">
                    {item.subItems.map((sub) => {
                      const subActive = sub.href === location;
                      const SubIcon = sub.icon;
                      return (
                        <Link
                          key={sub.href}
                          href={sub.href}
                          onClick={() => setMobileOpen(false)}
                          className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition ${
                            subActive
                              ? 'text-violet-700 font-bold bg-violet-50/60'
                              : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
                          }`}
                        >
                          <SubIcon size={11} className={subActive ? 'text-violet-600' : 'text-slate-400'} />
                          <span>{sub.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* User Card at bottom of sidebar */}
        <div className="mt-auto border-t border-slate-100 px-2 pt-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-100 font-mono text-xs font-bold text-violet-700">
              {initials(user?.name || 'Sruthi')}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-slate-800">{user?.name || 'sruthi'}</p>
              <p className="truncate text-[10px] text-slate-400 font-mono">Operator</p>
            </div>
            <button
              className="text-slate-400 hover:text-slate-700 transition"
              onClick={handleSignOut}
              data-testid="button-logout"
              title="Sign out"
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </aside>

      {mobileOpen && (
        <button
          className="fixed inset-0 z-20 bg-slate-900/20 backdrop-blur-xs md:hidden"
          onClick={() => setMobileOpen(false)}
          data-testid="button-close-overlay"
          aria-label="Close menu"
        />
      )}

      <main className="min-h-[100dvh] md:pl-[235px]">
        <DemoAuthBanner />

        {/* Top Header Bar matching BoomiSolutions */}
        <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/90 backdrop-blur-md">
          <div className="flex h-14 items-center justify-between px-5 sm:px-8">
            <div className="flex items-center gap-3">
              <button
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 md:hidden"
                onClick={() => setMobileOpen(true)}
                data-testid="button-open-menu"
              >
                <Menu size={18} />
              </button>
              <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
                <span>{meta.eyebrow}</span>
                <span>/</span>
                <span className="font-semibold text-slate-800">{meta.title}</span>
              </div>
            </div>

            {/* Right side: Operational pill, Notification Bell, Live Clock */}
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="hidden sm:flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 border border-emerald-200/80">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span>All Systems Operational</span>
              </div>

              <button
                className="relative rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                data-testid="button-notifications"
                title="Notifications"
              >
                <Bell size={16} />
                <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-violet-600" />
              </button>

              <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 font-mono text-xs font-semibold text-slate-600">
                {currentTime || '10:10:10 AM'}
              </div>
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-[1500px] px-5 py-6 sm:px-8">{children}</div>
      </main>
    </div>
  );
}

function ClerkAuthGate({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  const auth = useGetAuthMe({
    query: { queryKey: getGetAuthMeQueryKey(), enabled: isLoaded && Boolean(isSignedIn) },
  });
  if (!isLoaded || (isSignedIn && auth.isLoading)) return <AuthSkeleton />;
  if (!isSignedIn) return <LandingPage />;
  if (auth.isError || !auth.data) return <AuthError error={auth.error} />;
  return <Shell session={auth.data}>{children}</Shell>;
}

function DemoAuthGate({ children }: { children: ReactNode }) {
  const auth = useGetAuthMe({ query: { queryKey: getGetAuthMeQueryKey() } });
  if (auth.isLoading) return <AuthSkeleton />;
  if (auth.isError || !auth.data) return <AuthError error={auth.error} />;
  return <Shell session={auth.data}>{children}</Shell>;
}

const AuthGate = DEMO_AUTH ? DemoAuthGate : ClerkAuthGate;

function AuthSkeleton() {
  return (
    <div className="min-h-[100dvh] bg-background p-8">
      <div className="mx-auto max-w-[1200px]">
        <Skeleton className="h-8 w-36" />
        <div className="mt-14 grid gap-5 sm:grid-cols-3">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      </div>
    </div>
  );
}

function LandingPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[hsl(var(--background))] px-5 py-12">
      <div className="grid w-full max-w-[1050px] gap-10 rounded-3xl border border-border bg-[hsl(var(--card))] p-7 shadow-[0_24px_90px_hsl(209_43%_22%/.1)] md:grid-cols-[1.15fr_.85fr] md:p-12">
        <div className="flex flex-col justify-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[hsl(var(--primary))] font-mono text-sm font-bold text-[hsl(var(--primary-foreground))]">
            LS
          </div>
          <p className="mt-10 text-[10px] font-bold uppercase tracking-[.22em] text-[hsl(var(--accent))]">
            Lead response engine
          </p>
          <h1 className="mt-3 max-w-xl text-4xl font-bold tracking-[-.06em] sm:text-5xl">
            Turn every enquiry into a human-ready handoff.
          </h1>
          <p className="mt-5 max-w-lg text-base leading-7 text-muted-foreground">
            A policy-first operator console for real-estate teams running US and India market profiles.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/sign-in"
              className="inline-flex items-center justify-center rounded-lg bg-[hsl(var(--primary))] px-4 py-3 text-sm font-bold text-[hsl(var(--primary-foreground))] transition hover:brightness-110"
              data-testid="link-sign-in"
            >
              Sign in to workspace
            </Link>
            <Link
              href="/sign-up"
              className="inline-flex items-center justify-center rounded-lg border border-border px-4 py-3 text-sm font-bold text-foreground transition hover:bg-[hsl(var(--muted))]"
              data-testid="link-sign-up"
            >
              Create workspace
            </Link>
          </div>
        </div>
        <div className="rounded-2xl bg-[hsl(var(--primary))] p-6 text-[hsl(var(--primary-foreground))] md:p-8">
          <p className="text-[10px] font-bold uppercase tracking-[.2em] text-[hsl(var(--secondary))]">
            Built for the moment after the form fill
          </p>
          <div className="mt-8 space-y-5">
            {['Qualify with approved language', 'Escalate when a human is needed', 'Book only verified appointments'].map(
              (item, index) => (
                <div
                  key={item}
                  className="flex items-start gap-3 border-t border-[hsl(var(--primary-foreground)/.15)] pt-5"
                >
                  <span className="font-mono text-xs text-[hsl(var(--secondary))]">0{index + 1}</span>
                  <p className="text-sm font-semibold leading-6">{item}</p>
                </div>
              ),
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function AuthError({ error }: { error?: unknown }) {
  const signOutAction = useSignOutAction();
  const rawErr = (error as any)?.data?.detail || (error as any)?.data?.error || (error as any)?.message;
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-5">
      <div className="w-full max-w-[420px] rounded-2xl border border-border bg-[hsl(var(--card))] p-8 text-center">
        <AlertTriangle className="mx-auto text-[hsl(var(--destructive))]" size={24} />
        <h1 className="mt-4 text-xl font-bold">Workspace setup is incomplete</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Your sign-in is valid, but the operator workspace could not be loaded. Try again or sign out.
        </p>
        {rawErr && (
          <div className="mt-4 rounded-lg bg-[hsl(var(--muted)/.8)] p-3 text-left font-mono text-[11px] text-[hsl(var(--muted-foreground))] break-words">
            {String(rawErr)}
          </div>
        )}
        <div className="mt-6 flex justify-center gap-2">
          <Button onClick={() => window.location.reload()} variant="primary">
            Try again
          </Button>
          <Button onClick={() => signOutAction(basePath || '/')}>Sign out</Button>
        </div>
      </div>
    </div>
  );
}

function AuthNotConfigured() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-5">
      <div
        className="w-full max-w-[460px] rounded-2xl border border-border bg-[hsl(var(--card))] p-8 text-center"
        data-testid="auth-not-configured"
      >
        <AlertTriangle className="mx-auto text-[hsl(var(--destructive))]" size={24} />
        <h1 className="mt-4 text-xl font-bold">Sign-in is not configured</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          This deployment was built without a Clerk publishable key, so nobody can sign in yet. The site
          operator needs to set <code className="font-mono">VITE_CLERK_PUBLISHABLE_KEY</code> as a{' '}
          <strong>build-time</strong> variable, set the server's <code className="font-mono">CLERK_SECRET_KEY</code> and{' '}
          <code className="font-mono">CLERK_PUBLISHABLE_KEY</code>, and redeploy.
        </p>
      </div>
    </div>
  );
}

function DemoAuthNotice() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <div className="w-full max-w-[420px] rounded-2xl border border-border bg-[hsl(var(--card))] p-8 text-center">
        <ShieldCheck className="mx-auto text-[hsl(var(--accent))]" size={24} />
        <h1 className="mt-4 text-xl font-bold">Sign-in is disabled</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          This build runs in demo auth mode, so there is no Clerk instance to sign in to. The workspace opens directly
          against the seeded demo business.
        </p>
        <div className="mt-6 flex justify-center">
          <Link
            href="/workspace"
            className="inline-flex items-center justify-center rounded-lg bg-[hsl(var(--primary))] px-4 py-3 text-sm font-bold text-[hsl(var(--primary-foreground))]"
            data-testid="link-open-workspace"
          >
            Open workspace
          </Link>
        </div>
      </div>
    </div>
  );
}

function ClerkSignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </div>
  );
}

function ClerkSignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </div>
  );
}

const SignInPage = DEMO_AUTH ? DemoAuthNotice : ClerkSignInPage;
const SignUpPage = DEMO_AUTH ? DemoAuthNotice : ClerkSignUpPage;

function ClerkHomeRoute() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) {
    return (
      <div className="min-h-[100dvh] bg-background p-8">
        <Skeleton className="mx-auto h-8 max-w-[1200px]" />
      </div>
    );
  }
  return isSignedIn ? <Redirect to="/workspace" /> : <LandingPage />;
}

function DemoHomeRoute() {
  return <Redirect to="/workspace" />;
}

const HomeRoute = DEMO_AUTH ? DemoHomeRoute : ClerkHomeRoute;

function WorkspaceRoute() {
  return (
    <ErrorBoundary>
      <AuthGate>
        <Switch>
          <Route path="/workspace" component={TodayPage} />
          <Route path="/workspace/agents" component={AgentsPage} />
          <Route path="/workspace/agent-builder" component={AgentBuilderPage} />
          <Route path="/workspace/live-calls" component={LiveCallsPage} />
          <Route path="/workspace/calls" component={CallsPage} />
          <Route path="/workspace/contacts" component={ContactsPage} />
          <Route path="/workspace/crm" component={CrmPage} />
          <Route path="/workspace/teams" component={TeamsPage} />
          <Route path="/workspace/analytics" component={AnalyticsPage} />
          <Route path="/workspace/billing" component={BillingPage} />
          <Route path="/workspace/leads" component={LeadsPage} />
          <Route path="/workspace/appointments" component={AppointmentsPage} />
          <Route path="/workspace/business-settings" component={SettingsPage} />
          <Route path="/workspace/reports" component={ReportsPage} />
          <Route component={NotFound} />
        </Switch>
      </AuthGate>
    </ErrorBoundary>
  );
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
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: '#183746',
    colorForeground: '#1f2d32',
    colorMutedForeground: '#667477',
    colorDanger: '#a84b2b',
    colorBackground: '#fbfaf5',
    colorInput: '#ffffff',
    colorInputForeground: '#1f2d32',
    colorNeutral: '#d9d8d0',
    fontFamily: 'DM Sans, sans-serif',
    borderRadius: '0.75rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[#fbfaf5] rounded-2xl w-[440px] max-w-full overflow-hidden',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#1f2d32]',
    headerSubtitle: 'text-[#667477]',
    socialButtonsBlockButtonText: 'text-[#1f2d32]',
    formFieldLabel: 'text-[#1f2d32]',
    footerActionLink: 'text-[#9c7125]',
    footerActionText: 'text-[#667477]',
    dividerText: 'text-[#667477]',
    identityPreviewEditButton: 'text-[#9c7125]',
    formFieldSuccessText: 'text-[#24634f]',
    alertText: 'text-[#a84b2b]',
    logoBox: 'mb-4',
    logoImage: 'h-10 w-10 rounded-xl',
    socialButtonsBlockButton: 'border-[#d9d8d0] bg-white hover:bg-[#f2f0e8]',
    formButtonPrimary: 'bg-[#183746] hover:bg-[#244b5c]',
    formFieldInput: 'border-[#d9d8d0] bg-white text-[#1f2d32]',
    footerAction: 'bg-transparent',
    dividerLine: 'bg-[#d9d8d0]',
    alert: 'border-[#e7c6b8] bg-[#fff7f2]',
    otpCodeFieldInput: 'border-[#d9d8d0] bg-white text-[#1f2d32]',
    formFieldRow: 'text-[#1f2d32]',
    main: 'bg-transparent',
  },
};

function Router() {
  return (
    <Switch>
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/sign-up/*?" component={SignUpPage} />
      <Route path="/" component={HomeRoute} />
      <Route component={WorkspaceRoute} />
    </Switch>
  );
}

function ClerkApp() {
  const [, setLocation] = useLocation();
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: { start: { title: 'Welcome back', subtitle: 'Sign in to access your workspace' } },
        signUp: { start: { title: 'Create your workspace', subtitle: 'Start your LeadSprint operation' } },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <Router />
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function DemoApp() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router />
    </QueryClientProvider>
  );
}

function App() {
  if (AUTH_MODE === 'unconfigured') return <AuthNotConfigured />;
  return <WouterRouter base={basePath}>{DEMO_AUTH ? <DemoApp /> : <ClerkApp />}</WouterRouter>;
}

export default App;