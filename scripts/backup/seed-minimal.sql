-- Minimal deterministic seed for backup/restore verification.
--
-- One workspace with one lead, one call and one usage row — just enough
-- relational shape (foreign keys, timestamptz, numerics) that a
-- restore-verify round trip proves DATA survives, not only the schema.
-- Ids are fixed so the seed is repeatable; it is only ever run against
-- throwaway databases (CI service, scratch restore targets), never
-- against a live pilot database.
--
-- Usage: psql "$DATABASE_URL" -f scripts/backup/seed-minimal.sql

insert into businesses (id, name, phone_number, transfer_number, project_name)
values ('business_backup_seed', 'Backup Seed Realty', '+12125550100', '+12125550101', 'Backup verification')
on conflict (id) do nothing;

insert into users (id, business_id, name, email, role)
values ('user_backup_seed', 'business_backup_seed', 'Seed Operator', 'seed@example.com', 'owner')
on conflict (id) do nothing;

insert into contacts (id, business_id, name, phone, consent_status, consent_source, consent_at)
values ('contact_backup_seed', 'business_backup_seed', 'Seed Lead', '+12125550102', 'valid', 'backup seed form', now())
on conflict (id) do nothing;

insert into leads (id, business_id, contact_id, project, property_type, budget_label, location, timeline)
values ('lead_backup_seed', 'business_backup_seed', 'contact_backup_seed', 'Backup verification', 'Condo', '$500k', 'Seedville', 'soon')
on conflict (id) do nothing;

insert into calls (id, business_id, contact_id, lead_id, idempotency_key, status, duration_seconds)
values ('call_backup_seed', 'business_backup_seed', 'contact_backup_seed', 'lead_backup_seed', 'seed_call_1', 'completed', 120)
on conflict (id) do nothing;

insert into usage (id, business_id, period_start, period_end, voice_minutes, booking_count, estimated_cost)
values ('usage_backup_seed', 'business_backup_seed', date_trunc('month', now()), date_trunc('month', now()) + interval '1 month' - interval '1 second', '2.0', 1, '0.24')
on conflict (id) do nothing;
