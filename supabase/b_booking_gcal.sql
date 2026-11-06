-- 2026-11-06 予約の便⑤：予約を Google カレンダーに書き込む（つなぐ先は表 settings の gcal_script_url／gcal_script_secret）
-- gcal_write  … このメニューの予約を Google カレンダーに入れるか
-- gcal_invite … 予約した人を予定のゲストにして、Google から招待を送るか
alter table b_booking_types
  add column if not exists gcal_write boolean not null default true,
  add column if not exists gcal_invite boolean not null default true;
