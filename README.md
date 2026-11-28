# orca-agent-map

[Orca](https://github.com/stablyai/orca) の右サイドバーに、ボット・エージェント・worker の間の依頼をリアルタイムに描くパネル（Orca プラグイン）。

| ダーク                                    | ライト                                     |
| ----------------------------------------- | ------------------------------------------ |
| ![ダークテーマ](docs/screenshot-dark.png) | ![ライトテーマ](docs/screenshot-light.png) |

スクリーンショットはプラグイン内蔵のデモデータ（ダミー）で描いたもの。

## 入れ方

Orca 1.4.248 以降が必要（行やノードを開くのに使う `workspace:write` が入った版）。

```sh
orca plugin install tqer39/orca-agent-map --json
```

このプラグインは worker（Node のプロセス）で `orca` CLI を呼ぶため、初回は承認が要る。上のコマンドは `approval_required` で止まり、許可する内容（`trusted-worker` で動くこと、`settings:own`、`workspace:write`）と `--approve <fingerprint>` 付きのコマンドを返すので、内容を確かめてからそのコマンドを実行する。

入れたら右サイドバーのアクティビティバーに出る **Agent Map**（activity のアイコン）を開く。

手元の clone から試すとき:

```sh
git clone https://github.com/tqer39/orca-agent-map.git
cd orca-agent-map
orca plugin dev load . --json   # 承認の内容と --approve 付きのコマンドが返る
# 返ってきた承認の内容を確かめてから、そのコマンドを実行する
orca plugin dev load . --json --approve <fingerprint>
orca plugin open local.agent-map --panel agent-map
```

## 見方

- **上部の図**: 左が主に送る側、右が主に受ける側。線は送り元から送り先への依頼で、色は種類（handoff / question / status / worker / escalation）。返事待ちや作業中の依頼は点線が流れる。同じ組の依頼は 1 本にまとめる。
- **ノードの点**: 緑の点滅は作業中、黄は返事待ち、赤は許可待ち、灰は待機中（終わっている）。ボットは動いていなくても待機中のノードとして出る。worker は動いている間と、終わってから 15 分だけ出る。
- **人の対応待ち（NEEDS YOU）**: 赤い枠と「!」の印のノード、ヘッダの「! N needs you」、一覧の一番上の **NEEDS YOU** 欄。理由は文字でも出す（許可待ち / 返事待ち / Needs you / 未読）。枠はゆっくり点滅する（OS で「視差効果を減らす」にしていると点滅しない）。
- **行やノードを開く**: NEEDS YOU / IN FLIGHT / RECENT の行と図のノードをクリック（または Tab で選んで Enter / Space）すると、その相手を Orca で開く。
  - ターミナルで動くエージェント: そのペインまでフォーカスする（`terminal.focus`）。
  - チャットのエージェント・worker: そのワークスペースを開く（`workspace.open`）。どのチャットのタブを出すかを選ぶ API は無いので、タブは Orca が前に出していたものになる。
  - ボットのノード・ボットの Item: Item の画面を開く API は無いので、ボットのホーム（Home Chat のあるワークスペース）を開く。行に Item 番号（`#12`）を出すので、`orca bot item show` などで探せる。
  - ホームの分からないボットの Item: Item に PR などの http(s) のリンクがあれば、ブラウザで開く（`shell.openExternal`。Orca が開く前に確認を出すことがある）。
  - IN FLIGHT / RECENT の行: 受け手（→ の右）のノードと同じところを開く。
  - 開く先の無い行やノード（ワークスペースの分からないエージェント、ホームもリンクも無い Item、ブラウザを開けないパネルでのリンクだけの Item）は、押せる見た目にしない。デモデータの行やノードも開けない。
  - 開けなかったときは「更新できませんでした」の欄に理由を出す。
  - 続けて押したときは、先に押したものが終わってから、後から押したものを開く。待つあいだ（`orca terminal list` の応答待ちなど）に押したものは、最後に押した 1 つだけ残す。パネルから worker への頼みは一度に 1 つだけにするので、1 つのパネルの中で頼みの順が入れ替わることはない。
  - リンク（ホームの分からない Item の行と、チケットのバッジ）も同じ順番待ちに入り、先に押した移動の答えが来てから開く。待つあいだに押した操作の有効期間が切れたら開かず、「もう一度押してください」と出す。
  - 保証できないこと: 先に押した移動は取り消さない（終わるのを待つ）。Orca がその移動を画面に出し終えるのが、リンクを開いた後になることはある。別のパネルや、読み込み直す前のパネルが出した頼みは、worker に届いた順に行うので、リンクを開いた後に Orca が動くこともある。
- **チケットのバッジ**: ワークスペースに付けた参照（チケット・PR）と、そのブランチの PR を、ノードの下と一覧の各行に出す。表示名は Orca と同じで、Linear と Jira は `ABC-123`、それ以外は `PR #12` / `MR !12` / `Issue #12`。
  - エージェント・worker のノード: そのセッションのワークスペースのもの。ボットのノード: ボットのホームのものだけ（全セッション分はまとめない）。
  - IN FLIGHT / RECENT の行: 受け手のもの。NEEDS YOU の行: エージェントはそのワークスペースのもの、ボットの Item は Item のリンクにある PR。
  - 下線のあるバッジはクリック（または Tab で選んで Enter / Space）でブラウザに開く（`orca.shell.openExternal`。初めてのホストは Orca が確認を出す）。行を選んだときの Orca 内への移動は起きない。先に押した行やノードの移動を待っているあいだに押したときは、その移動が終わってから開く（上の「続けて押したとき」と同じ）。URL の無い参照は押せないバッジになる。デモデータのバッジは押せない。
  - 出るのは Orca がワークスペースに持っている参照だけ。ブランチ名や PR のタイトルからチケット番号を推測しない。Jira / Linear のチケットは、`orca reference add ABC-123 --worktree <セレクタ>`（Jira のキー）や `orca reference add https://linear.app/acme/issue/ABC-123 --worktree <セレクタ>`（URL）、または Orca の画面でワークスペースに付けたものだけが出る。
  - 図では、ノードの幅に入らない分を `+N` にまとめる。
- **IN FLIGHT**: 返事待ちの handoff / question / escalation と、走っている worker。0 件のときは「いま動いているエージェントはありません」と出す。
- **RECENT**: 最近の依頼と報告（新しい順に 20 件）。
- **N live**: IN FLIGHT の件数。
- **Masked**: 押すと件名と NEEDS YOU の本文、チケットのバッジを伏せる（画面共有用）。伏せている間、バッジは押せない。設定に保存され、次に開いたときも続く。
- データを取れなかったときは、最後に取れた状態を残したまま「更新できませんでした」と何が失敗したかを出す。

### 返事待ちの判定

handoff / question / escalation は、次のどれかが来るまで IN FLIGHT に置く。

- `thread_id` がその依頼を指すメッセージ
- `payload.requestId` がその依頼を指すメッセージ
- 依頼の後に、受け手から送り手へ送られたメッセージ

12 時間より古い返事待ちは放置されたものとして IN FLIGHT から外す。

## データの元

Orca の plugin API には orchestration の inbox や worker 一覧を読むメソッドが無いため、プラグインの worker が `orca` CLI を呼んで JSON を読む。パネルが見えている間だけ、設定の間隔（既定 5 秒）で読み直す。

| 表示                                                  | コマンド                                                                                         | 使う項目                                                                                                                                                                                          |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 依頼の線、IN FLIGHT、RECENT                           | `orca orchestration inbox --json --full --limit 100`                                             | `from_handle` / `to_handle` / `type` / `subject` / `created_at` / `thread_id` / `payload`                                                                                                         |
| 走っている worker                                     | `orca orchestration worker-list --json`                                                          | `workspace` / `outcome` / `liveness` / `taskId`                                                                                                                                                   |
| worker の担当エージェント                             | `orca orchestration worker-show --dispatch <id> --full --json`                                   | `dispatch.assigneePaneKey`                                                                                                                                                                        |
| 名前、状態、worker の依頼元、許可待ち・返事待ち・未読 | `orca worktree ps --json`                                                                        | `worktreeId` / `bot` / `botHome` / `agents[].orcaSessionId` / `paneKey` / `parentPaneKey` / `activity.status` / `activity.unread` / `toolName` / `taskTitle`                                      |
| チケットのバッジ                                      | `orca worktree ps --json`（上と同じ呼び出し）                                                    | `linkedItems[]`（`provider` / `type` / `number` / `identifier` / `url` / `repoId`）/ `linkedPR`（`number` / `url`）/ `linkedIssue` / `linkedLinearIssue` / `linkedGitLabMR` / `linkedGitLabIssue` |
| ボットのノード                                        | `orca bot list --json`                                                                           | `name`                                                                                                                                                                                            |
| ボットの Needs you の Item                            | `orca bot item list --bot <名前> --status needs-you --limit 100 --json`（`--cursor` で全ページ） | `title` / `question.text` / `updatedAt` / `links[].pr` / `links[].url` / `nextCursor`                                                                                                             |

- inbox のセッション ID は `worktree ps` の `orcaSessionId` と突き合わせて名前にする。ボットの worktree のセッション（チャット）は、ボットごとに 1 つのノードにまとめる。
- worker の担当エージェントは、`worker-show` の `assigneePaneKey`（含まれるセッション ID）で `ps` のエージェントと突き合わせる。coordinator や別の worker と同じ worktree に居ても取り違えない。引くのは走っている worker と、終わった worker のうち新しい 20 件。dispatch の担当は変わらないので、引けた値は dispatch ごとに覚え、終わった後も使う。担当を引けていない worker は推測で結ばず、出さない。
- worker の依頼元は、worker のエージェントの `parentPaneKey` が指すペインのエージェント。
- `ps` に居ない送り手は、`payload.botRequest.from` にボット名があればそれを、無ければセッション ID の先頭 6 文字を出す。
- ボットの一覧と Item はボットの数だけ CLI を呼ぶので、15 秒のあいだ使い回す。
- Item はボットごとに最大 50 ページ（5000 件）まで読む。上限を超えて続きがあるときや、カーソルが繰り返されたときは、読めた分を出したうえで「更新できませんでした」の欄に未取得があることを出す。
- 行やノードを開くときは、`ps` の `worktreeId` を plugin API の `workspace.open` に渡す。ターミナルのエージェントは、`ps` の `paneKey`（`<tabId>:<leafId>`）を `orca terminal list --worktree <id> --json` の `tabId` / `leafId` と突き合わせて handle を引き、`terminal.focus` に渡す。引けないときやフォーカスできないときはワークスペースを開く。
- チケットは `linkedItems` を先に、次に `linkedPR`（ブランチの PR）を見て、同じものは 1 つにまとめる。URL が両方にあれば URL だけで見分けるので、別のリポジトリの同じ番号の PR は両方出る。片方に URL が無いときは provider・リポジトリ・表示名で見分ける。`linkedIssue` などの古い単一スロットは、`linkedItems` に同じものが無いときだけ使う（URL が無いので押せない）。ブラウザに渡すのは `http(s)` の URL だけ。
- `orca` は PATH から探し、見つからなければ macOS の `/Applications/Orca.app/Contents/Resources/bin/orca` を使う。設定の「orca CLI のパス」で変えられる。

### 取れないもの・できないこと

- 行やノードから、特定のチャットのタブやボットの Item の画面は開けない（plugin API にも CLI にも無い）。開けるのはワークスペースと、ターミナルのペインまで。
- Orca の起動時にパネルを開いた状態にする設定は、プラグインの manifest と API に無い。パネルを開く操作（`orca plugin open`）はできるが、起動時に自動で開く仕組みは無い。
- 依頼の本文はパネルに出さない（件名だけ）。

## 設定

Orca の Settings → Plugins → Agent Map で変えられる。

| 設定                   | 既定 | 内容                                    |
| ---------------------- | ---- | --------------------------------------- |
| 更新間隔（秒）         | 5    | 2〜60 秒                                |
| 件名を伏せる（Masked） | オフ | パネルの Masked と同じ                  |
| orca CLI のパス        | 空   | 空なら PATH の `orca`                   |
| デモデータを表示       | オフ | Orca の情報の代わりにダミーデータを描く |

## 開発

ツールは [mise](https://mise.jdx.dev/) で揃える（[dev-standards](https://github.com/tqer39/dev-standards) の構成）。

```sh
mise run bootstrap      # 依存を入れる
mise run lint           # Biome
mise run format:check
mise run test           # orca plugin validate / test / check
mise run build          # orca plugin types（.orca/types を作る）と tsc の型チェック
```

`scripts/orca.sh` は PATH の `orca` を使う。無い Linux（CI など）では、公式リリースの orca-server を `.cache/orca` に取ってきて、SHA-256 を確かめてから使う。

- `src/model.ts`: CLI の JSON を描く形にする純粋関数
- `src/tickets.ts`: ワークスペースの参照をチケットのバッジにする純粋関数
- `src/worker.ts`: CLI を呼ぶ worker
- `src/demo.ts`: デモ表示とテストのダミーデータ
- `panel/`: HTML パネル（`view.ts` は DOM に触らない描画関数、`tickets.ts` はバッジの描画と押したときの処理）

テストやスクリーンショットには実在のボット名・依頼文・セッション ID を入れず、`src/demo.ts` のダミーデータを使う。

## ライセンス

[MIT](LICENSE)
