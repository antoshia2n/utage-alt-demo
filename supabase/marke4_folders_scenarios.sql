-- マーケくん便 4：データはフォルダ、まとまりはシナリオ（旧企画）（2026-10-25 Naoki「OK」）。
-- 本番のプロジェクト（htzadzpckcpdrmpjvaut）に 1 回流す。何回流しても同じ結果になる。
-- 変えるもの：
--   1. b_campaign_parts の主キーを「部品」から「シナリオ × 部品」へ（1 つの部品を何本のシナリオにも入れられる）。今ある行はそのまま
--   2. フォルダの表 b_folders（種類ごとの 1 段の名前）と b_folder_items（データ 1 つにフォルダ 1 つ）を足す
-- 戻し方：drop table public.b_folder_items; drop table public.b_folders;
--         （1 部品が 2 本以上のシナリオに入っている行を 1 本に減らしてから）
--         alter table public.b_campaign_parts drop constraint b_campaign_parts_pkey;
--         alter table public.b_campaign_parts add primary key (part_type, part_id);

-- 1. シナリオ × 部品
do $$
begin
  if exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.b_campaign_parts'::regclass and c.contype = 'p'
      and array_length(c.conkey, 1) = 2
  ) then
    alter table public.b_campaign_parts drop constraint b_campaign_parts_pkey;
    alter table public.b_campaign_parts add constraint b_campaign_parts_pkey primary key (campaign_id, part_type, part_id);
  end if;
end $$;
create index if not exists b_campaign_parts_part on public.b_campaign_parts (part_type, part_id);

-- 2. フォルダ
create table if not exists public.b_folders (
  id          uuid primary key default gen_random_uuid(),
  part_type   text not null check (part_type in ('page','step','broadcast','seminar','booking','product','course','room','community','form')),
  name        text not null check (char_length(name) between 1 and 40),
  sort        integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  text not null default 'seed'
);
create unique index if not exists b_folders_type_name on public.b_folders (part_type, name);

create table if not exists public.b_folder_items (
  part_type   text not null check (part_type in ('page','step','broadcast','seminar','booking','product','course','room','community','form')),
  part_id     text not null check (char_length(part_id) between 1 and 80),
  folder_id   uuid not null references public.b_folders(id) on delete cascade,
  updated_at  timestamptz not null default now(),
  updated_by  text not null default 'seed',
  primary key (part_type, part_id)
);
create index if not exists b_folder_items_folder on public.b_folder_items (folder_id);

alter table public.b_folders      enable row level security;
alter table public.b_folder_items enable row level security;
revoke all on public.b_folders, public.b_folder_items from anon, authenticated;

-- 確かめ（この 1 行だけが結果に出る）。scenario_key が 3 列・folders と items が true・browser_can_read が false なら正しい
select
  (select array_length(conkey, 1) from pg_constraint where conrelid = 'public.b_campaign_parts'::regclass and contype = 'p') as scenario_key,
  to_regclass('public.b_folders') is not null       as folders,
  to_regclass('public.b_folder_items') is not null  as items,
  (select count(*) from public.b_campaign_parts)    as scenario_rows,
  has_table_privilege('anon', 'public.b_folders', 'SELECT')
    or has_table_privilege('authenticated', 'public.b_folder_items', 'SELECT') as browser_can_read;
