# 開発言語の選定

## 要件

Orca のプラグインとして、エージェント間の依頼をパネルに表示する。
Orca のプラグイン API とブラウザー上の UI を、同じ言語と型定義で扱う。

## 候補

TypeScript と JavaScript を、型検査、Orca のプラグイン API との相性、保守性から比較する。

## 選定理由

TypeScript を採用し、パッケージ管理には pnpm を使う。
pnpm を使うため node-npm ではなく mise-project を使い、各タスクから package.json の scripts を呼び出す。
lint と整形には Biome、テストには Node.js のテストランナーを使う。
検証の範囲はリポジトリ全体とし、OS 固有の検査はない。
