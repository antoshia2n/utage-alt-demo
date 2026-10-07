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

## 便 2 で足したもの

- 添削ルーム（1 対 1）：生徒は `/app` の「添削ルーム」から文章と画像（4 枚まで・1 枚 5MB まで）を出す。シアニンは `/admin` の「添削ルーム」で、未返信のある部屋が上に来る一覧から開き、原文・添削後・コメントの 3 欄で返す
- やりとりは新しい表を作らず `events` に積む（`correction_submitted`・`correction_returned`・`room_read`）。未返信・既読は記録から計算する
- 新着の知らせ：タブの数字（30 秒ごとに見る）と、ホーム画面に追加したアプリのアイコンの数字。届かない人へのメール 1 通は便 3（メール）で足す
- 生徒同士の場：添削ルームの下にリンクの置き場。設定 `COMMUNITY_URL` が無ければ「準備中」
- MCP：`list_rooms`・`get_room`・`return_correction`
- 画像は R2（`IMAGES`）。名前を書かないので、初回の組み立てで Cloudflare が自動で作る。本人とシアニンだけが読める

## 便 3 で足したもの

- 決済（UnivaPay のテスト）：登録の直後と `/app` に「入会する」。UnivaPay のウィジェットが定期課金（月 3,000 円・テスト）を作り、サイトは秘密の鍵で UnivaPay に聞き直してから `subscription_started` を積む
- UnivaPay の知らせ：`POST /api/webhooks/univapay`。合言葉は `MCP_SECRET` から作り、シアニン用の画面の「決済とメールの設定」に出す。2 回目以降の入金・失敗・解約を積む。受け取りは全部 `inbound_log` に残す
- 権利：会員かどうかは出来事から計算する（始まった・入金 → 会員、失敗・解約・停止 → 会員でない）
- メール（Cloudflare Email Service）：送信元 `demo@shia2n.jp`。デモの間は送り先をシアニン用の画面に入れるメール（と + 付きの別名）だけに限る。全メールの末尾に配信停止のリンク
- 定時の処理（1 時間ごと）：添削が返って 1 時間読まれていない人へメールを 1 通
- MCP：`send_email`
- 秘密の値の追加：`UNIVAPAY_APP_TOKEN`・`UNIVAPAY_APP_SECRET`（Cloudflare の画面）

## 置き場

- Cloudflare Workers（静的ページ＋API）
- 設定の値は Cloudflare の画面の Secret に 4 つ：`SUPABASE_URL`・`SUPABASE_PUBLISHABLE_KEY`・`SUPABASE_SECRET_KEY`・`MCP_SECRET`（足りないものは `/api/health` が名前で返す）
- Supabase：`supabase/schema.sql` を SQL Editor で 1 回流す（何回流しても同じ）。表はすべて RLS 有効でブラウザから読めない

## 調べる手段

- `/api/health`：足りない設定の名前と、データベースに届くか、画像の置き場があるか（`images`）を返す
- `events`：いつ・誰に・何が起きたかが 1 件ずつ残る
- `inbound_log`：外からの呼び出し（登録・MCP）の中身と返事
- 0 件は `ok: true, count: 0`、失敗は `ok: false`（MCP では `isError: true`）
