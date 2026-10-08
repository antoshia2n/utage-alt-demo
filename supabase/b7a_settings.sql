-- B の便 7a：サイト全体の設定の表 b_settings（いまはオプチャの招待リンク 1 行だけ）と、AI の道具 2 つの権限。
-- 本番のプロジェクト（htzadzpckcpdrmpjvaut）に 1 回流す。何回流しても同じ結果になる。既にある表には触らない。
-- 作った回に anon・authenticated の許可を外す。読み書きは Worker が秘密の鍵で行う。
-- 戻し方：drop table public.b_settings; delete from public.b_permissions where tool in ('get_community_link','set_community_link');

create table if not exists public.b_settings (
  key         text primary key check (key ~ '^[a-z_]{2,40}$'),
  value       text not null default '' check (char_length(value) <= 500),
  updated_at  timestamptz not null default now(),
  updated_by  text not null default 'seed'
);

alter table public.b_settings enable row level security;
revoke all on public.b_settings from anon, authenticated;

insert into public.b_permissions (tool, mode, note) values
  ('get_community_link', 'auto',    '読む'),
  ('set_community_link', 'approve', 'オプチャの入口を差し替える')
on conflict (tool) do nothing;

-- 確かめ（この 1 行だけが結果に出る）
select
  (select count(*) from public.b_settings)                                                 as settings,
  (select count(*) from public.b_permissions where tool like '%community_link')            as community_tools,
  (select mode from public.b_permissions where tool = 'set_community_link')                as set_mode,
  (select count(*) from public.b_permissions)                                              as permissions,
  has_table_privilege('anon', 'public.b_settings', 'SELECT')
    or has_table_privilege('authenticated', 'public.b_settings', 'SELECT')                as browser_can_read;
