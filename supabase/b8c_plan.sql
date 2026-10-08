-- B の便 8c：企画（b_campaigns）と、部品の持ち主（b_campaign_parts）。設計図はこの 2 本と部品どうしのつながりから毎回組み立てる。
-- 本番のプロジェクト（htzadzpckcpdrmpjvaut）に 1 回流す。何回流しても同じ結果になる。既にある表には触らない。
-- 作った回に anon・authenticated の許可を外す。読み書きは Worker が秘密の鍵で行う。
-- 部品 1 つにつき持ち主の企画は 1 つ（主キーが部品の種類と番号）。「常設」の企画は 1 つだけ。しまっていない企画の名前は重ならない。
-- 戻し方：drop table public.b_campaign_parts; drop table public.b_campaigns;
--         delete from public.b_permissions where tool in ('list_campaigns','get_blueprint','create_campaign','set_part_campaign','archive_campaign');

create table if not exists public.b_campaigns (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 80),
  kind        text not null default 'campaign' check (kind in ('campaign','standing')),
  starts_on   date,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  created_by  text not null default 'seed',
  updated_at  timestamptz not null default now(),
  updated_by  text not null default 'seed',
  check (kind = 'campaign' or archived_at is null)
);
create unique index if not exists b_campaigns_one_standing on public.b_campaigns (kind) where kind = 'standing';
create unique index if not exists b_campaigns_live_name on public.b_campaigns (name) where archived_at is null;

create table if not exists public.b_campaign_parts (
  part_type   text not null check (part_type in ('page','step','broadcast','seminar','booking','product','course','room','community')),
  part_id     text not null check (char_length(part_id) between 1 and 80),
  campaign_id uuid not null references public.b_campaigns(id),
  role        text not null default '' check (char_length(role) <= 60),
  updated_at  timestamptz not null default now(),
  updated_by  text not null default 'seed',
  primary key (part_type, part_id)
);
create index if not exists b_campaign_parts_campaign on public.b_campaign_parts (campaign_id);

alter table public.b_campaigns      enable row level security;
alter table public.b_campaign_parts enable row level security;
revoke all on public.b_campaigns, public.b_campaign_parts from anon, authenticated;

insert into public.b_campaigns (name, kind)
select '常設', 'standing'
where not exists (select 1 from public.b_campaigns where kind = 'standing');

insert into public.b_permissions (tool, mode, note) values
  ('list_campaigns',    'auto',    '読む'),
  ('get_blueprint',     'auto',    '読む'),
  ('create_campaign',   'auto',    '企画を作る（部品は動かない）'),
  ('set_part_campaign', 'auto',    '部品の持ち主と役目を変える（部品は動かない）'),
  ('archive_campaign',  'approve', '企画をしまう・戻す')
on conflict (tool) do nothing;

-- 確かめ（この 1 行だけが結果に出る）
select
  (select count(*) from public.b_campaigns)                                        as campaigns,
  (select count(*) from public.b_campaigns where kind = 'standing')                as standing,
  (select count(*) from public.b_campaign_parts)                                   as parts,
  (select mode from public.b_permissions where tool = 'archive_campaign')          as archive_mode,
  (select count(*) from public.b_permissions)                                      as permissions,
  has_table_privilege('anon', 'public.b_campaigns', 'SELECT')
    or has_table_privilege('authenticated', 'public.b_campaign_parts', 'SELECT')   as browser_can_read;
