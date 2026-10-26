# Connecting Meta (Facebook / Instagram) lead ads

LeadSprint receives Meta leads through its existing signed intake endpoint,
`POST /api/webhooks/intake`, fed by a no-code connector (Zapier, Make, or Meta's
own CRM integration). No Meta app review is needed for this path. A native Meta
API connection is a later piece of work.

> **The consent rule is the important part.** A Meta lead is called only if the
> form carried explicit consent to automated phone calls. Without it, the lead is
> saved as **Needs consent**, the AI does **not** call, and the owner is told (for
> emergencies) so a person can phone them. See "Consent" below.

## 1. Choose how the connector authenticates

| Method | When to use | Setup |
|---|---|---|
| **HMAC signature** (default, preferred) | A developer or a tool that can compute HMAC-SHA256 | Send `x-leadsprint-signature: sha256=<hex>` of the raw body, signed with `LEAD_INTAKE_WEBHOOK_SECRET` |
| **Key header** (opt-in) | Zapier / Make without code | Set `INTAKE_ALLOW_KEY_AUTH=true` on the deployment, then send header `x-leadsprint-key: <LEAD_INTAKE_WEBHOOK_SECRET>` |

The key header is **weaker**: anyone who captures one request can replay it, so it
must only be used over HTTPS, and the secret should be unique per deployment. It is
off unless you enable it, and it never works when no intake secret is configured.

## 2. The request

`POST https://<client-subdomain>/api/webhooks/intake`, `Content-Type: application/json`.

```json
{
  "business_id": "<the workspace id>",
  "name": "{{full_name}}",
  "phone": "{{phone_number}}",
  "email": "{{email}}",
  "source": "meta_lead_ads",
  "campaign": "{{campaign_name}}",
  "form_id": "{{form_id}}",
  "consent_given": true,
  "consent_text": "I agree to be contacted by an automated assistant by phone about my request.",
  "details": {
    "service_type": "ac_repair",
    "problem": "{{what_is_the_problem}}",
    "zip": "{{zip_code}}",
    "address": "{{street_address}}",
    "preferred_time": "{{preferred_time}}"
  }
}
```

| Field | Notes |
|---|---|
| `source` | Must be exactly `meta_lead_ads` for the Meta consent rules to apply. |
| `form_id` | Required for consent to count. Stored with the evidence. |
| `consent_given` | A JSON **boolean** `true`. The string `"true"` does **not** count. |
| `consent_text` | The exact wording shown on the form, up to 1000 characters. Stored as evidence and shown to the operator. |
| `details` | A flat object: at most 20 keys, values are short text, numbers or booleans. Home-services keys: `service_type` (`ac_repair`, `ac_install`, `plumbing_repair`, `plumbing_install`, `water_heater`, `drain`, `other`), `problem`, `zip`, `address`, `property_type` (`home`, `apartment`, `commercial`), `preferred_time`. |
| `urgency` | Optional: `emergency`, `same_day`, `this_week`, `quote`. If omitted, an emergency is detected from the problem text (for example "smell gas", "burst pipe", "flooding"). |

A new lead returns `201` with `{"accepted": true, "lead_id": ..., "urgency": ..., "call": {...}}`.
A repeat of the same phone number returns `200` with `{"accepted": false, "reason": "duplicate"}`.

### Zapier

Trigger: **Facebook Lead Ads, New Lead**. Action: **Webhooks by Zapier, Custom
Request** (POST, Data Pass-Through off, the JSON body above, header
`x-leadsprint-key`). Map the trigger's fields into the `{{...}}` slots.

### Make

Module **Facebook Lead Ads, Watch Leads**, then **HTTP, Make a request**
(POST, body type Raw, content type JSON). Boolean `true` must be entered as
the literal `true`, not text.

## 3. Consent

The AI places a call only when LeadSprint holds **valid consent** for that number. For
Meta leads that means all three of: `consent_given` is `true`, `consent_text` is
present, and `form_id` is present. Otherwise the lead is kept, shown as **Needs
consent**, and not called.

**Never hard-code `"consent_given": true` unless the form cannot be submitted
without the consent box.** If the consent checkbox is optional on your form, map it
from the person's actual answer, or the system will record consent that was never
given.

Meta instant forms let you add a custom disclaimer with a consent checkbox
(confirm the current options in Meta's form builder). Suggested US wording:

> "By submitting this form, I agree that [Company name] and its automated
> assistant may call me at the number I provided about my service request. I
> understand the call may use an artificial or automated voice, and may be
> recorded. Consent is not a condition of purchase."

**This wording is a starting point and must be reviewed by a US attorney before
use.** Rules differ by state and for AI-generated voices, and calls are only ever
placed between 08:00 and 20:00 in the lead's local time.

## 4. Emergency alerts

For an `emergency` lead, LeadSprint emails the workspace's **Emergency alert email**
(Settings) immediately, whether or not the AI can call (for example when the lead
has no consent, is outside the service area, or arrives outside calling hours).
This needs SMTP configured (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`). A failed
email never blocks or fails intake.

## 5. Troubleshooting

| Symptom | Cause |
|---|---|
| `401 Invalid intake signature` | Wrong secret or signature; or key auth used while `INTAKE_ALLOW_KEY_AUTH` is not `true`. |
| `400 details ...` | `details` is not a flat object of simple values, or has more than 20 keys, or a value over 500 characters. |
| `400 consent_text ...` | The consent wording is longer than 1000 characters. |
| Lead shows **Needs consent** | One of `consent_given` (boolean true), `consent_text`, `form_id` is missing. |
| Lead shows "Out of service area — review" | Its ZIP matches none of the workspace's service-area entries (Settings). |
| No emergency email | No alert email set, SMTP not configured, or the lead was not classified as an emergency. |
