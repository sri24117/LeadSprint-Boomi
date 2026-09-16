/**
 * Local stand-in for Retell and Cal.com, for the end-to-end smoke test.
 *
 * The CI pipeline proves typechecking, unit tests and builds. It does NOT
 * prove that a lead arriving at the intake webhook actually results in a
 * provider call request with the right metadata, a booking, and a
 * reconciled callback. This stub makes that path runnable end to end
 * without dialing a real phone or burning provider credit.
 *
 *   node scripts/src/provider-stub.mjs
 *   RETELL_API_URL=http://127.0.0.1:5510/retell
 *   CALCOM_API_URL=http://127.0.0.1:5510/cal
 *
 * It records every request it receives at GET /_calls so the smoke test
 * can assert on exactly what LeadSprint sent.
 */

import http from "node:http";

const PORT = Number(process.env.STUB_PORT ?? 5510);
const received = [];

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (req.method === "GET" && url.pathname === "/_calls") {
    return json(res, 200, received);
  }
  if (req.method === "DELETE" && url.pathname === "/_calls") {
    received.length = 0;
    return json(res, 200, { cleared: true });
  }

  let raw = "";
  req.on("data", (chunk) => {
    raw += chunk;
  });
  req.on("end", () => {
    let body = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = raw;
    }
    received.push({
      method: req.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      body,
    });

    // Retell: create a phone call.
    if (url.pathname === "/retell/v2/create-phone-call") {
      return json(res, 201, {
        call_id: `stub_call_${received.length}`,
        agent_id: body?.override_agent_id ?? null,
      });
    }
    // Cal.com: availability.
    if (url.pathname === "/cal/slots") {
      const day = url.searchParams.get("start")?.slice(0, 10) ?? "2026-09-17";
      return json(res, 200, {
        status: "success",
        data: {
          slots: [
            { start: `${day}T14:00:00.000Z`, end: `${day}T14:30:00.000Z` },
            { start: `${day}T15:00:00.000Z`, end: `${day}T15:30:00.000Z` },
          ],
        },
      });
    }
    // Cal.com: booking.
    if (url.pathname === "/cal/bookings") {
      return json(res, 201, {
        status: "success",
        data: { uid: `stub_booking_${received.length}`, id: received.length },
      });
    }
    return json(res, 404, { error: `stub has no handler for ${url.pathname}` });
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[provider-stub] listening on 127.0.0.1:${PORT}`);
  console.log(`[provider-stub] RETELL_API_URL=http://127.0.0.1:${PORT}/retell`);
  console.log(`[provider-stub] CALCOM_API_URL=http://127.0.0.1:${PORT}/cal`);
});
