// 便 12e：試しの決済（UnivaPay の mode test）を見分ける 1 か所。
// 試しの購入は出来事の記録には残すが、ラベル（購入者・買った:）・売れた数・配信の宛先の「買った」・経路の「買った人」には数えない。
// 会員と権利の側（src/sell.js の entitlementOf・便 12d）と同じ見分け。mode の無い古い記録は本番として数える。
export function isTestPurchase(payload) {
  return !!payload && payload.mode === "test";
}
