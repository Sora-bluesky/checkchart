type FontWeight = 400 | 700;
type TextWeight = FontWeight | "first";
export type TextBlock = { lines: string[]; weights: FontWeight[]; width: number; height: number; fontSize: number; lineHeight: number };
export const fontSize = { node: 16, label: 15, header: 15, legend: 14, title: 22 } as const;
export const widthBudget = 1100;

// BIZ UDPGothic advance widths in em. Wide Latin letters need their own
// estimates; an average Latin width can let WWW or MMM escape a padded box.
const upperWidths = [0.76, 0.77, 0.8, 0.84, 0.7, 0.66, 0.84, 0.82, 0.42, 0.54, 0.75, 0.6, 0.98, 0.82, 0.86, 0.74, 0.89, 0.76, 0.71, 0.7, 0.84, 0.74, 0.98, 0.8, 0.72, 0.75];
const lowerWidths = [0.65, 0.71, 0.64, 0.71, 0.69, 0.5, 0.67, 0.7, 0.32, 0.38, 0.63, 0.33, 0.94, 0.7, 0.68, 0.71, 0.71, 0.45, 0.59, 0.47, 0.7, 0.58, 0.88, 0.6, 0.61, 0.58];
// Bold has distinct advances, especially r, l and wide capitals. Measured from
// the installed BIZ UDPGothic Bold face, with the same rounding margin below.
const boldUpperWidths = [0.78, 0.77, 0.81, 0.85, 0.7, 0.67, 0.86, 0.84, 0.44, 0.56, 0.76, 0.61, 1, 0.84, 0.88, 0.76, 0.9, 0.76, 0.73, 0.7, 0.86, 0.76, 1, 0.82, 0.74, 0.75];
const boldLowerWidths = [0.66, 0.73, 0.64, 0.73, 0.69, 0.51, 0.67, 0.72, 0.32, 0.4, 0.66, 0.36, 0.96, 0.72, 0.7, 0.73, 0.73, 0.49, 0.59, 0.49, 0.72, 0.6, 0.9, 0.62, 0.64, 0.58];
const punctuation: Record<string, number> = {
  " ": 0.34, "!": 0.33, '"': 0.47, "#": 0.92, "$": 0.8, "%": 1, "&": 0.89, "'": 0.29,
  "(": 0.49, ")": 0.49, "*": 0.5, "+": 0.84, ",": 0.31, "-": 0.48, ".": 0.31, "/": 0.5,
  ":": 0.31, ";": 0.31, "<": 0.84, "=": 0.84, ">": 0.84, "?": 0.78, "@": 0.98, "[": 0.5,
  "\\": 0.8, "]": 0.5, "^": 0.5, "_": 0.31, "`": 0.5, "{": 0.52, "|": 0.44, "}": 0.52, "~": 0.5,
  "・": 0.5, "、": 0.6, "。": 0.6, "：": 0.5, "（": 0.5, "）": 0.5, "「": 0.5, "」": 0.5,
};
const boldPunctuation: Record<string, number> = {
  "!": 0.38, '"': 0.52, "#": 0.94, "&": 0.92, "'": 0.32, "(": 0.51, ")": 0.51,
  ",": 0.34, ".": 0.34, ":": 0.34, ";": 0.34, "?": 0.8, "[": 0.55, "]": 0.55, "{": 0.54, "}": 0.54,
};

export function textWidth(text: string, size = fontSize.node, weight: FontWeight = 400): number {
  let em = 0;
  for (const char of text) {
    if (/[\p{Mark}\p{Cf}]/u.test(char)) continue;
    const n = char.codePointAt(0) ?? 0;
    em += (weight === 700 ? boldPunctuation[char] : undefined) ?? punctuation[char] ?? (n >= 65 && n <= 90 ? (weight === 700 ? boldUpperWidths : upperWidths)[n - 65]
      : n >= 97 && n <= 122 ? (weight === 700 ? boldLowerWidths : lowerWidths)[n - 97] : /[0-9]/.test(char) ? char === "1" ? 0.63 : 0.76
      : /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(char) ? 0.98 : 1);
  }
  // Include a small allowance for glyph overhangs and renderer rounding.
  return em * size * 1.03;
}

