import nodemailer, { type Transporter } from "nodemailer";

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

export function smtpConfigured(): boolean {
  return Boolean(env("SMTP_HOST") && env("SMTP_USER") && env("SMTP_PASSWORD"));
}

let cachedTransporter: Transporter | undefined;

function transporter(): Transporter {
  if (cachedTransporter) return cachedTransporter;
  const host = env("SMTP_HOST");
  const user = env("SMTP_USER");
  const pass = env("SMTP_PASSWORD");
  if (!host || !user || !pass) {
    throw new Error("SMTP is not configured (SMTP_HOST/SMTP_USER/SMTP_PASSWORD)");
  }
  cachedTransporter = nodemailer.createTransport({
    host,
    port: Number(env("SMTP_PORT") ?? "587"),
    secure: env("SMTP_SECURE") === "true",
    auth: { user, pass },
  });
  return cachedTransporter;
}

export interface WeeklyReportEmailInput {
  to: string;
  businessName: string;
  periodLabel: string;
  leadsReceived: number;
  callsAttempted: number;
  callsConnected: number;
  qualifiedLeads: number;
  appointmentsBooked: number;
  transferRate: number;
  failedActions: number;
  voiceMinutes: number;
  estimatedProviderCost: number;
}

function renderWeeklyReportEmail(input: WeeklyReportEmailInput): { subject: string; text: string; html: string } {
  const rows: Array<[string, string]> = [
    ["Leads received", String(input.leadsReceived)],
    ["Calls attempted", String(input.callsAttempted)],
    ["Calls connected", String(input.callsConnected)],
    ["Qualified leads", String(input.qualifiedLeads)],
    ["Appointments booked", String(input.appointmentsBooked)],
    ["Transfer rate", `${Math.round(input.transferRate * 100)}%`],
    ["Failed / uncertain actions", String(input.failedActions)],
    ["Voice minutes used", input.voiceMinutes.toFixed(1)],
    ["Estimated provider cost", `$${input.estimatedProviderCost.toFixed(2)}`],
  ];
  const subject = `LeadSprint weekly report — ${input.businessName} — ${input.periodLabel}`;
  const text = [`${input.businessName} — ${input.periodLabel}`, "", ...rows.map(([label, value]) => `${label}: ${value}`)].join("\n");
  const html = `
    <div style="font-family: -apple-system, Arial, sans-serif; max-width: 480px;">
      <h2 style="margin-bottom: 4px;">${input.businessName}</h2>
      <p style="color: #667; margin-top: 0;">${input.periodLabel}</p>
      <table style="width: 100%; border-collapse: collapse;">
        ${rows
          .map(
            ([label, value]) =>
              `<tr><td style="padding: 6px 0; border-bottom: 1px solid #eee; color:#445;">${label}</td><td style="padding: 6px 0; border-bottom: 1px solid #eee; text-align: right; font-weight: 600;">${value}</td></tr>`,
          )
          .join("")}
      </table>
    </div>`;
  return { subject, text, html };
}

/**
 * Sends the weekly pilot report by email if SMTP is configured. Returns
 * `false` (not an error) when SMTP isn't set up yet, so this can be called
 * unconditionally from a scheduled job during Phase 1 while email delivery
 * is still being wired up — matches the plan's fail-closed-but-visible
 * pattern used for the voice/calendar providers.
 */
export async function sendWeeklyReportEmail(input: WeeklyReportEmailInput): Promise<boolean> {
  if (!smtpConfigured()) return false;
  const { subject, text, html } = renderWeeklyReportEmail(input);
  const from = env("SMTP_FROM") ?? env("SMTP_USER")!;
  await transporter().sendMail({ from, to: input.to, subject, text, html });
  return true;
}
