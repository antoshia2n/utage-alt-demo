-- 2026-11-06 担当者（Naoki OK）：担当者ごとに Google カレンダーをつなぎ、予約メニューごとに担当者を選ぶ
-- b_staff … 担当者。script_url／script_secret はその人の Google に置いた Apps Script（ウェブアプリ）。画面と AI には返さない
--   ical_fallback … 空き時間をスクリプトから読めないとき、今までの iCal の非公開 URL（設定の calendar_ics など）で読む（Naoki だけ）
-- b_booking_types.staff_id … その予約メニューの担当者。空き時間はこの人の予定と、この人の予約だけを避ける
create table if not exists b_staff (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  email text not null default '' check (char_length(email) <= 200),
  script_url text not null default '',
  script_secret text not null default '',
  ical_fallback boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text,
  archived_at timestamptz
);
alter table b_staff enable row level security;
alter table b_booking_types add column if not exists staff_id uuid references b_staff(id);

-- 1 人目：今つないでいる Naoki のカレンダーを引き継ぐ。今の予約メニューの担当者は Naoki
do $$
declare sid uuid; u text; s text; who text;
begin
  if not exists (select 1 from b_staff) then
    select value, updated_by into u, who from b_settings where key = 'gcal_script_url';
    select value into s from b_settings where key = 'gcal_script_secret';
    insert into b_staff (name, email, script_url, script_secret, ical_fallback, updated_by)
      values ('シアニン', coalesce(who, ''), coalesce(u, ''), coalesce(s, ''), true, 'migration') returning id into sid;
    update b_booking_types set staff_id = sid where staff_id is null;
  end if;
end $$;
