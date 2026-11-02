export const title = "acme の注文処理：どこから何が届くか";
export const reader = "acme の注文処理を実装する開発者";
export const question = "注文と支払いの結果は、どこから届き、誰が受け取るか";
export const product = "acme";
export const colors = { "利用者": "tan", "自社サーバー": "teal", "外部サービス": "orange" };
export const label = {
  shop: "自社サーバー", pay: "外部の決済サービス",
  user: "利用者", web: "acme Web API\n注文を受け付ける", order: "注文サービス\n在庫と金額を確定",
  db: "注文 DB", payment: "決済サービス",
};
export const group = { user: "利用者", web: "自社サーバー", order: "自社サーバー", db: "自社サーバー", payment: "外部サービス" };
const words = {
  submit: "注文を送る", register: "注文を登録する", save: "注文を保存する",
  charge: "支払いを依頼する", notify: "支払い結果を通知する（Webhook）",
};
export const step = (c) => words[c.id];
