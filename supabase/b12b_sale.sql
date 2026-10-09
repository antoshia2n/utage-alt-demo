-- B の便 12b：売るページ（2026-10-10 Naoki「進めて」）。
-- 本番のプロジェクト（htzadzpckcpdrmpjvaut）に 1 回流す。何回流しても同じ結果になる。既にある行は上書きしない。
-- 足すもの：
--   1. b_products に「決済のあとに移るページ」（thanks_page_slug）の欄
-- 商品「シアラボ（1 年）」は SQL では入れない。Lab OS の AI の道具 set_product（承認）で足す。
-- 戻し方：alter table public.b_products drop column thanks_page_slug;

alter table public.b_products add column if not exists thanks_page_slug text;
alter table public.b_products drop constraint if exists b_products_thanks_page_slug_check;
alter table public.b_products add constraint b_products_thanks_page_slug_check check (thanks_page_slug is null or thanks_page_slug ~ '^[a-z0-9][a-z0-9-]{1,40}$');

-- 確かめ：結果の 1 行が 1 | 0 なら正しい
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'b_products' and column_name = 'thanks_page_slug') as new_column,
  (select count(*) from public.b_products where thanks_page_slug is not null)                                                                     as linked_products;
