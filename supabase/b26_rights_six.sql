-- b26（2026-10-29 Naoki「OK」）：権利を 6 つに。NEXT の 2 つとモニターは、しあらぼ（shiarabo_basic）と同じものを開く。
-- しあらぼが開いているもの（member_access の行）を、3 つの新しい名前にも同じだけ写す。何度流しても同じ結果。
-- ゲスト（guest）は写さない：見えるのは、会員サイトのカリキュラムで選んだものだけ。
insert into public.member_access (entitlement_key, target)
select k.key, a.target
from public.member_access a
cross join (values ('shiarabo_next_premium'), ('shiarabo_next_standard'), ('shiarabo_monitor')) as k(key)
where a.entitlement_key = 'shiarabo_basic'
  and not exists (
    select 1 from public.member_access b where b.entitlement_key = k.key and b.target = a.target
  );

-- 確かめ：4 つの名前が同じ数だけ開いていれば正しい
select entitlement_key, count(*) as opens
from public.member_access
where entitlement_key in ('shiarabo_basic', 'shiarabo_next_premium', 'shiarabo_next_standard', 'shiarabo_monitor')
group by entitlement_key
order by entitlement_key;
