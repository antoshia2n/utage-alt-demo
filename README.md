# utage-alt-demo

UTAGE の代わりになるサイト兼アプリ（PWA）のデモ。架空のデータだけで動く。
正本の依頼書：Notion の Tasks「UTAGE の代わりになるサイト兼アプリのデモを作る（架空のデータだけ）」

## 便 1 で入っているもの

- 顧客の台帳（1 人 1 件）と出来事の記録。段階は記録から計算する（`customer_summary`）
- 入口は 1 つ：シアニン用の画面（`/api/admin/*`）と AI（`/mcp`）が同じ処理を呼ぶ
- 公開の面：LP `/`・無料登録 `/register`・ログイン `/login`・固定ページ `/legal/*`
- ログインの面：`/app`（教材・お知らせ・添削ルームの入口）。ログイン直後に 1 回だけ「ホーム画面に追加」の案内
- シアニン用の画面：`/admin`（メールのリンク＋認証アプリの 6 桁）
- 流入元：`?src=x|note|youtube` を登録時に台帳の 1 列に残す
- note のメンバー：手で付ける列（シアニン用の画面のチェック）
- MCP：`find_person`・`get_timeline`・`stats`

## 置き場

- Cloudflare Workers（静的ページ＋API）
- 設定の値は Cloudflare の画面の Secret に 4 つ：`SUPABASE_URL`・`SUPABASE_PUBLISHABLE_KEY`・`SUPABASE_SECRET_KEY`・`MCP_SECRET`（足りないものは `/api/health` が名前で返す）
- Supabase：`supabase/schema.sql` を SQL Editor で 1 回流す（何回流しても同じ）。表はすべて RLS 有効でブラウザから読めない

## 調べる手段

- `/api/health`：足りない設定の名前と、データベースに届くかを返す
- `events`：いつ・誰に・何が起きたかが 1 件ずつ残る
- `inbound_log`：外からの呼び出し（登録・MCP）の中身と返事
- 0 件は `ok: true, count: 0`、失敗は `ok: false`（MCP では `isError: true`）
