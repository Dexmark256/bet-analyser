-- Run this entire file once in your Supabase project's SQL Editor
-- (Dashboard -> SQL Editor -> New query -> paste -> Run)

-- ============================================================
-- IMPORTANT: before running, replace the placeholder email below
-- with the email you'll use to log into the admin panel.
-- ============================================================
-- find/replace: admin@example.com  ->  your real email

create table if not exists devices (
  device_id text primary key,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  app_version text
);

create table if not exists user_stats (
  device_id text primary key references devices(device_id) on delete cascade,
  total_bets integer not null default 0,
  settled_bets integer not null default 0,
  total_staked numeric not null default 0,
  net_profit numeric not null default 0,
  win_rate numeric not null default 0,
  roi numeric not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists perf_logs (
  id bigint generated always as identity primary key,
  device_id text,
  load_ms integer,
  created_at timestamptz not null default now()
);

create table if not exists error_logs (
  id bigint generated always as identity primary key,
  device_id text,
  message text,
  stack text,
  created_at timestamptz not null default now()
);

-- ---- Row Level Security ----
-- Anonymous app users can only INSERT/UPSERT (write), never read.
-- Only the authenticated admin (matched by email below) can read.

alter table devices enable row level security;
alter table user_stats enable row level security;
alter table perf_logs enable row level security;
alter table error_logs enable row level security;

-- devices: anon can insert + update (to bump last_seen), admin can select
create policy "anon insert devices" on devices for insert to anon with check (true);
create policy "anon update devices" on devices for update to anon using (true) with check (true);
create policy "admin select devices" on devices for select to authenticated
  using (auth.jwt() ->> 'email' = 'admin@example.com');

-- user_stats: anon can insert + update (upsert their own snapshot), admin can select
create policy "anon insert user_stats" on user_stats for insert to anon with check (true);
create policy "anon update user_stats" on user_stats for update to anon using (true) with check (true);
create policy "admin select user_stats" on user_stats for select to authenticated
  using (auth.jwt() ->> 'email' = 'admin@example.com');

-- perf_logs: anon can insert only, admin can select
create policy "anon insert perf_logs" on perf_logs for insert to anon with check (true);
create policy "admin select perf_logs" on perf_logs for select to authenticated
  using (auth.jwt() ->> 'email' = 'admin@example.com');

-- error_logs: anon can insert only, admin can select
create policy "anon insert error_logs" on error_logs for insert to anon with check (true);
create policy "admin select error_logs" on error_logs for select to authenticated
  using (auth.jwt() ->> 'email' = 'admin@example.com');
