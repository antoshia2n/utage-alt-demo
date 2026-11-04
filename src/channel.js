// 生徒の画面（/app）を 2 つの版で出し分ける（2026-11-04 開発部・Naoki 承認）
//   シアニン用：public/ の最新。結合したらすぐ変わる。印（クッキー lab_ch=next）がある人だけ
//   生徒用　　：public/stable/ の写し。tools/release.mjs で写して結合したときだけ変わる
// 印は /app?ch=next で付き、/app?ch=stable で外れる。印は見た目の版を選ぶだけで、見られる中身（権限）は変えない
// 表と API は両方の版で共通。だから API と表は「足すだけ」にする（消す・名前を変えると生徒用が壊れる）

export const CH_COOKIE = "lab_ch";

/** /app への要求なら { use, set } を返す。それ以外は null */
export function appChannel(path, search, cookie) {
  if (path !== "/app" && path !== "/app.html") return null;
  const q = new URLSearchParams(search || "").get("ch");
  if (q === "next" || q === "stable") return { use: q, set: q };
  const has = new RegExp(`(?:^|;\\s*)${CH_COOKIE}=next(?:;|$)`).test(cookie || "");
  return { use: has ? "next" : "stable", set: null };
}

export async function serveApp(request, env, url, ch) {
  if (ch.set) {
    const cookie = ch.set === "next"
      ? `${CH_COOKIE}=next; Path=/; Max-Age=31536000; Secure; SameSite=Lax`
      : `${CH_COOKIE}=; Path=/; Max-Age=0; Secure; SameSite=Lax`;
    return new Response(null, { status: 302, headers: { location: "/app", "set-cookie": cookie, "cache-control": "no-store" } });
  }
  let res = null;
  let used = "next";
  if (ch.use === "stable") {
    const r = await env.ASSETS.fetch(new Request(new URL("/stable/app", url), request));
    if (r.ok) { res = r; used = "stable"; }
  }
  // 写しがまだ無いときは最新を出す（止めない）
  if (!res) res = await env.ASSETS.fetch(request);
  const out = new Response(res.body, res);
  out.headers.set("cache-control", "no-cache");
  out.headers.set("x-lab-channel", used);
  return out;
}
