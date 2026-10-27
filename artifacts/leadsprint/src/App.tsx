import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import { ClerkProvider, SignIn, SignUp, useAuth, useClerk } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { shadcn } from "@clerk/themes";
import {
  AlertTriangle,
  BarChart3,
  Bot,
  CalendarDays,
  Compass,
  LayoutDashboard,
  LogOut,
  Menu,
  PhoneCall,
  Radio,
  Settings,
  ShieldCheck,
  UsersRound,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  getGetAuthMeQueryKey,
  useGetAuthMe,
} from "@workspace/api-client-react";
import {
  Link,
  Redirect,
  Route,
  Router as WouterRouter,
  Switch,
  useLocation,
} from "wouter";
import { ErrorBoundary } from "@/components/error-boundary";
import { Button, Skeleton, initials } from "@/components/common";
import { resolveAuthMode } from "@/lib/authMode";
import NotFound from "@/pages/not-found";
import TodayPage from "@/pages/today";
import LeadsPage from "@/pages/leads";
import CallsPage from "@/pages/calls";
import AppointmentsPage from "@/pages/appointments";
import ReportsPage from "@/pages/reports";
import SettingsPage from "@/pages/settings";
import AgentsPage from "@/pages/agents";
import AgentBuilderPage from "@/pages/agent-builder";
import LiveCallsPage from "@/pages/live-calls";
import ContactsPage from "@/pages/contacts";
import CrmPage from "@/pages/crm";
import TeamsPage from "@/pages/teams";
import AnalyticsPage from "@/pages/analytics";
import BillingPage from "@/pages/billing";

const queryClient = new QueryClient();

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    label: "Work",
    items: [
      { href: "/workspace", label: "Dashboard", icon: LayoutDashboard },
      { href: "/workspace/leads", label: "Leads", icon: UsersRound },
      { href: "/workspace/calls", label: "Calls", icon: PhoneCall },
      {
        href: "/workspace/appointments",
        label: "Appointments",
        icon: CalendarDays,
      },
    ],
  },
  {
    label: "AI Workforce",
    items: [
      { href: "/workspace/agents", label: "AI Agents", icon: Bot },
      { href: "/workspace/agent-builder", label: "Agent Builder", icon: Bot },
      { href: "/workspace/live-calls", label: "Live Calls", icon: Radio },
    ],
  },
  {
    label: "Manage",
    items: [
      { href: "/workspace/contacts", label: "Contacts", icon: UsersRound },
      { href: "/workspace/teams", label: "Teams", icon: UsersRound },
    ],
  },
  {
    label: "Insights",
    items: [
      { href: "/workspace/analytics", label: "Analytics", icon: BarChart3 },
      { href: "/workspace/reports", label: "Reports", icon: BarChart3 },
    ],
  },
];

const utilityItems: NavItem[] = [
  { href: "/workspace/business-settings", label: "Settings", icon: Settings },
  { href: "/workspace/billing", label: "Billing", icon: Wallet },
];

const pageMeta: Record<
  string,
  { eyebrow: string; title: string; description: string }
