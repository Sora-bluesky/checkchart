export const title = "acme 処理の構成";
export const reader = "A maintainer";
export const question = "Which worker receives each request?";
export const label = {
  client: "acme 画面領域",
  workers: "acme 処理の担当と終了条件を示すワーカー領域",
  nested: "acme 端末領域",
  observer: "acme 外側から処理結果の通知を受け取る観測領域",
  entry: "開始点",
  screen: "画面処理",
  helper: "補助処理",
  command: "操作窓口",
  coordinator: "入力を各担当へ振り分ける中央の処理",
  first: "第一の処理",
  second: "第二の処理",
  third: "第三の処理",
  adapter: "中継処理",
  terminal: "端末処理",
  listener: "監視処理",
};
export const step = () => "処理の開始を要求して結果を受け取る\n処理の終了時には通知を返して待機する";
