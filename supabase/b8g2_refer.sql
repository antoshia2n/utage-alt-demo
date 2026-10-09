-- B の便 8g-2：紹介。本番のプロジェクト（htzadzpckcpdrmpjvaut）に 1 回流す。何回流しても同じ結果になる。
-- 足すのは商品の台帳の列 1 本（紹介の報酬の率 %）だけ。紹介者の表は作らず、出来事の記録（b_events）に積む。
-- 最初の値はどの商品も空（＝払わない）。率は Lab OS の「商品」で 1 つずつ決める。
-- 新しい道具の権限（list_referrals 自動・mark_referral_paid 承認）は、コードの一覧から最初に使うときに入る（便 8d の作り）。

alter table public.b_products
  add column if not exists affiliate_rate integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'b_products_affiliate_rate_check') then
    alter table public.b_products
      add constraint b_products_affiliate_rate_check check (affiliate_rate is null or affiliate_rate between 0 and 100);
  end if;
end $$;

-- 確かめ（この 1 行だけが結果に出る）
select
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'b_products' and column_name = 'affiliate_rate')  as new_column,
  (select count(*) from public.b_products)                                                          as products,
  (select count(*) from public.b_products where affiliate_rate is not null)                         as with_rate,
  (select count(*) from pg_constraint where conname = 'b_products_affiliate_rate_check')            as rate_check,
  has_table_privilege('anon', 'public.b_products', 'SELECT')
    or has_table_privilege('authenticated', 'public.b_products', 'SELECT')                          as browser_can_read;
