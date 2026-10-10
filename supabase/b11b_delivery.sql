-- B の便 11b：配信の強化（2026-10-10 Naoki「進めて」）。新しい表は作らない。
-- 本番のプロジェクト（htzadzpckcpdrmpjvaut）に 1 回流す。何回流しても同じ結果になる。既にある行は変えない。
--   コネクタ（b_steps）のきっかけに moved（ほかの自動の動きから移された）を足す
--   アクションに move_to（別の自動の動きへ移す）・set_field（人の項目に値を書く）を足す
--   開いたかは出来事 email_opened に積むので、表の変更は要らない
-- 戻し方（先に trigger が moved の行と、action が move_to・set_field の行を消しておく）：
--   alter table public.b_steps drop constraint if exists b_steps_trigger_check;
--   alter table public.b_steps add constraint b_steps_trigger_check
--     check (trigger in ('registered','purchase','clicked','lesson_viewed','correction_submitted','login','label_added','form_submitted','page_viewed','page_clicked'));
--   alter table public.b_steps drop constraint if exists b_steps_action_check;
--   alter table public.b_steps add constraint b_steps_action_check check (action in ('send_email','notify_admin','add_label'));

alter table public.b_steps drop constraint if exists b_steps_trigger_check;
alter table public.b_steps add constraint b_steps_trigger_check
  check (trigger in ('registered','purchase','clicked','lesson_viewed','correction_submitted','login','label_added','form_submitted','page_viewed','page_clicked','moved'));

alter table public.b_steps drop constraint if exists b_steps_action_check;
alter table public.b_steps add constraint b_steps_action_check
  check (action in ('send_email','notify_admin','add_label','move_to','set_field'));

-- 確かめ（この 1 行だけが結果に出る）
select
  (select pg_get_constraintdef(oid) like '%moved%' from pg_constraint
     where conname = 'b_steps_trigger_check' and conrelid = 'public.b_steps'::regclass)   as moved_trigger,
  (select pg_get_constraintdef(oid) like '%set_field%' and pg_get_constraintdef(oid) like '%move_to%' from pg_constraint
     where conname = 'b_steps_action_check' and conrelid = 'public.b_steps'::regclass)    as new_actions,
  (select count(*) from public.b_steps)                                                    as steps,
  has_table_privilege('anon', 'public.b_steps', 'SELECT')
    or has_table_privilege('authenticated', 'public.b_steps', 'SELECT')                    as browser_can_read;
