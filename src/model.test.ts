import { assert, test } from "orca/testing";
import { DEMO_IDS as ids, demoSources } from "./demo";
import { buildSnapshot } from "./model";

const NOW = Date.UTC(2030, 0, 1, 12, 0, 0);

test("返事の無い handoff / question と走っている worker を IN FLIGHT に出す", () => {
  const s = buildSnapshot(demoSources(NOW), NOW);
  assert.deepEqual(
    s.inFlight.map((f) => f.id),
    ["msg_demo_02", "ctx_demo_b", "ctx_demo_a", "msg_demo_01"],
  );
  assert.ok(s.inFlight.every((f) => f.live));
});

test("返事の付いた handoff、status、終わって間もない worker は RECENT に入る", () => {
  const s = buildSnapshot(demoSources(NOW), NOW);
  assert.deepEqual(
    s.recent.map((f) => f.id),
    ["msg_demo_04", "msg_demo_03", "ctx_demo_c", "msg_demo_05", "msg_demo_06"],
  );
  assert.ok(s.recent.every((f) => !f.live));
});

test("worker の送り元は parentPaneKey の coordinator、件名は taskTitle", () => {
  const s = buildSnapshot(demoSources(NOW), NOW);
  const a = s.inFlight.find((f) => f.id === "ctx_demo_a");
  assert.equal(a?.from, ids.planner);
  assert.equal(a?.to, ids.builderA);
  assert.equal(a?.type, "worker");
  assert.equal(a?.subject, "ログイン画面のフォームを作る");
});

test("ノードはボット名・表示名で名付け、状態と種類を持つ", () => {
  const s = buildSnapshot(demoSources(NOW), NOW);
  const byId = new Map(s.nodes.map((n) => [n.id, n]));
  assert.deepEqual(byId.get("bot:Concierge"), {
    id: "bot:Concierge",
    label: "Concierge",
    kind: "bot",
    state: "done",
    needsYou: false,
  });
  assert.equal(byId.get(ids.planner)?.label, "Planner");
  assert.equal(byId.get(ids.builderA)?.kind, "worker");
  assert.equal(byId.get(ids.builderA)?.state, "blocked");
});

test("相手から後で返事が来た question は IN FLIGHT から外れる", () => {
  const raw = demoSources(NOW);
  raw.messages.push({
    id: "msg_demo_99",
    type: "status",
    from_handle: `orca_session_id:${ids.planner}`,
    to_handle: `orca_session_id:${ids.builderA}`,
    subject: "既存の形式に合わせて",
    created_at: new Date(NOW - 1000).toISOString(),
  });
  const s = buildSnapshot(raw, NOW);
  assert.ok(!s.inFlight.some((f) => f.id === "msg_demo_02"));
});

test("payload.requestId で返事が付いた handoff も完了扱い", () => {
  const raw = demoSources(NOW);
  raw.messages.push({
    id: "msg_demo_98",
    type: "status",
    from_handle: "orca_session_id:someone-else",
    to_handle: `orca_session_id:${ids.concierge}`,
    created_at: new Date(NOW).toISOString(),
    payload: JSON.stringify({ requestId: "msg_demo_01" }),
  });
  assert.ok(
    !buildSnapshot(raw, NOW).inFlight.some((f) => f.id === "msg_demo_01"),
  );
});

test("12 時間より古い返事待ちは出さない", () => {
  const raw = demoSources(NOW);
  const later = NOW + 13 * 60 * 60 * 1000;
  assert.ok(
    !buildSnapshot(raw, later).inFlight.some((f) => f.type === "handoff"),
  );
});

test("ps に居ない送り手は payload のボット名か短い ID で表す", () => {
  const s = buildSnapshot(
    {
      messages: [
        {
          id: "m1",
          type: "handoff",
          from_handle: "orca_session_id:11111111-2222-4333-8444-555555555555",
          to_handle: "orca_session_id:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
          created_at: new Date(NOW).toISOString(),
          payload: JSON.stringify({ botRequest: { from: "Helper" } }),
        },
      ],
      workers: [],
      worktrees: [],
      bots: [],
      items: [],
    },
    NOW,
  );
  assert.deepEqual(
    s.nodes.map((n) => [n.label, n.kind]),
    [
      ["Helper", "bot"],
      ["session aaaaaa", "agent"],
    ],
  );
});

test("空のデータでも壊れない", () => {
  const s = buildSnapshot(
    { messages: [], workers: [], worktrees: [], bots: [], items: [] },
    NOW,
  );
  assert.deepEqual(
    [s.nodes, s.inFlight, s.recent, s.needsYou],
    [[], [], [], []],
  );
});

