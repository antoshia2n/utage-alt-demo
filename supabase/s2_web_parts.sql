-- 便 S1・S2（2026-11-07）：公開サイトの見た目と部品。本番のプロジェクト（htzadzpckcpdrmpjvaut）に 1 回流す。何回流しても同じ結果になる。
-- 見た目は表を増やさず b_settings の 1 行（key=web_look・アプリが初めて保存したときに入る）。ここで作るのは部品の 2 つの表だけ。
--   b_web_parts      … 部品 1 つが 1 行。id はページに書く印（<div data-lab-part="part:id"></div>）の名前。rules は読者の段階ごとの中身
--   b_web_part_hits  … 部品を見た・押した・登録した（台帳にいない人も数えるので出来事の記録とは別）
-- 当たる行：新しい表 2 つ。今ある表の行には触らない。
-- 戻し方：drop table public.b_web_part_hits, public.b_web_parts;

create table if not exists public.b_web_parts (
  id          text primary key check (id ~ '^[a-z0-9][a-z0-9-]{1,30}$'),
  name        text not null check (char_length(name) between 1 and 60),
  place       text not null default 'free' check (place in ('mid','end','side','bar','free')),
  rules       jsonb not null default '{}'::jsonb,
  active      boolean not null default true,
  sort        integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  text not null default ''
);

create table if not exists public.b_web_part_hits (
  id          bigint generated always as identity primary key,
  part_id     text not null references public.b_web_parts(id) on delete cascade,
  kind        text not null check (kind in ('view','click','signup')),
  variant     text not null check (variant in ('new','list','consult','member','default')),
  page_id     uuid,
  vid         text not null check (vid ~ '^[a-z0-9]{8,40}$'),
  customer_id uuid,
  at          timestamptz not null default now()
);
create index if not exists b_web_part_hits_at on public.b_web_part_hits (at desc);
create index if not exists b_web_part_hits_part on public.b_web_part_hits (part_id, at desc);

alter table public.b_web_parts     enable row level security;
alter table public.b_web_part_hits enable row level security;
revoke all on public.b_web_parts, public.b_web_part_hits from anon, authenticated;

-- 確かめ（この 1 行だけが結果に出る）。2 つが true・browser_can_read が false なら正しい
select
  to_regclass('public.b_web_parts') is not null      as parts,
  to_regclass('public.b_web_part_hits') is not null  as hits,
  has_table_privilege('anon', 'public.b_web_parts', 'SELECT')
    or has_table_privilege('authenticated', 'public.b_web_part_hits', 'SELECT') as browser_can_read;
