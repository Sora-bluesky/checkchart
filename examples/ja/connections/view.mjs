export const locale = "ja";
export const reader = "保守する開発者";
export const question = "データはどこから acme に入り、どこに残るか？";
export const title = "acme 構成図：接続";
export const product = "acme";
export const colors = { 利用者: "tan", アプリ: "teal", 保存先: "purple", 外部: "orange" };
export const label = (id, kind) => kind === "zone"
  ? { machine: "手元のマシン", web: "外部のサービス" }[id]
  : { user: "利用者", app: "acme", db: "保存データ", api: "外部の API" }[id];
export const group = { user: "利用者", app: "アプリ", db: "保存先", api: "外部" };
export const step = (connection) => connection.from === "api" ? "結果を送る"
  : connection.to === "db" ? "データを保存する" : "依頼を送る";
