[English](README.md) | [日本語](README.ja.md)

# checkchart

checkchart は、流れ図・シーケンス図・構成図を描く Claude Code のスキルです。描く前に図の元になる事実を検査し、Mermaid と、指定すれば自前の SVG を書き出します。

![checkchart で描いた構成図](examples/architecture/chart.svg)

図は、決まった読み手の1つの問いに答えるものです。そこでスキルは、誰が読み、何に答える図かを先に書かせ、その問いに要る事実だけを受け取ります。既存の図は事実の出どころとして読み、配置は写しません。

## 検査すること

規則は終了コードを決めます。破れると、レポートに問題の箇所までの最短経路を書き、図では赤で示します。

- 流れ図では、どのノードにも開始から届き、どのノードからも終了に着けて、判断には条件の違う出口が2本以上あること
- シーケンス図では、呼び出しには応答かタイムアウトの宣言があり、応答は前の呼び出しに答えて呼び出し元へ戻り、届かないメッセージには回復するメッセージがあること
- 構成図では、接続の両端が宣言されていて、信頼しない範囲（エージェントの出力、利用者のリポジトリ、ネットワークの相手など）から出るデータには、それを検証する側のコンポーネントが書かれていること
- どの図でも、タイトル・読み手・問いが書かれていて、製品名の綴りがどこでも同じであること。構成図の矢印にはすべてラベルが要り、子の範囲を1つ囲むだけの範囲は置けません

警告は、図を読みにくくするものを指摘します。深い入れ子、双方向の矢印、「使う」のような中身のないラベル、線の交差、要素の多すぎ、詳しさの違う要素の混在、後戻りの多い流れ、幅 1100px を超える図です。終了コードは変えません。閾値は目安で、根拠にした資料は [references/principles.md](skills/checkchart/references/principles.md) にあります。

## 使い方

ファイルを2つ書きます。

- `model.json` には事実だけを書きます。ノードと矢印、参加者とメッセージ、または範囲・コンポーネント・接続です。中身は ID だけです。
- `view.mjs` には読み手の言葉を書きます。タイトル、読み手、問い、ID ごとのラベル、矢印の文言、グループと色、製品名です。

実行します。

```sh
skills/checkchart/scripts/checkchart model.json --view view.mjs --out chart --svg
```

`chart.mmd` と `report.md` ができ、`--svg` を付けると `chart.svg` もできます。終了コードは、すべての規則が通れば 0、破れた規則があれば 1、入力が誤っていれば 2 です。

SVG は [ELK](https://eclipse.dev/elk/) で配置し、checkchart が自分で描きます。箱は角の立った同じ大きさにそろえ、線は直角に曲がって相手のほうを向いた面から出ます。ラベルは自分の線のすぐ脇に置き、範囲の名前は線の通らないタブに書き、信頼しない範囲は破線の枠と錠のマークで示します。ライト表示とダーク表示に合わせて色が変わります。描くのにブラウザもネットワークも使いません。

Mermaid のほうは、[pstack](https://github.com/cursor/plugins/tree/main/pstack) の `statechart` スキルと同じタイトル・Legend・7つのグループ色を使うので、両方のスキルで描いた図を1つの資料に並べられます。[Pele](https://pele.run) で描くか、`--fill` を付けて色を Mermaid の本文に書き込めば、GitHub・Obsidian・VS Code でも色が付きます。状態図は描かないので、statechart を使ってください。

種類ごとの図と、規則ごとの破れる例は [examples/](examples/) に、規則の全体は [SKILL.md](skills/checkchart/SKILL.md) にあります。

## 導入

Node 22.18 以降、Bun 1.1.5 以降、Deno 2 以降のどれかで動きます。Mermaid だけならパッケージは要りません。SVG には [elkjs](https://github.com/kieler/elkjs) が要り、`--svg` を付けたときだけ読み込みます。

```sh
cd skills/checkchart/scripts && npm ci
```

Claude Code のプラグインとして入れる場合:

```sh
claude plugin marketplace add Sora-bluesky/checkchart
claude plugin install checkchart@checkchart
```

`skills/checkchart` を `~/.claude/skills/` へコピー（またはリンク）しても動きます。

## 検査しないこと

checkchart が検査するのは、渡した事実の形です。事実が正しいかどうかは検査しません。条件が実際に起こりうるか、メッセージの順序がそのプロトコルとして正しいか、`checkedBy` に書いたコンポーネントが本当に入力を検証しているかは分かりません。読み手が図を理解できるかも分からないので、スキルは SVG を別の人に渡し、短い質問に答えてもらう手順を指示します。レポートの「Checks not made」に、検査しなかったことを書きます。

## ライセンス

MIT。pstack の statechart スキル（MIT、Lauren Tan）のコードと配色を元にした部分があります。elkjs は任意の依存（EPL-2.0 または GPL-3.0-or-later）で、このリポジトリには含めていません。[NOTICE](NOTICE) を参照してください。
