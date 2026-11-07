-- 便 T2（2026-11-07 Naoki OK 23:05）：期間限定の公開。X収益化ロードマップ動画企画の「3日間限定で無料公開」のため。
--   closes_at … この時刻を過ぎたら公開のページを出さない（null なら期限なし）
--   closed_to … 期限のあとに出すページの住所の名前（null なら決まった「公開は終了しました」の画面）
-- 戻し方：alter table public.b_pages drop column if exists closes_at, drop column if exists closed_to;

alter table public.b_pages add column if not exists closes_at timestamptz;
alter table public.b_pages add column if not exists closed_to text;
alter table public.b_pages drop constraint if exists b_pages_closed_to_check;
alter table public.b_pages add constraint b_pages_closed_to_check check (closed_to is null or closed_to ~ '^[a-z0-9][a-z0-9-]{1,40}$');

-- 確かめ
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'b_pages' and column_name in ('closes_at', 'closed_to')) as new_columns,
  (select count(*) from public.b_pages) as pages;
