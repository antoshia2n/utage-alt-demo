-- 便 T1（2026-11-07 Naoki OK 23:05）：X収益化ロードマップ動画企画のための LINE のステップ配信。
--   きっかけに line_linked（LINE と結ばれた）、動きに send_line（LINE を送る）を足す。表は増やさない。
-- 戻し方（line_linked・send_line の行を先に消してから）：
--   alter table public.b_steps drop constraint if exists b_steps_trigger_check;
--   alter table public.b_steps add constraint b_steps_trigger_check
--     check (trigger in ('registered','purchase','clicked','lesson_viewed','correction_submitted','login','label_added','form_submitted','page_viewed','page_clicked','moved'));
--   alter table public.b_steps drop constraint if exists b_steps_action_check;
--   alter table public.b_steps add constraint b_steps_action_check check (action in ('send_email','notify_admin','add_label','move_to','set_field'));

alter table public.b_steps drop constraint if exists b_steps_trigger_check;
alter table public.b_steps add constraint b_steps_trigger_check
  check (trigger in ('registered','purchase','clicked','lesson_viewed','correction_submitted','login','label_added','form_submitted','page_viewed','page_clicked','moved','line_linked'));

alter table public.b_steps drop constraint if exists b_steps_action_check;
alter table public.b_steps add constraint b_steps_action_check
  check (action in ('send_email','notify_admin','add_label','move_to','set_field','send_line'));

-- 確かめ
select
  (select pg_get_constraintdef(oid) like '%line_linked%' from pg_constraint where conname = 'b_steps_trigger_check' and conrelid = 'public.b_steps'::regclass) as line_trigger,
  (select pg_get_constraintdef(oid) like '%send_line%' from pg_constraint where conname = 'b_steps_action_check' and conrelid = 'public.b_steps'::regclass) as line_action;