test("許可待ち・Needs you の Item・未読を NEEDS YOU に優先順で出す", () => {
  const s = buildSnapshot(demoSources(NOW), NOW);
  assert.deepEqual(
    s.needsYou.map((n) => [n.node, n.reason, n.text]),
    [
      [ids.builderA, "permission", "Bash の実行許可を待っています"],
      ["bot:Scheduler", "item", "来週の定例は火曜と木曜のどちらにしますか？"],
      ["bot:Researcher", "unread", "認証ライブラリの比較表ができました"],
    ],
  );
  const needing = s.nodes.filter((n) => n.needsYou).map((n) => n.label);
  assert.deepEqual(needing, ["builder-a", "Scheduler", "Researcher"]);
});

test("返事待ち（waiting）は input、ps に居ないボットの Item もノードにする", () => {
  const s = buildSnapshot(
    {
      messages: [],
      workers: [],
      worktrees: [
        {
          worktreeId: "w",
          displayName: "helper",
          agents: [
            {
              orcaSessionId: "abc",
              state: "done",
              activity: { status: "waiting" },
              lastAssistantMessage: "どちらにしますか？\n詳細…",
            },
          ],
        },
      ],
      bots: [],
      items: [
        {
          bot: "Away",
          number: 1,
          title: "確認して",
          status: "needs_you",
          updatedAt: "2030-01-01T00:00:00Z",
        },
      ],
    },
    NOW,
  );
  assert.deepEqual(
    s.needsYou.map((n) => [n.node, n.reason, n.text]),
    [
      ["abc", "input", "どちらにしますか？"],
      ["bot:Away", "item", "確認して"],
    ],
  );
  assert.deepEqual(
    s.nodes.map((n) => [n.label, n.state, n.needsYou]),
    [
      ["helper", "waiting", true],
      ["Away", "unknown", true],
    ],
  );
});

test("ボットは動いていなくても待機中のノードとして出し、セッションは 1 つにまとめる", () => {
  const s = buildSnapshot(demoSources(NOW), NOW);
  const archivist = s.nodes.find((n) => n.label === "Archivist");
  assert.deepEqual(archivist, {
    id: "bot:Archivist",
    label: "Archivist",
    kind: "bot",
    state: "unknown",
    needsYou: false,
  });
  assert.equal(s.nodes.filter((n) => n.label === "Concierge").length, 1);
  const handoff = s.inFlight.find((f) => f.id === "msg_demo_01");
  assert.equal(handoff?.from, "bot:Concierge");
});

test("終わってから 15 分を過ぎた worker は出さない", () => {
  const later = NOW + 2 * 60 * 1000;
  const s = buildSnapshot(demoSources(NOW), later);
  assert.ok(!s.recent.some((f) => f.id === "ctx_demo_c"));
});

test("ボット名の付いた worker の worktree も worker のノードとして描く", () => {
  const s = buildSnapshot(demoSources(NOW), NOW);
  const b = s.nodes.find((n) => n.id === ids.builderB);
  assert.deepEqual([b?.label, b?.kind], ["builder-b", "worker"]);
  assert.equal(s.nodes.filter((n) => n.label === "Concierge").length, 1);
});

test("別の依頼に結び付いた返事では、この依頼を閉じない", () => {
  const raw = demoSources(NOW);
  raw.messages.push({
    id: "msg_demo_97",
    type: "status",
    from_handle: `orca_session_id:${ids.planner}`,
    to_handle: `orca_session_id:${ids.builderA}`,
    subject: "前の件の返事",
    created_at: new Date(NOW - 1000).toISOString(),
    thread_id: "msg_demo_00",
  });
  const s = buildSnapshot(raw, NOW);
  assert.ok(s.inFlight.some((f) => f.id === "msg_demo_02"));
});

/** coordinator と 2 人の worker が同じ worktree に居る（worker-start --worktree current）。 */
function sharedWorktree(withPaneKeys: boolean) {
  const sid = (n: number) => `00000000-0000-4000-9000-00000000000${n}`;
  return buildSnapshot(
    {
      messages: [],
      bots: [],
      items: [],
      worktrees: [
        {
          worktreeId: "repo::shared",
          displayName: "shared",
          agents: [
            {
              orcaSessionId: sid(1),
              paneKey: "pane-c",
              displayName: "coordinator",
              state: "working",
            },
            {
              orcaSessionId: sid(2),
              paneKey: "pane-a",
              parentPaneKey: "pane-c",
              displayName: "worker-a",
              state: "working",
              taskTitle: "A をやる",
            },
            {
              orcaSessionId: sid(3),
              paneKey: "pane-b",
              parentPaneKey: "pane-c",
              displayName: "worker-b",
              state: "blocked",
              taskTitle: "B をやる",
            },
          ],
        },
      ],
      workers: [
        {
          dispatchId: "ctx_a",
          workspace: "repo::shared",
          outcome: "in_progress",
          assigneePaneKey: withPaneKeys ? "pane-a" : undefined,
        },
        // タブを移して paneKey の後ろが変わっても、含まれるセッション ID で見分ける。
        {
          dispatchId: "ctx_b",
          workspace: "repo::shared",
          outcome: "in_progress",
          assigneePaneKey: withPaneKeys ? `x-${sid(3)}:moved` : undefined,
        },
      ],
    },
    NOW,
  );
}

