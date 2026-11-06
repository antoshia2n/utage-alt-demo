-- メディアの便 M1（2026-11-07 Naoki OK 08:35）：メディアの棚の一覧。ファイルの中身は R2（IMAGES の箱の media/）。
-- 本番のプロジェクト（htzadzpckcpdrmpjvaut）に 1 回流す。何回流しても同じ結果になる。読み書きは Worker が秘密の鍵で行う。
-- 戻し方：drop table public.b_media;（R2 の media/ は残るので、要らなければ別に消す）
create table if not exists public.b_media (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('image','pdf','slide','video','audio','other')),
  name         text not null check (char_length(name) between 1 and 200),
  folder       text not null default '' check (char_length(folder) <= 60),
  r2_key       text,
  url          text check (url is null or char_length(url) <= 500),
  size         bigint not null default 0,
  content_type text not null default '' check (char_length(content_type) <= 100),
  source       text not null default '' check (char_length(source) <= 80),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   text not null default ''
);
create index if not exists b_media_created on public.b_media (created_at desc);
create unique index if not exists b_media_source on public.b_media (source) where source like 'utage:%';
alter table public.b_media enable row level security;
revoke all on public.b_media from anon, authenticated;
