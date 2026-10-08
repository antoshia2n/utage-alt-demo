-- B の便 3：AI（MCP）の道具ごとの権限と、承認待ちの台帳。本番のプロジェクト（htzadzpckcpdrmpjvaut）に 1 回流す。
-- 何回流しても同じ結果になる。既にある表には触らない。最初の値は src/guard.js の DEFAULT_MODES と同じ。
-- 作った回に anon・authenticated の許可を外す（2026-10-08 の 21 本の件の予防）。読み書きは Worker が秘密の鍵で行う。

create table if not exists public.b_permissions (
  tool        text primary key check (tool ~ '^[a-z_]{2,40}$'),
  mode        text not null check (mode in ('auto','approve','deny')),
  note        text not null default '',
  updated_at  timestamptz not null default now(),
  updated_by  text not null default 'seed'
);

create table if not exists public.b_approvals (
  id           uuid primary key default gen_random_uuid(),
  tool         text not null,
  args         jsonb not null default '{}'::jsonb,
  requested_by text not null default 'mcp',
  status       text not null default 'pending' check (status in ('pending','approved','rejected','expired','failed')),
  result       jsonb,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '24 hours',
  decided_at   timestamptz,
  decided_by   text
);
create index if not exists b_approvals_status_time on public.b_approvals (status, created_at desc);

alter table public.b_permissions enable row level security;
alter table public.b_approvals   enable row level security;
revoke all on public.b_permissions, public.b_approvals from anon, authenticated;

insert into public.b_permissions (tool, mode, note) values
  ('find_person',           'auto',    '読む'),
  ('get_timeline',          'auto',    '読む'),
  ('stats',                 'auto',    '数える'),
  ('list_rooms',            'auto',    '読む'),
  ('get_room',              'auto',    '読む'),
  ('list_consults',         'auto',    '読む'),
  ('list_seminars',         'auto',    '読む'),
  ('list_approvals',        'auto',    '読む'),
  ('get_approval',          'auto',    '読む'),
  ('list_permissions',      'auto',    '読む'),
  ('send_seminar_reminder', 'auto',    '決まった型のリマインド'),
  ('send_email',            'approve', '送る'),
  ('return_correction',     'approve', '添削の返信'),
  ('set_deal_stage',        'approve', '商談の段階を変える'),
  ('set_note_member',       'approve', '台帳の印を変える'),
  ('send_seminar_archive',  'approve', '申込者へまとめて送る')
on conflict (tool) do nothing;

-- 確かめ（この 1 行だけが結果に出る）
select
  (select count(*) from public.b_permissions)                          as permissions,
  (select count(*) from public.b_permissions where mode = 'approve')   as approve,
  (select count(*) from public.b_approvals)                            as approvals,
  has_table_privilege('anon', 'public.b_permissions', 'SELECT')
    or has_table_privilege('authenticated', 'public.b_approvals', 'SELECT') as browser_can_read;
