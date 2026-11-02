export const title = "acme の入出力と配信先";
export const reader = "A maintainer";
export const question = "How does acme exchange input and output and distribute requests?";
export const label = {
  input: "信頼しない入出力の領域", upper: "端末の接続先", lower: "シェルとエージェント",
  core: "中央の処理", first: "短い担当", second: "保存先", third: "外部の利用者",
  fourth: "旧版の acme core\n移行が完了するまで",
};
export const step = (edge) => edge.id === "down" ? "キー入力" : edge.id === "up" ? "画面出力" : "処理を要求する";
