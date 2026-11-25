-- 公式サイトの作り直し 便 1（2026-11-25 Naoki OK）：ブログの記事にカテゴリを 1 つ付ける欄
-- 公式サイトのサイドバー「カテゴリ」の一覧と、カテゴリで絞った一覧に使う。20 字まで・空でよい
alter table public.b_blog_posts add column if not exists category text;
alter table public.b_blog_posts drop constraint if exists b_blog_posts_category_check;
alter table public.b_blog_posts add constraint b_blog_posts_category_check check (category is null or char_length(category) between 1 and 20);
create index if not exists b_blog_posts_category_idx on public.b_blog_posts (category) where status = 'published';
