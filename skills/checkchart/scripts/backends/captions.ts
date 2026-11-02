export const captions = {
  en: {
    ruleSeparator: " or ",
    legend: "Legend",
    untrusted: "Untrusted content",
    breaks: (rules: string) => `Breaks ${rules}`,
    bugPath: (rules: string) => `Path to the ${rules} bug`,
    branch: (number: number) => `Branch ${number}`,
    parallel: "par",
    undeclared: "undeclared participant",
    undeclaredComment: "Undeclared participant",
  },
  ja: {
    ruleSeparator: "、",
    legend: "凡例",
    untrusted: "信頼しない範囲",
    breaks: (rules: string) => `規則違反：${rules}`,
    bugPath: (rules: string) => `違反箇所への経路：${rules}`,
    branch: (number: number) => `分岐 ${number}`,
    parallel: "並列",
    undeclared: "未宣言の参加者",
    undeclaredComment: "未宣言の参加者",
  },
};
