export const locale = "ja";
export const title = "acme シーケンス図：応答の欠落";
export const reader = "応答を確認する開発者";
export const question = "要求への応答は返るか？";
export const product = "acme";
export const label = { client: "利用者", api: "acme API" };
export const step = (message) => message.type === "call" ? "要求を送る" : "通知を送る";
