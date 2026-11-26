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
