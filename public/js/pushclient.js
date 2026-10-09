// 便 8g-1：生徒の画面（シアラボ）のスマホの通知。シアニン用の画面（admin.js）と同じ決まりで動かす。
//   iPhone（Safari）の決まり（Apple・WebKit の公式の説明）：
//     ・iOS / iPadOS 16.4 以上で、ホーム画面に追加した Web アプリから開いたときだけ購読できる（manifest の display が standalone）
//     ・許可の確認は、ボタンを押した直後の動きの中で頼む。押したあと通信を待ってから頼むと確認が出ない（8f-3 で実際に当たった）
//   そのため鍵と画面の裏の仕組み（sw.js）は開いたときに先に用意し、押したら最初に subscribe を呼ぶ。
import { api, esc } from "/js/common.js";

export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const standalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
export const pushDevice = () => {
  const ua = navigator.userAgent;
  const os = isIos() ? "iPhone" : /android/i.test(ua) ? "Android" : /mac os/i.test(ua) ? "Mac" : /windows/i.test(ua) ? "Windows" : "端末";
  const br = /edg[/]/i.test(ua) ? "Edge" : /crios|chrome[/]/i.test(ua) ? "Chrome" : /fxios|firefox[/]/i.test(ua) ? "Firefox" : /safari/i.test(ua) ? "Safari" : "";
  return `${os}${br ? " " + br : ""}${standalone() ? "・ホーム画面" : ""}`;
};
const keyBytes = (b64) => { const t = b64.replace(/-/g, "+").replace(/_/g, "/"); const s = atob(t + "===".slice((t.length + 3) % 4)); return Uint8Array.from(s, (c) => c.charCodeAt(0)); };
async function pushSub() {
  const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((_, no) => setTimeout(() => no(new Error("sw_not_ready")), 5000))]);
  return { reg, sub: await reg.pushManager.getSubscription() };
}

// el：{ box, status, on, off }（要素）。token：ログインの印
export function setupStudentPush(el, token) {
  let ready = null;
  const say = (html) => { el.status.innerHTML = html; };
  const showButtons = (on, off) => { el.on.classList.toggle("hidden", !on); el.off.classList.toggle("hidden", !off); };

  async function load() {
    // iPhone の Safari で開いているとき（ホーム画面からではないとき）は、押せないので案内だけ
    if (isIos() && !standalone()) {
      showButtons(false, false);
      say("iPhone では、共有ボタン →「ホーム画面に追加」でシアラボを足し、<b>ホーム画面のシアラボから開く</b>と受け取れます（iOS 16.4 以上）");
      return;
    }
    if (!pushSupported()) { showButtons(false, false); say("この端末のブラウザは通知に対応していません"); return; }
    const r = await api("/api/me/push", { token });
    if (!r.ok) { showButtons(false, false); say(r.error === "demo_store" ? "通知は準備中です" : "読めませんでした（" + esc(r.error || r.status) + "）"); return; }
    const ps = await pushSub().catch(() => null);
    if (!ps) { showButtons(false, false); say("この端末では通知の準備ができませんでした（画面を開き直すと直ることがあります）"); return; }
    let sub = ps.sub;
    // 前の鍵で購読したままなら先に外す（違う鍵のままでは新しく購読できない）
    if (sub && sub.options && sub.options.applicationServerKey && new Uint8Array(sub.options.applicationServerKey).join() !== keyBytes(r.public_key).join()) {
      await sub.unsubscribe().catch(() => {}); sub = null;
    }
    ready = { reg: ps.reg, key: keyBytes(r.public_key) };
    const on = !!sub && r.devices.some((d) => sub.endpoint.endsWith(d.endpoint_tail));
    if (on) { showButtons(false, true); say("この端末で受け取っています（シアニンからのメッセージ・添削が返ってきたとき）"); return; }
    showButtons(true, false);
    say(Notification.permission === "denied"
      ? "この端末は通知を止めています（端末の設定 → 通知 → シアラボ で許可にすると押せます）"
      : "シアニンからのメッセージや、添削が返ってきたことをスマホに知らせます");
  }

  el.on.addEventListener("click", () => {
    if (!ready) { say("準備中です。数秒おいて、もう一度押してください"); load(); return; }
    // 押した直後にここを呼ぶ（この前に await を置かない）
    let p;
    try { p = ready.reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: ready.key }); }
    catch (e) { p = Promise.reject(e); }
    say("許可の確認を待っています…");
    p.then(async (sub) => {
      const j = sub.toJSON();
      const res = await api("/api/me/push", { method: "POST", token, body: { endpoint: j.endpoint, keys: j.keys, device: pushDevice() } });
      if (!res.ok) { say("登録できませんでした（" + esc(res.error || res.status) + "）"); return; }
      await load();
    }).catch((e) => {
      say(Notification.permission === "denied"
        ? "許可されなかったので受け取れません（端末の設定 → 通知 → シアラボ で許可にすると押せます）"
        : "受け取りの登録ができませんでした（" + esc(String(e && (e.name || e.message) || e)) + "）");
    });
  });

  el.off.addEventListener("click", async () => {
    const ps = await pushSub().catch(() => null);
    const sub = ps && ps.sub;
    if (sub) {
      await api("/api/me/push", { method: "DELETE", token, body: { endpoint: sub.endpoint } });
      await sub.unsubscribe().catch(() => {});
    }
    await load();
  });

  el.box.classList.remove("hidden");
  load().catch((e) => say("読めませんでした（" + esc(e.message) + "）"));
}