export function wrapText(text: string, maxWidth: number, size = fontSize.node, weight: TextWeight = 400): string[] {
  return text.split(/\r\n|\r|\n/).flatMap((line, index) => wrapLine(line, maxWidth, size, weight === "first" && index ? 400 : weight));
}

const preferredBreak = /[ 、。・：，）]/u;
const forbiddenStart = /[\p{Pe}\p{Pf}\p{Mark}ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶㇰ-ㇿー、。，．・：；？！,.!?;:]/u;
type WrapPlan = { cost: number[]; end: number; from: number; to: number };

function wrapLine(line: string, maxWidth: number, fontSize: number, weight: TextWeight): string[] {
  const chars = [...line.trim()];
  if (!chars.length) return [""];
  const widths = [0];
  const firstWidths = [0];
  for (const char of chars) {
    widths.push(widths.at(-1)! + textWidth(char, fontSize, weight === 700 ? 700 : 400));
    firstWidths.push(firstWidths.at(-1)! + textWidth(char, fontSize, 700));
  }
  const breaks = [0];
  for (let i = 1; i < chars.length; i++) {
    let next = i;
    while (next < chars.length && /\s/u.test(chars[next])) next++;
    if (forbiddenStart.test(chars[next] ?? "")) continue;
    if (preferredBreak.test(chars[i - 1]) || chars[i] === "（") breaks.push(i);
  }
  breaks.push(chars.length);
  const plans = new Map<number, WrapPlan>();
  plans.set(breaks.length - 1, { cost: [0, 0, 0], end: breaks.length, from: chars.length, to: chars.length });
  for (let i = breaks.length - 2; i >= 0; i--) {
    let from = breaks[i];
    while (from < chars.length && /\s/u.test(chars[from])) from++;
    for (let j = breaks.length - 1; j > i; j--) {
      const tail = plans.get(j);
      if (!tail) continue;
      let to = breaks[j];
      while (to > from && /\s/u.test(chars[to - 1])) to--;
      // Hard breaks may make short lines; automatic breaks must not do so.
      if (to - from < 3 && (i > 0 || j < breaks.length - 1)) continue;
      const advances = weight === "first" && i === 0 ? firstWidths : widths;
      const width = advances[to] - advances[from];
      // Only punctuation and spaces are legal cuts. Overflowing words retain
      // their natural width; layout must reserve their actual extent.
      const cost = [Math.max(0, width - maxWidth), 1, Math.max(0, maxWidth - width) ** 2]
        .map((value, index) => value + tail.cost[index]);
      const previous = plans.get(i);
      const difference = previous ? cost.findIndex((value, index) => Math.abs(value - previous.cost[index]) > 1e-8) : -1;
      if (!previous || difference >= 0 && cost[difference] < previous.cost[difference]) plans.set(i, { cost, end: j, from, to });
    }
  }
  const lines: string[] = [];
  for (let i = 0; i < breaks.length - 1;) {
    const plan = plans.get(i)!;
    lines.push(chars.slice(plan.from, plan.to).join(""));
    i = plan.end;
  }
  return lines;
}

export function textBlock(text: string, maxWidth = 228, size = fontSize.node, weight: TextWeight = 400): TextBlock {
  const lines = wrapText(text, maxWidth, size, weight);
  const weights = lines.map((_, index): FontWeight => weight === "first" ? index ? 400 : 700 : weight);
  const lineHeight = size * 1.4;
  return { lines, weights, width: Math.ceil(Math.max(0, ...lines.map((line, index) => textWidth(line, size, weights[index])))), height: lines.length * lineHeight, fontSize: size, lineHeight };
}

export const headerHeight = (text: TextBlock) => text.height + 8;