test("同じ worktree の worker は assigneePaneKey でそれぞれの担当エージェントに結ぶ", () => {
  const s = sharedWorktree(true);
  const label = (id: string) => s.nodes.find((n) => n.id === id)?.label;
  assert.deepEqual(
    s.inFlight.map((f) => [f.id, label(f.from), label(f.to), f.subject]).sort(),
    [
      ["ctx_a", "coordinator", "worker-a", "A をやる"],
      ["ctx_b", "coordinator", "worker-b", "B をやる"],
    ],
  );
  assert.deepEqual(s.nodes.map((n) => [n.label, n.kind]).sort(), [
    ["coordinator", "agent"],
    ["worker-a", "worker"],
    ["worker-b", "worker"],
  ]);
});

test("担当を決められない worker は、先頭のエージェントに結ばずに出さない", () => {
  const s = sharedWorktree(false);
  assert.deepEqual(s.inFlight, []);
  assert.ok(
    !s.nodes.some((n) => n.label === "coordinator" && n.kind === "worker"),
  );
});

test("終わった dispatch は担当キーで結び、ペインが消えた worker を残った worker に結ばない", () => {
  const sid = (n: number) => `00000000-0000-4000-9000-00000000000${n}`;
  const s = buildSnapshot(
    {
      messages: [],
      bots: [],
      items: [],
      worktrees: [
        {
          worktreeId: "repo::shared",
          agents: [
            {
              orcaSessionId: sid(1),
              paneKey: "pane-c",
              displayName: "coordinator",
              state: "working",
            },
            // worker-b のペインは閉じていて、worker-a だけが残っている。
            {
              orcaSessionId: sid(2),
              paneKey: "pane-a",
              parentPaneKey: "pane-c",
              displayName: "worker-a",
              state: "done",
              stateStartedAt: NOW - 60_000,
            },
          ],
        },
      ],
      workers: [
        {
          dispatchId: "ctx_a",
          workspace: "repo::shared",
          outcome: "succeeded",
          assigneePaneKey: "pane-a",
        },
        {
          dispatchId: "ctx_b",
          workspace: "repo::shared",
          outcome: "succeeded",
          assigneePaneKey: "pane-b",
        },
        // 担当を引けていない終わった dispatch も、残った worker に結ばない。
        {
          dispatchId: "ctx_c",
          workspace: "repo::shared",
          outcome: "succeeded",
        },
      ],
    },
    NOW,
  );
  const label = (id: string) => s.nodes.find((n) => n.id === id)?.label;
  assert.deepEqual(
    s.recent.map((f) => [f.id, label(f.from), label(f.to)]),
    [["ctx_a", "coordinator", "worker-a"]],
  );
});

test("Need You の行に開く先を付ける（チャットはワークスペース、ターミナルはペインまで）", () => {
  const s = buildSnapshot(
    {
      messages: [],
      workers: [],
      worktrees: [
        {
          worktreeId: "repo::/w/chat",
          agents: [
            {
              orcaSessionId: "chat",
              paneKey: "structured-agent-session-chat:tab1",
              activity: { status: "waiting" },
            },
          ],
        },
        {
          worktreeId: "repo::/w/term",
          agents: [
            {
              orcaSessionId: "term",
              paneKey: "tab2:leaf2",
              activity: { status: "blocked" },
            },
          ],
        },
        {
          worktreeId: "folder:home-1",
          bot: "Home",
          botHome: true,
          agents: [],
        },
        // ボットの名前が付いた worktree でも、ホームでないものは開く先にしない。
        { worktreeId: "repo::/w/side", bot: "Home", agents: [] },
      ],
      bots: ["Home", "Homeless"],
      items: [
        { bot: "Home", number: 7, title: "見て", status: "needs_you" },
        { bot: "Homeless", number: 8, title: "見て", status: "needs-you" },
      ],
    },
    NOW,
  );
  const byId = new Map(s.needsYou.map((n) => [n.id, n]));
  assert.deepEqual(byId.get("agent:term")?.target, {
    workspaceId: "repo::/w/term",
    paneKey: "tab2:leaf2",
  });
  assert.deepEqual(byId.get("agent:chat")?.target, {
    workspaceId: "repo::/w/chat",
  });
  assert.deepEqual(byId.get("item:Home:7")?.target, {
    workspaceId: "folder:home-1",
  });
  assert.equal(byId.get("item:Home:7")?.item, 7);
  assert.equal(byId.get("item:Homeless:8")?.target, undefined);
  assert.equal(byId.get("item:Homeless:8")?.item, 8);
});

test("worktreeId の無いエージェントの Need には開く先を付けない", () => {
  const s = buildSnapshot(
    {
      messages: [],
      workers: [],
      worktrees: [
        {
          agents: [{ orcaSessionId: "x", activity: { status: "waiting" } }],
        },
      ],
      bots: [],
      items: [],
    },
    NOW,
  );
  assert.equal(s.needsYou[0]?.target, undefined);
});
