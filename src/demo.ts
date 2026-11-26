// デモ表示とテストに使うダミーデータ。実在のボット名・セッション ID・パスは入れない。
import type { RawSources } from "./model";

const sid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const iso = (ms: number) => new Date(ms).toISOString();

export const DEMO_IDS = {
  concierge: sid(1),
  planner: sid(2),
  researcher: sid(3),
  builderA: sid(4),
  builderB: sid(5),
  reviewer: sid(6),
  scheduler: sid(7),
};

export function demoSources(now: number): RawSources {
  const min = 60 * 1000;
  const h = (id: string) => `orca_session_id:${id}`;
  const ids = DEMO_IDS;
  return {
    messages: [
      {
        id: "msg_demo_01",
        type: "handoff",
        from_handle: h(ids.concierge),
        to_handle: h(ids.planner),
        subject: "ログイン画面の改修を計画してほしい",
        created_at: iso(now - 9 * min),
      },
      {
        id: "msg_demo_02",
        type: "question",
        from_handle: h(ids.builderA),
        to_handle: h(ids.planner),
        subject: "API のエラー形式はどちらに合わせる？",
        created_at: iso(now - 2 * min),
      },
      {
        id: "msg_demo_03",
        type: "handoff",
        from_handle: h(ids.planner),
        to_handle: h(ids.researcher),
        subject: "既存の認証ライブラリを比較して",
        created_at: iso(now - 7 * min),
      },
      {
        id: "msg_demo_04",
        type: "status",
        from_handle: h(ids.researcher),
        to_handle: h(ids.planner),
        subject: "比較表をまとめました",
        created_at: iso(now - 4 * min),
        thread_id: "msg_demo_03",
      },
      {
        id: "msg_demo_05",
        type: "worker_done",
        from_handle: h(ids.reviewer),
        to_handle: h(ids.planner),
        subject: "レビュー完了: 指摘 2 件",
        created_at: iso(now - 15 * min),
      },
      {
        id: "msg_demo_06",
        type: "status",
        from_handle: h(ids.concierge),
        to_handle: h(ids.planner),
        subject: "オーナーから優先度の連絡",
        created_at: iso(now - 20 * min),
      },
    ],
    workers: [
      {
        dispatchId: "ctx_demo_a",
        taskId: "task_demo_a",
        workspace: "repo::demo-a",
        outcome: "in_progress",
        assigneePaneKey: "pane-4",
      },
      {
        dispatchId: "ctx_demo_b",
        taskId: "task_demo_b",
        workspace: "repo::demo-b",
        outcome: "in_progress",
        assigneePaneKey: "pane-5",
      },
      {
        dispatchId: "ctx_demo_c",
        taskId: "task_demo_c",
        workspace: "repo::demo-c",
        outcome: "succeeded",
        assigneePaneKey: "pane-6",
      },
    ],
    worktrees: [
      {
        worktreeId: "repo::concierge",
        bot: "Concierge",
        agents: [
          { orcaSessionId: ids.concierge, paneKey: "pane-1", state: "done" },
        ],
      },
      {
        worktreeId: "repo::planner",
        displayName: "Planner",
        agents: [
          { orcaSessionId: ids.planner, paneKey: "pane-2", state: "working" },
        ],
      },
      {
        worktreeId: "repo::research",
        bot: "Researcher",
        agents: [
          {
            orcaSessionId: ids.researcher,
            paneKey: "pane-3",
            state: "done",
            activity: { status: "done", unread: true },
            lastAssistantMessage: "認証ライブラリの比較表ができました",
            stateStartedAt: now - 4 * min,
          },
        ],
      },
      {
        worktreeId: "repo::demo-a",
        displayName: "builder-a",
        createdAt: now - 6 * min,
        agents: [
          {
            orcaSessionId: ids.builderA,
            paneKey: "pane-4",
            parentPaneKey: "pane-2",
            state: "blocked",
            activity: { status: "blocked" },
            toolName: "Bash",
            stateStartedAt: now - 1 * min,
            taskTitle: "ログイン画面のフォームを作る",
          },
        ],
      },
      {
        worktreeId: "repo::demo-b",
        // Orca は worker の worktree にも依頼元のボット名を付ける。
        bot: "Concierge",
        displayName: "builder-b",
        createdAt: now - 5 * min,
        agents: [
          {
            orcaSessionId: ids.builderB,
            paneKey: "pane-5",
            parentPaneKey: "pane-2",
            state: "working",
            taskTitle: "セッション管理のテストを書く",
          },
        ],
      },
      {
        worktreeId: "repo::scheduler",
        bot: "Scheduler",
        agents: [
          { orcaSessionId: ids.scheduler, paneKey: "pane-7", state: "done" },
        ],
      },
      {
        worktreeId: "repo::demo-c",
        displayName: "reviewer",
        agents: [
          {
            orcaSessionId: ids.reviewer,
            paneKey: "pane-6",
            parentPaneKey: "pane-2",
            state: "done",
            stateStartedAt: now - 14 * min,
            taskTitle: "ログイン画面の差分をレビューする",
          },
        ],
      },
    ],
    bots: ["Concierge", "Researcher", "Scheduler", "Archivist"],
    items: [
      {
        bot: "Scheduler",
        number: 3,
        title: "定例の時間を決める",
        status: "needs_you",
        question: { text: "来週の定例は火曜と木曜のどちらにしますか？" },
        updatedAt: now - 3 * min,
      },
      {
        bot: "Scheduler",
        number: 2,
        title: "議事録を送る",
        status: "in_progress",
        updatedAt: now,
      },
    ],
  };
}
