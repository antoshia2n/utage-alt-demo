-- B の便 4：商品の台帳。本番のプロジェクト（htzadzpckcpdrmpjvaut）に 1 回流す。
-- 何回流しても同じ結果になる。既にある表には、最後の 2 つ（権限の 2 行・便 3 で変わった流入元を戻す 1 行）だけ触る。
-- 最初の値は UTAGE の商品の価格の行 17 本（2026-10-08 に UTAGE の道具で読んだ）。全部「サイトに出さない」で入れる。
-- 売れるのは UnivaPay のカードの 10 本。Stripe の 4 本・銀行振込の 2 本・分割の 1 本は「売らない」で写すだけ。
-- 買った記録は表を増やさず、出来事の記録（b_events）に purchase_completed として積む。

create table if not exists public.b_products (
  id               text primary key check (id ~ '^[a-z0-9-]{2,40}$'),
  name             text not null,
  kind             text not null check (kind in ('one_time','subscription','installment')),
  amount           integer not null check (amount > 0),
  currency         text not null default 'jpy',
  period           text check (period in ('monthly','annually')),
  installments     integer check (installments between 2 and 60),
  grant_days       integer check (grant_days between 1 and 3650),
  grants           text[] not null default '{}',
  deny_multiple    boolean not null default false,
  sales_limit      integer check (sales_limit > 0),
  list_price_of    text references public.b_products(id),
  description      text not null default '',
  active           boolean not null default false,
  public           boolean not null default false,
  sort             integer not null default 100,
  utage_product_id text,
  utage_detail_id  text,
  note             text not null default '',
  updated_at       timestamptz not null default now(),
  updated_by       text not null default 'seed',
  check ((kind = 'subscription') = (period is not null)),
  check ((kind = 'installment') = (installments is not null))
);

alter table public.b_products enable row level security;
revoke all on public.b_products from anon, authenticated;

insert into public.b_products
  (id, name, kind, amount, period, installments, grant_days, deny_multiple, list_price_of, active, sort, utage_product_id, utage_detail_id, note) values
  ('next-monthly',        'シアラボNEXT',                         'subscription', 11000,  'monthly', null, null, true,  null,           true,  10, '3rbQ3xLEDY5S', 'BSU4dYLkAGuM', ''),
  ('next-premium',        'シアラボNEXTプレミアム',               'subscription', 22000,  'monthly', null, null, true,  null,           true,  11, '3rbQ3xLEDY5S', 'OCpMpkxmMaVh', ''),
  ('next-premium-annual', 'シアラボNEXTプレミアム＠年間払い',     'one_time',     240000, null,      null, 365,  true,  null,           true,  12, '3rbQ3xLEDY5S', 'aQSgCRsjpygX', 'UTAGE では単発の決済。365 日の権利として写した'),
  ('next-premium-ref',    'シアラボNEXTプレミアム＠紹介',         'subscription', 15000,  'monthly', null, null, true,  'next-premium', true,  13, 'YYIVsWjph8SG', 'hR9mm8hqgfzF', '紹介用の価格。サイトに出さず、リンクを渡した人だけが買える'),
  ('onecoin-consult-60',  'ワンコインコンサル60分',               'one_time',     500,    null,      null, null, false, null,           true,  20, 'pnUqewknuLOd', 'BJcIKLQuMAAJ', ''),
  ('ever-oto-500',        'ワンタイムオファー500円',              'one_time',     500,    null,      null, null, false, null,           true,  21, '6snoHgOZL27C', 'mU2qEigMBcm7', ''),
  ('ever-consult-5000',   '個別コンサル5000円',                   'one_time',     5000,   null,      null, null, false, null,           true,  22, '6snoHgOZL27C', 'ANCnLU9GeEmj', ''),
  ('spot-500-event',      'スポットコンサル500円（イベント用）',  'one_time',     500,    null,      null, null, false, null,           true,  23, '6snoHgOZL27C', '2t6d3xMA6zXE', ''),
  ('consult-250k',        'しあらぼコンサル費用25万円分割枠',     'one_time',     250000, null,      null, null, false, null,           true,  30, 'zbwKNhsbn4sc', 'RK9DncLOe0pO', ''),
  ('consult-300k',        'しあらぼコンサル費用分割【30万円枠】', 'one_time',     300000, null,      null, null, false, null,           true,  31, 'zbwKNhsbn4sc', 'hJpFBlOKGViQ', ''),
  ('consult-100k-x3',     'しあらぼコンサル費用分割＠10万×3回',   'installment',  100000, null,      3,    null, false, null,           false, 32, 'zbwKNhsbn4sc', 'nkVi2Q5jW5io', '分割の決済は B ではまだ売らない'),
  ('ever-oto-500-bank',   'ワンタイムオファー500円（銀行振込）',  'one_time',     500,    null,      null, null, false, null,           false, 40, '6snoHgOZL27C', 'h1kcxJICwY28', '銀行振込は B ではまだ売らない'),
  ('ever-consult-5000-bank','個別コンサル5000円(銀行振込)',       'one_time',     5000,   null,      null, null, false, null,           false, 41, '6snoHgOZL27C', 'sxe9tg06Fh55', '銀行振込は B ではまだ売らない'),
  ('basic-monthly',       '【ベーシックプラン】継続課金',         'subscription', 11000,  'monthly', null, null, true,  null,           false, 50, 'TKPipq4zOkUB', '4iWjc2SEagRq', 'UTAGE では Stripe。B では売らない'),
  ('standard-monthly',    '【スタンダードプラン】継続課金',       'subscription', 33000,  'monthly', null, null, true,  null,           false, 51, 'TKPipq4zOkUB', 'zz5oeHAV8Anw', 'UTAGE では Stripe。B では売らない'),
  ('premium-monthly',     '【プレミアムプラン】継続課金',         'subscription', 55000,  'monthly', null, null, true,  null,           false, 52, 'TKPipq4zOkUB', '0ZrnBAVMzwY1', 'UTAGE では Stripe。B では売らない'),
  ('spot-consult',        'スポットコンサル料',                   'one_time',     11000,  null,      null, null, false, null,           false, 53, 'XpHTrkew0S1X', 'X9SRP8LkbCYo', 'UTAGE では Stripe。B では売らない')
on conflict (id) do nothing;

-- AI の道具を 2 つ足す（商品を読むのは自動、価格や売る・売らないを変えるのは承認）
insert into public.b_permissions (tool, mode, note) values
  ('list_products', 'auto',    '読む'),
  ('set_product',   'approve', '価格や売る・売らないを変える')
on conflict (tool) do nothing;

-- 便 3 の通しで、Naoki の行の流入元が other から direct に変わったのを戻す（印を付ける処理が行を新しく作ったため）
update public.b_profile set source = 'other'
where member_id = '327ce031-0a0c-4b5b-9cb2-38e62f506fab' and source = 'direct';

-- 確かめ（この 1 行だけが結果に出る）
select
  (select count(*) from public.b_products)                         as products,
  (select count(*) from public.b_products where active)            as sellable,
  (select count(*) from public.b_products where public)            as on_site,
  (select count(*) from public.b_permissions)                      as permissions,
  (select source from public.b_customers where id = '327ce031-0a0c-4b5b-9cb2-38e62f506fab') as naoki_source,
  has_table_privilege('anon', 'public.b_products', 'SELECT')
    or has_table_privilege('authenticated', 'public.b_products', 'SELECT') as browser_can_read;
