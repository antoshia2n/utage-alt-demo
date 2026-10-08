-- B の便 5：届ける。ステップ配信の決まり・一斉配信・計測するリンクの 3 本。本番のプロジェクト（htzadzpckcpdrmpjvaut）に 1 回流す。
-- 何回流しても同じ結果になる。既にある表には、権限の 7 行を足すことだけ触る。
-- 送った・押した記録は表を増やさず、出来事の記録（b_events）に積む（email_sent・email_clicked など）。
-- ステップは「止めた」で入る行が 0 本。動かすのはシアニン用の画面か、承認を通した AI だけ。

create table if not exists public.b_steps (
  id           bigint generated always as identity primary key,
  name         text not null,
  trigger      text not null check (trigger in ('registered','purchase')),
  product_id   text references public.b_products(id),
  delay_hours  integer not null default 0 check (delay_hours between 0 and 8760),
  subject      text not null default '',
  body         text not null default '',
  active       boolean not null default false,
  active_since timestamptz,
  sort         integer not null default 100,
  updated_at   timestamptz not null default now(),
  updated_by   text not null default 'seed',
  check (not active or active_since is not null)
);

create table if not exists public.b_broadcasts (
  id           uuid primary key default gen_random_uuid(),
  subject      text not null,
  body         text not null,
  filter       jsonb not null default '{}'::jsonb,
  status       text not null default 'draft' check (status in ('draft','queued','sending','done','canceled')),
  target_count integer,
  created_by   text not null default 'unknown',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   text not null default 'unknown',
  queued_at    timestamptz,
  queued_by    text,
  finished_at  timestamptz
);
create index if not exists b_broadcasts_status on public.b_broadcasts (status, queued_at);

create table if not exists public.b_links (
  token      text primary key check (token ~ '^[0-9a-f]{12}$'),
  url        text not null,
  kind       text not null check (kind in ('step','broadcast','manual')),
  ref        text not null,
  created_at timestamptz not null default now(),
  unique (url, kind, ref)
);

alter table public.b_steps      enable row level security;
alter table public.b_broadcasts enable row level security;
alter table public.b_links      enable row level security;
revoke all on public.b_steps, public.b_broadcasts, public.b_links from anon, authenticated;

-- AI の道具を 7 つ足す（読む・数える・下書き・止めるは自動、一斉配信を送る列に入れるのとステップを変えるのは承認）
insert into public.b_permissions (tool, mode, note) values
  ('preview_audience', 'auto',    '数える'),
  ('list_broadcasts',  'auto',    '読む'),
  ('draft_broadcast',  'auto',    '下書き（送らない）'),
  ('cancel_broadcast', 'auto',    '送るのを止める'),
  ('list_steps',       'auto',    '読む'),
  ('queue_broadcast',  'approve', '一斉配信を送る'),
  ('set_step',         'approve', 'ステップ配信を変える・動かす')
on conflict (tool) do nothing;

-- 確かめ（この 1 行だけが結果に出る）
select
  (select count(*) from public.b_steps)        as steps,
  (select count(*) from public.b_broadcasts)   as broadcasts,
  (select count(*) from public.b_links)        as links,
  (select count(*) from public.b_permissions)  as permissions,
  has_table_privilege('anon', 'public.b_broadcasts', 'SELECT')
    or has_table_privilege('authenticated', 'public.b_links', 'SELECT')
    or has_table_privilege('anon', 'public.b_steps', 'SELECT') as browser_can_read;
