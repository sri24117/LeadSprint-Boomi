import { useEffect, useRef, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, SignIn, SignUp, useAuth, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import {
  AlertTriangle,
  BarChart3,
  Bell,
  CalendarDays,
  LayoutDashboard,
  LogOut,
  Menu,
  PhoneCall,
  Settings2,
  ShieldCheck,
  UsersRound,
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
import NotFound from '@/pages/not-found';
import TodayPage from '@/pages/today';
import LeadsPage from '@/pages/leads';
import CallsPage from '@/pages/calls';
import AppointmentsPage from '@/pages/appointments';
import ReportsPage from '@/pages/reports';
import SettingsPage from '@/pages/settings';

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
const rawClerkKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY?.trim();
const clerkPubKey = rawClerkKey
  ? publishableKeyFromHost(window.location.hostname, rawClerkKey)
  : '';

// Local development / single-box pilot shortcut: when the build is made with
// VITE_LEADSPRINT_DEMO_AUTH=true or when CLERK_PUBLISHABLE_KEY is not configured,
// the console loads directly in demo mode instead of hanging on an empty Clerk skeleton.
const DEMO_AUTH =
  import.meta.env.VITE_LEADSPRINT_DEMO_AUTH === 'true' || !clerkPubKey;
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
      className="flex items-center justify-center gap-2 bg-[hsl(var(--destructive)/.12)] px-4 py-2 text-center text-[11px] font-semibold uppercase tracking-[.14em] text-[hsl(var(--destructive))]"
      data-testid="banner-demo-auth"
    >
      <ShieldCheck size={14} /> Demo auth — sign-in disabled, seeded workspace, local use only
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

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <aside
        className={`fixed inset-y-0 left-0 z-30 flex w-[248px] flex-col bg-[hsl(var(--sidebar))] px-4 py-5 text-[hsl(var(--sidebar-foreground))] transition-transform duration-300 md:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-3">
          <Link href="/workspace" className="flex items-center gap-3" data-testid="link-brand">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[hsl(var(--sidebar-primary))] font-mono text-sm font-bold text-[hsl(var(--sidebar-primary-foreground))]">
              LS
            </span>
            <span>
              <span className="block text-[15px] font-bold tracking-[-.02em]">LeadSprint</span>
              <span className="block text-[10px] uppercase tracking-[.2em] text-[hsl(var(--sidebar-foreground)/.52)]">
                Operator console
              </span>
            </span>
          </Link>
          <button
            className="text-[hsl(var(--sidebar-foreground)/.65)] md:hidden"
            onClick={() => setMobileOpen(false)}
            data-testid="button-close-menu"
          >
            <X size={18} />
          </button>
        </div>
        <div className="mt-9 px-3 text-[10px] font-bold uppercase tracking-[.2em] text-[hsl(var(--sidebar-foreground)/.42)]">
          Workspace
        </div>
        <nav className="mt-3 space-y-1" aria-label="Main navigation">
          {navItems.map((item) => {
            const active = item.href === location;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                data-testid={`link-nav-${item.label.toLowerCase().replaceAll(' ', '-')}`}
                className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-[hsl(var(--sidebar-primary)/.16)] text-[hsl(var(--sidebar-primary))]'
                    : 'text-[hsl(var(--sidebar-foreground)/.68)] hover:bg-[hsl(var(--sidebar-accent))] hover:text-[hsl(var(--sidebar-foreground))]'
                }`}
              >
                <Icon size={17} strokeWidth={active ? 2.4 : 1.8} />
                <span>{item.label}</span>
                {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[hsl(var(--sidebar-primary))]" />}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto">
          <div className="mb-4 rounded-xl border border-[hsl(var(--sidebar-border))] bg-[hsl(var(--sidebar-accent)/.6)] p-3">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <span
                className={`h-2 w-2 rounded-full ${
                  health.isError ? 'bg-[hsl(var(--destructive))]' : 'animate-pulse-dot bg-[hsl(var(--sidebar-primary))]'
                }`}
              />
              {health.isError ? 'Service needs attention' : 'Systems operational'}
            </div>
            <p className="mt-2 text-[11px] leading-5 text-[hsl(var(--sidebar-foreground)/.5)]">
              Policy checks stay visible before any call is placed.
            </p>
          </div>
          <div className="flex items-center gap-3 border-t border-[hsl(var(--sidebar-border))] px-2 pt-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[hsl(var(--sidebar-primary)/.18)] font-mono text-[11px] text-[hsl(var(--sidebar-primary))]">
              {initials(user?.name)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold">{user?.name || 'Operator'}</p>
              <p className="truncate text-[11px] text-[hsl(var(--sidebar-foreground)/.5)]">{business?.name || 'Workspace'}</p>
            </div>
            <button
              className="text-[hsl(var(--sidebar-foreground)/.55)] hover:text-[hsl(var(--sidebar-primary))]"
              onClick={handleSignOut}
              data-testid="button-logout"
              title="Sign out"
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>
      {mobileOpen && (
        <button
          className="fixed inset-0 z-20 bg-[#102632]/40 md:hidden"
          onClick={() => setMobileOpen(false)}
          data-testid="button-close-overlay"
          aria-label="Close menu"
        />
      )}
      <main className="min-h-[100dvh] md:pl-[248px]">
        <DemoAuthBanner />
        <header className="sticky top-0 z-10 border-b border-border bg-[hsl(var(--background)/.9)] backdrop-blur-xl">
          <div className="flex h-[76px] items-center justify-between px-5 sm:px-8 lg:px-10">
            <div className="flex items-center gap-3">
              <button
                className="rounded-lg p-2 text-muted-foreground hover:bg-[hsl(var(--muted))] md:hidden"
                onClick={() => setMobileOpen(true)}
                data-testid="button-open-menu"
              >
                <Menu size={20} />
              </button>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[.19em] text-[hsl(var(--accent))]">{meta.eyebrow}</p>
                <h1 className="mt-0.5 text-xl font-bold tracking-[-.03em]">{meta.title}</h1>
              </div>
            </div>
            <div className="flex items-center gap-2 sm:gap-4">
              <span className="hidden text-xs text-muted-foreground sm:block">
                {business?.market === 'IN' ? 'India' : 'United States'} · {business?.timezone || 'Timezone not set'}
              </span>
              <button
                className="relative rounded-lg p-2 text-muted-foreground transition-colors hover:bg-[hsl(var(--muted))] hover:text-foreground"
                data-testid="button-notifications"
                title="Notifications"
              >
                <Bell size={18} />
                <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[hsl(var(--secondary))]" />
              </button>
            </div>
          </div>
        </header>
        <div className="mx-auto max-w-[1500px] px-5 py-7 sm:px-8 lg:px-10">{children}</div>
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
          <Route path="/workspace/leads" component={LeadsPage} />
          <Route path="/workspace/calls" component={CallsPage} />
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
  return <WouterRouter base={basePath}>{DEMO_AUTH ? <DemoApp /> : <ClerkApp />}</WouterRouter>;
}

export default App;