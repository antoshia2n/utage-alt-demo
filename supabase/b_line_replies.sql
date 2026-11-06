-- 便 L2（2026-11-06 Naoki OK 23:40）：LINE のキーワードの自動応答とテンプレート。
-- 本番のプロジェクト（htzadzpckcpdrmpjvaut）に 1 回流す。何回流しても同じ結果になる。既にある表には触らない。
-- 読み書きは Worker が秘密の鍵で行う（anon・authenticated は読めない）。権限の最初の値は src/guard.js の DEFAULT_MODES（SQL は要らない）。
-- 戻し方：drop table public.b_line_replies; drop table public.b_line_templates;

create table if not exists public.b_line_templates (
  id          uuid primary key default gen_random_uuid(),
  account     text not null check (account ~ '^[a-z][a-z_]{1,19}$'),
  name        text not null check (char_length(name) between 1 and 120),
  messages    jsonb not null default '[]'::jsonb check (jsonb_typeof(messages) = 'array'),
  source      text not null default '' check (char_length(source) <= 80),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  text not null default ''
);
create index if not exists b_line_templates_account on public.b_line_templates (account);

create table if not exists public.b_line_replies (
  id          uuid primary key default gen_random_uuid(),
  account     text not null check (account ~ '^[a-z][a-z_]{1,19}$'),
  name        text not null default '' check (char_length(name) <= 120),
  keywords    jsonb not null default '[]'::jsonb check (jsonb_typeof(keywords) = 'array'),
  match       text not null default 'all' check (match in ('all', 'part')),
  messages    jsonb not null default '[]'::jsonb check (jsonb_typeof(messages) = 'array'),
  template_id uuid references public.b_line_templates (id) on delete restrict,
  active      boolean not null default false,
  sort        integer not null default 100,
  source      text not null default '' check (char_length(source) <= 80),
  hits        integer not null default 0,
  last_hit_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  text not null default ''
);
create index if not exists b_line_replies_account on public.b_line_replies (account, sort);

alter table public.b_line_templates enable row level security;
alter table public.b_line_replies enable row level security;
revoke all on public.b_line_templates from anon, authenticated;
revoke all on public.b_line_replies from anon, authenticated;
