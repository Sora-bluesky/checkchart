import assert from "node:assert/strict";
import test from "node:test";
import { textBlock, textWidth, wrapText } from "../backends/svg/text.ts";

test("text measurement conservatively covers BIZ UDPGothic glyph advances", () => {
  // Independently measured font advances in em, before the renderer's margin.
  for (const [label, advance] of [
    ["日本語", 3], ["Ａ１", 2], ["AB9", 2.29], ["abc", 2],
    ["MMMMWWWW", 7.84], ["ひらがなの", 4.88], ["カタカナの", 4.7], ["・、。：（）「」", 4.2],
  ] as const) {
    assert.ok(textWidth(label, 15) >= advance * 15, label);
    assert.ok(textWidth(label, 15) <= advance * 15 * 1.1, label);
  }
  assert.ok(textWidth("カナ", 15) < textWidth("漢字", 15));
  assert.ok(textWidth("・：（）「」", 15) < textWidth("漢字漢字漢字", 15) * 0.6);
  assert.equal(textWidth("e\u0301", 10), textWidth("e", 10));
  assert.ok(textWidth("𠀀", 10) >= 10);
  assert.ok(textWidth("日本語") > textWidth("abc"));
});

test("bold measurement and wrapping reserve the actual name weight", () => {
  const label = "WWW MMM acme";
  assert.ok(textWidth(label, 16, 700) > textWidth(label, 16, 400));
  const budget = textWidth(label, 16, 400);
  assert.deepEqual(wrapText(label, budget, 16, 400), [label]);
  const bold = wrapText(label, budget, 16, 700);
  assert.ok(bold.length > 1);
  for (const line of bold) assert.ok(textWidth(line, 16, 700) <= budget);
});

test("wrapping prefers spaces, preserves hard breaks and keeps long words intact", () => {
  assert.deepEqual(wrapText("one two three", 50, 10), ["one two", "three"]);
  assert.deepEqual(wrapText("日本語の文章", 32, 10), ["日本語の文章"]);
  assert.deepEqual(wrapText("one\r\ntwo\n\nthree\rfour", 200, 10), ["one", "two", "", "three", "four"]);
  const word = "averylongunbrokenword".repeat(8);
  const block = textBlock(word, 228);
  assert.deepEqual(block.lines, [word]);
  assert.ok(block.width >= textWidth(word));
  assert.equal(block.height, block.lines.length * block.lineHeight);
  assert.deepEqual(wrapText("", 200), [""]);
});

test("Japanese wrapping uses punctuation and spaces without CJK cuts", () => {
  const label = "連番付きの出力を送り、snapshot を受ける";
  assert.deepEqual(wrapText(label, 270, 12), [label]);
  assert.deepEqual(wrapText(label, 180, 12), ["連番付きの出力を送り、", "snapshot を受ける"]);
  for (const punctuation of ["、", "。", "・", "：", "，", "）"]) {
    assert.deepEqual(wrapText(`前半の文章${punctuation}後半の文章です`, 100, 10), [`前半の文章${punctuation}`, "後半の文章です"]);
  }
  assert.deepEqual(wrapText("前半の文章 後半の文章です", 100, 10), ["前半の文章", "後半の文章です"]);
});

test("automatic Japanese breaks avoid short final lines and forbidden line starts", () => {
  const forbidden = /^[ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶー、。，．・：；？！）］｝〉》」』】]/u;
  for (const input of ["一二三四五六七八九十一二三", "日本語の文章を読みやすく表示する", "日本語の文章っぽい言葉を表示する", "日本語の文章ーという言葉を表示する", "日本語の文章）を読みやすく表示する"]) {
    const lines = wrapText(input, 60, 10);
    assert.equal(lines.join(""), input);
    for (const line of lines) { assert.ok([...line].length >= 3, JSON.stringify(lines)); assert.doesNotMatch(line, forbidden); }
  }
  assert.deepEqual(wrapText("日本\n語\n\nabc", 30, 10), ["日本", "語", "", "abc"]);
});

test("Japanese labels keep words whole at the 240px label budget", () => {
  for (const label of [
    "無ければ起動・あれば接続", "更新時に保存の担当を引き渡す", "コマンドを実行", "端末ごとに起動",
    "renderer・GPU・utility", "起動（Job を継承）", "入力と操作を送り、", "名前付きパイプ（制御用・出力用）",
    "保存の担当を引き継ぐ", "画面出力（VT）", "トランザクションで保存・読込",
  ]) {
    assert.ok(textWidth(label, 15) <= 240, label);
    assert.deepEqual(wrapText(label, 240, 15), [label]);
  }
  for (const word of ["更新時に保存の担当を引き渡す", "トランザクションで保存する", "rendererGPUutility123"]) {
    const long = word.repeat(4), block = textBlock(long, 200);
    assert.deepEqual(block.lines, [long]);
    assert.ok(block.width >= textWidth(long), "unbreakable words grow their box without shrinking glyphs");
  }
  for (const mark of ["、", "。", "・", "：", "，", "）"]) {
    assert.deepEqual(wrapText(`前半の文章${mark}後半の文章です`, 100, 10), [`前半の文章${mark}`, "後半の文章です"]);
  }
  assert.deepEqual(wrapText("前半の文章（後半の文章です）", 100, 10), ["前半の文章", "（後半の文章です）"]);
});
