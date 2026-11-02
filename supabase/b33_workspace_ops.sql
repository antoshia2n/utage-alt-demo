-- 場所（ワークスペース）の後始末（2026-11-02・Naoki「OK」14:58）
-- 新しい場所を作るときの 3 つの書き込み（場所・持ち主・招待リンク）を関数 1 本にまとめる。
-- 関数の中は 1 つの取引なので、途中で失敗したら 3 つとも書かない（持ち主のいない場所が残らない）。
-- 呼ぶのは Worker（秘密の鍵）だけ。ブラウザ（anon・authenticated）からは呼べない。
-- 何回流しても同じ結果になる。既にある表と行には触らない。
-- 戻し方：drop function public.b_invite_create_with_ws(text, text, uuid, text, text, text, text, timestamptz, integer, timestamptz);

create or replace function public.b_invite_create_with_ws(
  p_ws_name text, p_owner_uid text, p_owner_member uuid, p_created_by text,
  p_token text, p_name text, p_key text, p_grant_until timestamptz, p_max_uses integer, p_link_until timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare v_ws text; v_inv public.b_invites;
begin
  if p_owner_uid is null or p_owner_uid = '' then raise exception 'owner_not_bound'; end if;
  insert into public.ws_workspaces (name, created_by) values (p_ws_name, p_created_by) returning id into v_ws;
  insert into public.ws_members (workspace_id, firebase_uid, member_id, role) values (v_ws, p_owner_uid, p_owner_member, 'owner');
  insert into public.b_invites (token, name, key, grant_until, max_uses, link_until, created_by, workspace_id)
    values (p_token, p_name, p_key, p_grant_until, p_max_uses, p_link_until, p_created_by, v_ws)
    returning * into v_inv;
  return jsonb_build_object('id', v_inv.id, 'name', v_inv.name, 'token', v_inv.token, 'workspace_id', v_ws);
end $$;

revoke all on function public.b_invite_create_with_ws(text, text, uuid, text, text, text, text, timestamptz, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.b_invite_create_with_ws(text, text, uuid, text, text, text, text, timestamptz, integer, timestamptz) to service_role;
