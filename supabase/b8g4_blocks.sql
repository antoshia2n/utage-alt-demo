-- B の便 8g-4：ブロックとテンプレ（便 8g-2 の紹介の列もここでまとめて入れる・統括 2026-10-09 16:50）。
-- 本番のプロジェクト（htzadzpckcpdrmpjvaut）に 1 回流す。何回流しても同じ結果になる。既にある行は上書きしない。
-- 足すもの：
--   1. b_products.affiliate_rate（紹介の報酬の率 %・便 8g-2。b8g2_refer.sql と同じ中身。どちらを先に流しても同じ結果）
--   2. 新しい表 b_templates（ブロック 1 つ／企画まるごとのテンプレ。中身はコネクタの設定の写し）
--   3. b_campaign_parts に 3 列（block_name：どのブロックに入っているか／template_id・template_version：どのテンプレのどの版から作ったか）
--   4. 便 8g-2〜8g-4 で足した道具の権限の行（表に無い道具は禁止のため、ここで入れる）
-- ブロックの入口と出口は保存しない（線＝コネクタの設定から毎回出す）。
-- 戻し方：drop table public.b_templates;
--         alter table public.b_campaign_parts drop column block_name, drop column template_id, drop column template_version;
--         delete from public.b_permissions where tool in ('list_referrals','mark_referral_paid','draft_flow','list_templates','save_template','use_template','copy_campaign','publish_block','list_blocks');

-- 1. 紹介の報酬の率（便 8g-2）
alter table public.b_products
  add column if not exists affiliate_rate integer;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'b_products_affiliate_rate_check') then
    alter table public.b_products
      add constraint b_products_affiliate_rate_check check (affiliate_rate is null or affiliate_rate between 0 and 100);
  end if;
end $$;

-- 2. テンプレ
create table if not exists public.b_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 80),
  kind        text not null check (kind in ('block','campaign')),
  version     integer not null default 1 check (version >= 1),
  body        jsonb not null default '{}'::jsonb,
  note        text not null default '' check (char_length(note) <= 500),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  text not null default 'seed',
  archived_at timestamptz
);
create unique index if not exists b_templates_live_name on public.b_templates (name) where archived_at is null;
alter table public.b_templates enable row level security;
revoke all on public.b_templates from anon, authenticated;

-- 3. 部品の持ち主の表に 3 列
alter table public.b_campaign_parts add column if not exists block_name text not null default '';
alter table public.b_campaign_parts add column if not exists template_id uuid references public.b_templates(id);
alter table public.b_campaign_parts add column if not exists template_version integer;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'b_campaign_parts_block_name_check') then
    alter table public.b_campaign_parts
      add constraint b_campaign_parts_block_name_check check (char_length(block_name) <= 60);
  end if;
end $$;
create index if not exists b_campaign_parts_block on public.b_campaign_parts (campaign_id, block_name) where block_name <> '';

-- 4. 道具の権限（ある行は上書きしない）
insert into public.b_permissions (tool, mode, note) values
  ('list_referrals',     'auto',    '紹介の集計を読む'),
  ('mark_referral_paid', 'approve', '紹介の報酬を払った記録（お金の記録）'),
  ('draft_flow',         'auto',    '一言の下書き（動かない下書きだけを作る）'),
  ('list_templates',     'auto',    'テンプレを読む'),
  ('save_template',      'auto',    'テンプレを保存する（何も動かない）'),
  ('use_template',       'auto',    'テンプレから下書きを作る（動かない）'),
  ('copy_campaign',      'auto',    '企画を下書きで複製する（動かない）'),
  ('publish_block',      'approve', 'ブロックの中身をまとめて動かす'),
  ('list_blocks',        'auto',    'ブロックの一覧と入口・出口を読む')
on conflict (tool) do nothing;

-- 確かめ（この 1 行だけが結果に出る）
select
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'b_products' and column_name = 'affiliate_rate')                 as rate_column,
  (select count(*) from public.b_templates)                                                                         as templates,
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'b_campaign_parts'
       and column_name in ('block_name','template_id','template_version'))                                          as part_columns,
  (select count(*) from public.b_permissions
     where tool in ('list_referrals','mark_referral_paid','draft_flow','list_templates','save_template','use_template','copy_campaign','publish_block','list_blocks')) as new_tools,
  (select mode from public.b_permissions where tool = 'publish_block')                                              as publish_mode,
  has_table_privilege('anon', 'public.b_templates', 'SELECT')
    or has_table_privilege('authenticated', 'public.b_templates', 'SELECT')                                          as browser_can_read;
