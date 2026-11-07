-- 便 S3（2026-11-07）：公開サイトのブログ。本番のプロジェクト（htzadzpckcpdrmpjvaut）に 1 回流す。何回流しても同じ結果になる。
--   b_blog_posts … ブログの記事 1 本が 1 行。コンテンツくんの記事（posts）を写したもの。slug は住所 lp.shia2n.jp/blog/slug
--   b_blog_hits  … 記事を見た（端末の印 vid ごと）
-- 当たる行：新しい表 2 つ。今ある表の行には触らない（posts は読むだけで、つながりの制約も張らない）。
-- 戻し方：drop table public.b_blog_hits, public.b_blog_posts;

create table if not exists public.b_blog_posts (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,60}$'),
  title             text not null check (char_length(title) between 1 and 120),
  description       text not null default '' check (char_length(description) <= 200),
  body_html         text not null default '',
  thumb_url         text check (thumb_url is null or thumb_url ~ '^https://'),
  gift_part         text references public.b_web_parts(id) on delete set null,
  status            text not null default 'draft' check (status in ('draft','published')),
  published_at      timestamptz,
  source_post_id    bigint unique,
  source_updated_at timestamptz,
  copied_at         timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  updated_by        text not null default ''
);
create index if not exists b_blog_posts_pub on public.b_blog_posts (status, published_at desc);

create table if not exists public.b_blog_hits (
  id          bigint generated always as identity primary key,
  post_id     uuid not null references public.b_blog_posts(id) on delete cascade,
  vid         text not null check (vid ~ '^[a-z0-9]{8,40}$'),
  customer_id uuid,
  at          timestamptz not null default now()
);
create index if not exists b_blog_hits_at on public.b_blog_hits (at desc);

alter table public.b_blog_posts enable row level security;
alter table public.b_blog_hits  enable row level security;
revoke all on public.b_blog_posts, public.b_blog_hits from anon, authenticated;

-- 確かめ（この 1 行だけが結果に出る）。2 つが true・browser_can_read が false なら正しい
select
  to_regclass('public.b_blog_posts') is not null  as posts,
  to_regclass('public.b_blog_hits') is not null   as hits,
  has_table_privilege('anon', 'public.b_blog_posts', 'SELECT')
    or has_table_privilege('authenticated', 'public.b_blog_hits', 'SELECT') as browser_can_read;
