// マーケくんの生徒の画面は Supabase でログインする。共通の外枠（shia2n-core）の Firebase の部分は使わないので、空の代わりを入れる。
// 誰で入っているか・開けるアプリは、mountAppShell の source で差し替える（public/js/app-shell-src.js）
export const auth = { currentUser: null };
export const db = null;
export function signOut() { return Promise.resolve(); }
export function onAuthStateChanged() { return () => {}; }
const no = () => { throw new Error("firestore_not_used"); };
export const doc = no, getDoc = no, collection = no, query = no, where = no, getDocs = no;
