import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendMail = vi.hoisted(() => vi.fn());
vi.mock("nodemailer", () => ({
  default: { createTransport: vi.fn(() => ({ sendMail })) },
}));

import { sendBusinessAlertEmail } from "./mailer";

const SMTP = { SMTP_HOST: "smtp.example", SMTP_USER: "alerts@leadsprint.example", SMTP_PASSWORD: "pw" };

beforeEach(() => {
  sendMail.mockReset();
  sendMail.mockResolvedValue({});
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("sendBusinessAlertEmail", () => {
  it("returns false and sends nothing when SMTP is not configured", async () => {
    expect(await sendBusinessAlertEmail("owner@acme.example", "EMERGENCY", ["line"])).toBe(false);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("returns false when there is no recipient", async () => {
    for (const [key, value] of Object.entries(SMTP)) vi.stubEnv(key, value);
    expect(await sendBusinessAlertEmail("", "EMERGENCY", ["line"])).toBe(false);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("sends to the given address, from the configured sender, as text and HTML", async () => {
    for (const [key, value] of Object.entries(SMTP)) vi.stubEnv(key, value);
    vi.stubEnv("SMTP_FROM", "LeadSprint <alerts@leadsprint.example>");
    const sent = await sendBusinessAlertEmail("owner@acme.example", "EMERGENCY lead", ["Name: Sam", "Problem: burst pipe"]);
    expect(sent).toBe(true);
    expect(sendMail).toHaveBeenCalledTimes(1);
    const message = sendMail.mock.calls[0]?.[0];
    expect(message).toMatchObject({
      to: "owner@acme.example",
      from: "LeadSprint <alerts@leadsprint.example>",
      subject: "EMERGENCY lead",
      text: "Name: Sam\nProblem: burst pipe",
    });
    expect(message.html).toContain("<p>Name: Sam</p>");
  });

  it("escapes customer-supplied text in the HTML body", async () => {
    for (const [key, value] of Object.entries(SMTP)) vi.stubEnv(key, value);
    await sendBusinessAlertEmail("owner@acme.example", "EMERGENCY", ['Problem: <script>alert("x")</script> & more']);
    const { html, text } = sendMail.mock.calls[0]?.[0];
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp; more");
    // The plain-text part is not HTML, so it keeps the original characters.
    expect(text).toContain("<script>");
  });

  it("falls back to the SMTP user as the sender when SMTP_FROM is unset", async () => {
    for (const [key, value] of Object.entries(SMTP)) vi.stubEnv(key, value);
    await sendBusinessAlertEmail("owner@acme.example", "EMERGENCY", ["x"]);
    expect(sendMail.mock.calls[0]?.[0].from).toBe("alerts@leadsprint.example");
  });

  it("lets a transport failure surface to the caller (intake catches it)", async () => {
    for (const [key, value] of Object.entries(SMTP)) vi.stubEnv(key, value);
    sendMail.mockRejectedValue(new Error("connection refused"));
    await expect(sendBusinessAlertEmail("owner@acme.example", "EMERGENCY", ["x"])).rejects.toThrow("connection refused");
  });
});
