-- B の便 12c：商品管理の強化（2026-10-10 Naoki「進めて」）。
-- 本番のプロジェクト（htzadzpckcpdrmpjvaut）に 1 回流す。何回流しても同じ結果になる。既にある行は上書きしない。
-- 足すもの（b_products の欄 3 つ）：
--   1. card_installments … 単発の商品で、カード会社の分割払いをお客さんが選べるようにする
--   2. failed_mail_subject・failed_mail_body … 定期と分割で課金が失敗したときのメールの文（空なら最初の文）
-- 回数を決めた分割（kind = installment・回数は installments）の欄は便 4 からある。
-- 継続課金の一覧と解約は表を増やさず、出来事（subscription_*）から計算する。
-- 戻し方：alter table public.b_products drop column card_installments, drop column failed_mail_subject, drop column failed_mail_body;

alter table public.b_products add column if not exists card_installments boolean not null default false;
alter table public.b_products add column if not exists failed_mail_subject text;
alter table public.b_products add column if not exists failed_mail_body text;
alter table public.b_products drop constraint if exists b_products_card_installments_check;
alter table public.b_products add constraint b_products_card_installments_check check (not card_installments or kind = 'one_time');
alter table public.b_products drop constraint if exists b_products_failed_mail_check;
alter table public.b_products add constraint b_products_failed_mail_check check (char_length(coalesce(failed_mail_subject, '')) <= 200 and char_length(coalesce(failed_mail_body, '')) <= 4000);

-- 確かめ：結果の 1 行が 3 | 0 なら正しい
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'b_products'
     and column_name in ('card_installments', 'failed_mail_subject', 'failed_mail_body')) as new_columns,
  (select count(*) from public.b_products where card_installments)                    as card_installment_products;
