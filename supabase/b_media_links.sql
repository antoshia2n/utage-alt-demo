-- メディアの便 M2（2026-11-07）：メディアの共有リンク。1 つのファイルに何本でも作れ、本ごとに止める・期限・開かれた数を持つ。
-- 本番のプロジェクト（htzadzpckcpdrmpjvaut）に 1 回流す。何回流しても同じ結果になる。読み書きは Worker が秘密の鍵で行う。
-- 戻し方：drop table public.b_media_links;
create table if not exists public.b_media_links (
  id           uuid primary key default gen_random_uuid(),
  media_id     uuid not null references public.b_media(id) on delete cascade,
  token        text not null unique check (token ~ '^[0-9a-f]{24}$'),
  label        text not null default '' check (char_length(label) <= 60),
  expires_at   timestamptz,
  stopped_at   timestamptz,
  opens        integer not null default 0,
  last_open_at timestamptz,
  created_at   timestamptz not null default now(),
  created_by   text not null default ''
);
create index if not exists b_media_links_media on public.b_media_links (media_id);
alter table public.b_media_links enable row level security;
revoke all on public.b_media_links from anon, authenticated;