> = {
  "/workspace": {
    eyebrow: "Console",
    title: "Dashboard",
    description:
      "Monitor conversational workforce, call throughput, and appointments.",
  },
  "/workspace/agents": {
    eyebrow: "Console",
    title: "AI Agents",
    description:
      "Configure, duplicate, pause, or deploy conversational agents across standard business profiles.",
  },
  "/workspace/agent-builder": {
    eyebrow: "Console / AI Agents",
    title: "Agent Builder",
    description:
      "Design conversational prompts, voices, LLM parameters, and tool integrations.",
  },
  "/workspace/live-calls": {
    eyebrow: "Console",
    title: "Live Calls",
    description:
      "Supervise in-flight AI voice interactions and transfer to operators when required.",
  },
  "/workspace/calls": {
    eyebrow: "Console",
    title: "Call History",
    description:
      "Audio recordings, full transcripts, turn-by-turn dialogue, and AI summaries.",
  },
  "/workspace/contacts": {
    eyebrow: "Console",
    title: "Contacts",
    description:
      "Verified contact records, recipient timezones, and TCPA consent compliance.",
  },
  "/workspace/crm": {
    eyebrow: "Console",
    title: "CRM",
    description:
      "Track leads from incoming enquiry to qualification and booked appointments.",
  },
  "/workspace/teams": {
    eyebrow: "Console",
    title: "Teams",
    description:
      "Manage human operators, AI voice agent roles, and phone routing rules.",
  },
  "/workspace/analytics": {
    eyebrow: "Console",
    title: "Analytics",
    description:
      "Deep conversion funnels, speech latency, call sentiment, and quota usage.",
  },
  "/workspace/business-settings": {
    eyebrow: "Console",
    title: "Settings",
    description:
      "Quiet hours, regulatory compliance gates, webhook secrets, and phone numbers.",
  },
  "/workspace/billing": {
    eyebrow: "Console",
    title: "Billing",
    description:
      "Voice minutes consumption, telephony carrier charges, and pilot tier.",
  },
  "/workspace/leads": {
    eyebrow: "Console",
    title: "Leads",
    description: "Find the next best conversation.",
  },
  "/workspace/appointments": {
    eyebrow: "Console",
    title: "Appointments",
    description: "Verified meetings, ready for the team.",
  },
  "/workspace/reports": {
    eyebrow: "Console",
    title: "Reports",
    description: "A grounded view of your weekly operation.",
  },
};

// Local development shortcut
const rawClerkKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY?.trim();
const clerkPubKey = rawClerkKey
  ? publishableKeyFromHost(window.location.hostname, rawClerkKey)
  : "";

const AUTH_MODE = resolveAuthMode({
  demoFlag: import.meta.env.VITE_LEADSPRINT_DEMO_AUTH,
  clerkKey: clerkPubKey,
  isProd: import.meta.env.PROD,
});
const DEMO_AUTH = AUTH_MODE === "demo";
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

function useClerkSignOutAction() {
  const { signOut } = useClerk();
  return (redirectUrl: string) => signOut({ redirectUrl });
}

function useDemoSignOutAction() {
  return async (_redirectUrl: string) => {};
}

const useSignOutAction = DEMO_AUTH
  ? useDemoSignOutAction
  : useClerkSignOutAction;

function DemoAuthBanner() {
  if (!DEMO_AUTH) return null;
  return (
    <div
      className="flex items-center justify-center gap-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--accent))/0.10] px-4 py-1.5 text-center text-[11px] font-semibold tracking-wide text-[hsl(var(--primary))]"
      data-testid="banner-demo-auth"
    >
      <ShieldCheck size={13} /> BoomiSolutions Demo Workspace — Local
      environment active
    </div>
  );
}

