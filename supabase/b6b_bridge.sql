-- B の便 6b：会員の権利を門番の表（member_entitlement）と 1 つにする。
-- 本番のプロジェクト htzadzpckcpdrmpjvaut の SQL Editor に貼って実行する。何度流しても同じ結果になる。
-- 門番の表・学ぶくんの表には列も方針も足さない。変えるのは b_ の表と見る表だけ。

-- 1. 前提の表があるかを先に確かめる（無ければここで止まり、何も変えない）
do $$
begin
  if to_regclass('public.member_entitlement') is null
     or to_regclass('public.b_products') is null
     or to_regclass('public.b_mn_access') is null
     or not exists (select 1 from public.mn_curriculums where id = '8c169817-2b7d-4f57-b644-80ad6471214a') then
    raise exception 'b6b_prereq_missing：前提の表かしあらぼのカリキュラムが見つかりません。開発部へ返してください';
  end if;
end $$;

-- 2. 権利の印：シアラボNEXT の 4 本に shiarabo_basic（2026-10-08 Naoki 確定）。ほかの 13 本は空のまま
update public.b_products
   set grants = array['shiarabo_basic'], updated_at = now(), updated_by = 'b6b'
 where id in ('next-monthly', 'next-premium', 'next-premium-annual', 'next-premium-ref')
   and grants is distinct from array['shiarabo_basic'];

-- 3. 教材を見られる人：学ぶくんの受講の結びに加えて、門番の表で shiarabo_basic が生きている人は
--    しあらぼのカリキュラムを見られる（会員の権限を 1 か所で管理するため）
create or replace view public.b_mn_access with (security_invoker = true) as
select distinct member_id, curriculum_id from (
  select m.id as member_id, mc.curriculum_id::text as curriculum_id
  from public.member m
  join public.mn_member_curriculums mc
    on mc.active
   and (mc.member_id::text = m.id::text or (m.legacy_shr_id is not null and mc.member_id::text = m.legacy_shr_id::text))
  union all
  select me.member_id, '8c169817-2b7d-4f57-b644-80ad6471214a'
  from public.member_entitlement me
  where me.key = 'shiarabo_basic' and (me.expires_at is null or me.expires_at > now())
) u;

revoke all on public.b_mn_access from anon, authenticated;

-- 4. AI の道具を 2 つ足す（どちらも読むだけなので自動）
insert into public.b_permissions (tool, mode, note) values
  ('get_meetings', 'auto', '読む'),
  ('list_tables',  'auto', '読む（欄の名前と行数だけ）')
on conflict (tool) do nothing;

-- 確かめ（この 1 行だけが結果に出る）
select
  (select count(*) from public.b_products where 'shiarabo_basic' = any(grants))            as products_with_grant,
  (select count(*) from public.b_products where cardinality(grants) > 0)                    as products_with_any_grant,
  (select count(*) from public.b_mn_access)                                                 as access,
  (select count(distinct member_id) from public.member_entitlement
     where key = 'shiarabo_basic' and (expires_at is null or expires_at > now()))           as gate_members,
  (select count(*) from public.b_permissions)                                               as permissions,
  has_table_privilege('anon', 'public.b_mn_access', 'SELECT')
    or has_table_privilege('authenticated', 'public.b_mn_access', 'SELECT')                as browser_can_read;
