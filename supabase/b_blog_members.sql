-- 公式サイトの作り直し 便 3（2026-11-25 Naoki OK）：ブログの記事の「会員限定にする所」
-- N 番目の見出し（h2）から後ろを、無料会員登録かログインをした人だけに出す。空なら全部だれでも読める
alter table public.b_blog_posts add column if not exists members_from smallint;
alter table public.b_blog_posts drop constraint if exists b_blog_posts_members_from_check;
alter table public.b_blog_posts add constraint b_blog_posts_members_from_check check (members_from is null or members_from between 1 and 50);