function Shell({ children, session }: { children: ReactNode; session: any }) {
  const [location, setLocation] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const signOutAction = useSignOutAction();
  const meta = pageMeta[location] ?? pageMeta["/workspace"];
  const user = session?.user;
  const handleSignOut = () =>
    signOutAction(basePath || "/").then(() => setLocation("/"));

  return (
    <div className="min-h-[100dvh] bg-[hsl(var(--background))] text-[hsl(var(--foreground))]">
      <aside
        className={`fixed inset-y-0 left-0 z-30 flex w-64 flex-col border-r border-[hsl(var(--sidebar-border))] bg-[hsl(var(--sidebar))] px-3 py-4 text-[hsl(var(--sidebar-foreground))] transition-transform duration-300 md:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-2">
          <Link
            href="/workspace"
            className="flex items-center gap-2.5"
            data-testid="link-brand"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]">
              <div className="flex items-end gap-0.5 h-3.5">
                <span className="w-0.5 bg-[hsl(var(--primary-foreground))] rounded-full h-1.5"></span>
                <span className="w-0.5 bg-[hsl(var(--primary-foreground))] rounded-full h-3.5"></span>
                <span className="w-0.5 bg-[hsl(var(--primary-foreground))] rounded-full h-2.5"></span>
              </div>
            </div>
            <span className="text-sm font-bold tracking-tight">
              BoomiSolutions
            </span>
          </Link>
          <button
            className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] md:hidden"
            onClick={() => setMobileOpen(false)}
            data-testid="button-close-menu"
          >
            <X size={18} />
          </button>
        </div>

        <nav
          className="mt-6 min-h-0 flex-1 space-y-2 overflow-y-auto px-1"
          aria-label="Main navigation"
        >
          {navGroups.map((group) => (
            <section
              key={group.label}
              aria-labelledby={`nav-group-${group.label.toLowerCase().replaceAll(" ", "-")}`}
            >
              <h2
                id={`nav-group-${group.label.toLowerCase().replaceAll(" ", "-")}`}
                className="px-3 text-[10px] font-semibold uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]"
              >
                {group.label}
              </h2>
              <div className="mt-1.5 space-y-0.5">
                {group.items.map((item) => {
                  const active = item.href === location;
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      data-testid={`link-nav-${item.label.toLowerCase().replaceAll(" ", "-")}`}
                      className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                        active
                          ? "bg-[hsl(var(--primary))/0.10] text-[hsl(var(--primary))]"
                          : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
                      }`}
                    >
                      <Icon
                        size={16}
                        strokeWidth={active ? 2.2 : 1.6}
                        className={
                          active
                            ? "text-[hsl(var(--primary))]"
                            : "text-[hsl(var(--muted-foreground))] group-hover:text-[hsl(var(--foreground))]"
                        }
                      />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </nav>

        <div className="mt-auto border-t border-[hsl(var(--sidebar-border))] px-2 pt-4">
          <div className="space-y-0.5 pb-3">
            {utilityItems.map((item) => {
              const active = item.href === location;
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  data-testid={`link-nav-${item.label.toLowerCase().replaceAll(" ", "-")}`}
                  className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                    active
                      ? "bg-[hsl(var(--primary))/0.10] text-[hsl(var(--primary))]"
                      : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
                  }`}
                >
                  <Icon
                    size={16}
                    strokeWidth={active ? 2.2 : 1.6}
                    className={
                      active
                        ? "text-[hsl(var(--primary))]"
                        : "text-[hsl(var(--muted-foreground))] group-hover:text-[hsl(var(--foreground))]"
                    }
                  />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[hsl(var(--muted))] font-mono text-xs font-bold text-[hsl(var(--muted-foreground))]">
              {initials(user?.name || "Sruthi")}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-[hsl(var(--foreground))]">
                {user?.name || "sruthi"}
              </p>
              <p className="truncate text-[10px] text-[hsl(var(--muted-foreground))] font-mono">
                Operator
              </p>
            </div>
            <button
              className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--destructive))] transition"
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
          className="fixed inset-0 z-20 bg-[hsl(var(--foreground))]/0.20 backdrop-blur-sm md:hidden"
          onClick={() => setMobileOpen(false)}
          data-testid="button-close-overlay"
          aria-label="Close menu"
        />
      )}

      <main className="min-h-[100dvh] md:pl-64">
        <DemoAuthBanner />

        <header className="sticky top-0 z-20 border-b border-[hsl(var(--border))]/60 bg-[hsl(var(--background))]/80 backdrop-blur-md">
          <div className="flex h-14 items-center px-5 sm:px-8">
            <button
              className="rounded-md p-1.5 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] md:hidden"
              onClick={() => setMobileOpen(true)}
              data-testid="button-open-menu"
            >
              <Menu size={18} />
            </button>
            <div className="ml-3 flex flex-col">
              <p className="text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">
                {meta.eyebrow}
              </p>
              <p className="text-sm font-semibold tracking-tight text-[hsl(var(--foreground))]">
                {meta.title}
              </p>
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-[1500px] px-5 py-6 sm:px-8">
          {children}
        </div>
      </main>
    </div>
  );
}

function ClerkAuthGate({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  const auth = useGetAuthMe({
    query: {
      queryKey: getGetAuthMeQueryKey(),
      enabled: isLoaded && Boolean(isSignedIn),
    },
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
    <div className="min-h-[100dvh] bg-[hsl(var(--background))] p-8">
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
      <div className="grid w-full max-w-[1050px] gap-10 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-7 md:grid-cols-[1.15fr_0.85fr] md:p-10">
        <div className="flex flex-col justify-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[hsl(var(--primary))] font-mono text-sm font-bold text-[hsl(var(--primary-foreground))]">
            LS
          </div>
          <p className="mt-10 text-[10px] font-bold uppercase tracking-[.22em] text-[hsl(var(--muted-foreground))]">
            Lead response engine
          </p>
          <h1 className="mt-3 max-w-xl text-4xl font-bold tracking-[-.06em] sm:text-5xl">
            Turn every enquiry into a human-ready handoff.
          </h1>
          <p className="mt-5 max-w-lg text-base leading-7 text-[hsl(var(--muted-foreground))]">
            A policy-first operator console for real-estate teams running US and
            India market profiles.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/sign-in"
              className="inline-flex items-center justify-center rounded-lg bg-[hsl(var(--primary))] px-4 py-3 text-sm font-bold text-[hsl(var(--primary-foreground))] hover:bg-[hsl(var(--primary))/90]"
              data-testid="link-sign-in"
            >
              Sign in to workspace
            </Link>
            <Link
              href="/sign-up"
              className="inline-flex items-center justify-center rounded-lg border border-[hsl(var(--border))] px-4 py-3 text-sm font-bold text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]"
              data-testid="link-sign-up"
            >
              Create workspace
            </Link>
          </div>
        </div>
        <div className="rounded-xl bg-[hsl(var(--primary))] p-6 text-[hsl(var(--primary-foreground))] md:p-10">
          <p className="text-[10px] font-bold uppercase tracking-[.2em] text-[hsl(var(--primary-foreground))]/80">
            Built for the moment after the form fill
          </p>
          <div className="mt-8 space-y-5">
            {[
              "Qualify with approved language",
              "Escalate when a human is needed",
              "Book only verified appointments",
            ].map((item, index) => (
              <div
                key={item}
                className="flex items-start gap-3 border-t border-[hsl(var(--primary-foreground))/0.12] pt-5"
              >
                <span className="font-mono text-xs text-[hsl(var(--primary-foreground))/80]">
                  0{index + 1}
                </span>
                <p className="text-sm font-semibold leading-6">{item}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function AuthError({ error }: { error?: unknown }) {
  const signOutAction = useSignOutAction();
  const rawErr =
    (error as any)?.data?.detail ||
    (error as any)?.data?.error ||
    (error as any)?.message;
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[hsl(var(--background))] px-5">
      <div className="w-full max-w-[420px] rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-8 text-center">
        <AlertTriangle
          className="mx-auto text-[hsl(var(--destructive))]"
          size={24}
        />
        <h1 className="mt-4 text-xl font-bold">
          Workspace setup is incomplete
        </h1>
        <p className="mt-2 text-sm leading-6 text-[hsl(var(--muted-foreground))]">
          Your sign-in is valid, but the operator workspace could not be loaded.
          Try again or sign out.
        </p>
        {rawErr && (
          <div className="mt-4 rounded-lg bg-[hsl(var(--muted))/0.8] p-3 text-left font-mono text-[11px] text-[hsl(var(--muted-foreground))] break-words">
            {String(rawErr)}
          </div>
        )}
        <div className="mt-6 flex justify-center gap-2">
          <Button onClick={() => window.location.reload()} variant="primary">
            Try again
          </Button>
          <Button onClick={() => signOutAction(basePath || "/")}>
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}

function AuthNotConfigured() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[hsl(var(--background))] px-5">
      <div
        className="w-full max-w-[460px] rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-8 text-center"
        data-testid="auth-not-configured"
      >
        <AlertTriangle
          className="mx-auto text-[hsl(var(--destructive))]"
          size={24}
        />
        <h1 className="mt-4 text-xl font-bold">Sign-in is not configured</h1>
        <p className="mt-2 text-sm leading-6 text-[hsl(var(--muted-foreground))]">
          This deployment was built without a Clerk publishable key, so nobody
          can sign in yet. The site operator needs to set{" "}
          <code className="font-mono">VITE_CLERK_PUBLISHABLE_KEY</code> as a{" "}
          <strong>build-time</strong> variable, set the server's{" "}
          <code className="font-mono">CLERK_SECRET_KEY</code> and{" "}
          <code className="font-mono">CLERK_PUBLISHABLE_KEY</code>, and
          redeploy.
        </p>
      </div>
    </div>
  );
}

function DemoAuthNotice() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[hsl(var(--background))] px-4">
      <div className="w-full max-w-[420px] rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-8 text-center">
        <ShieldCheck className="mx-auto text-[hsl(var(--primary))]" size={24} />
        <h1 className="mt-4 text-xl font-bold">Sign-in is disabled</h1>
        <p className="mt-2 text-sm leading-6 text-[hsl(var(--muted-foreground))]">
          This build runs in demo auth mode, so there is no Clerk instance to
          sign in to. The workspace opens directly against the seeded demo
          business.
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
    <div className="flex min-h-[100dvh] items-center justify-center bg-[hsl(var(--background))] px-4">
      <SignIn
        routing="path"
        path={`${basePath}/sign-in`}
        signUpUrl={`${basePath}/sign-up`}
      />
    </div>
  );
}

function ClerkSignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[hsl(var(--background))] px-4">
      <SignUp
        routing="path"
        path={`${basePath}/sign-up`}
        signInUrl={`${basePath}/sign-in`}
      />
    </div>
  );
}

const SignInPage = DEMO_AUTH ? DemoAuthNotice : ClerkSignInPage;
const SignUpPage = DEMO_AUTH ? DemoAuthNotice : ClerkSignUpPage;

function ClerkHomeRoute() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) {
    return (
      <div className="min-h-[100dvh] bg-[hsl(var(--background))] p-8">
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
      if (
        previousUserId.current !== undefined &&
        previousUserId.current !== userId
      )
        queryClient.clear();
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
    colorPrimary: "#6d5df7",
    colorForeground: "#11111c",
    colorMutedForeground: "#71717a",
    colorDanger: "#e45749",
    colorBackground: "#fafafa",
    colorInput: "#e5e5e5",
    colorInputForeground: "#11111c",
    colorNeutral: "#d4d4d4",
    fontFamily: "Inter, sans-serif",
    borderRadius: "0.5rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-[#fafafa] rounded-xl w-[440px] max-w-full overflow-hidden",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-[#11111c]",
    headerSubtitle: "text-[#71717a]",
    socialButtonsBlockButtonText: "text-[#11111c]",
    formFieldLabel: "text-[#11111c]",
    footerActionLink: "text-[#6d5df7]",
    footerActionText: "text-[#71717a]",
    dividerText: "text-[#71717a]",
    identityPreviewEditButton: "text-[#6d5df7]",
    formFieldSuccessText: "text-[#2f6b49]",
    alertText: "text-[#e45749]",
    logoBox: "mb-4",
    logoImage: "h-10 w-10 rounded-xl",
    socialButtonsBlockButton: "border-[#d4d4d4] bg-white hover:bg-[#f4f4f5]",
    formButtonPrimary: "bg-[#6d5df7] hover:bg-[#5b48d9]",
    formFieldInput: "border-[#d4d4d4] bg-white text-[#11111c]",
    footerAction: "bg-transparent",
    dividerLine: "bg-[#d4d4d4]",
    alert: "border-[#f9d6d3] bg-[#fdf4f1]",
    otpCodeFieldInput: "border-[#d4d4d4] bg-white text-[#11111c]",
    formFieldRow: "text-[#11111c]",
    main: "bg-transparent",
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
        signIn: {
          start: {
            title: "Welcome back",
            subtitle: "Sign in to access your workspace",
          },
        },
        signUp: {
          start: {
            title: "Create your workspace",
            subtitle: "Start your LeadSprint operation",
          },
        },
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
  if (AUTH_MODE === "unconfigured") return <AuthNotConfigured />;
  return (
    <WouterRouter base={basePath}>
      {DEMO_AUTH ? <DemoApp /> : <ClerkApp />}
    </WouterRouter>
  );
}

export default App;
