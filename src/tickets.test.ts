import { assert, test } from "orca/testing";
import { DEMO_IDS as ids, demoSources } from "./demo";
import { buildSnapshot } from "./model";
import { itemTickets, ticketLabel, worktreeTickets } from "./tickets";

const NOW = Date.UTC(2030, 0, 1, 12, 0, 0);
const PR_URL = "https://github.example.com/demo/app/pull/12";

test("表示名: Linear と Jira は identifier、それ以外は PR # / MR ! / Issue #", () => {
  const label = (provider: string, type: string, identifier?: string) =>
    ticketLabel({ provider, type, number: 12, identifier });
  assert.equal(label("linear", "issue", "ABC-123"), "ABC-123");
  assert.equal(label("jira", "issue", "ABC-124"), "ABC-124");
  assert.equal(label("github", "pr"), "PR #12");
  assert.equal(label("gitlab", "mr"), "MR !12");
  assert.equal(label("github", "issue"), "Issue #12");
  // identifier の無い Linear は番号だけ、番号も種類も分からないものは出さない。
  assert.equal(label("linear", "issue"), "#12");
  assert.equal(ticketLabel({ provider: "github", type: "pr" }), null);
  assert.equal(
    ticketLabel({ provider: "github", type: "wiki", number: 1 }),
    null,
  );
});

test("linkedItems と linkedPR の同じ PR は 1 つにまとめる", () => {
  const tickets = worktreeTickets({
    linkedItems: [
      { provider: "jira", type: "issue", identifier: "ABC-124" },
      { provider: "github", type: "pr", number: 12 },
    ],
    linkedPR: { number: 12, title: "ダミー", url: PR_URL },
  });
  assert.deepEqual(tickets, [
    { label: "ABC-124", provider: "jira" },
    // URL は持っているほうから補う。
    { label: "PR #12", provider: "github", url: PR_URL },
  ]);
});

test("古い単一スロットは、linkedItems に同じものが無いときだけ使う", () => {
  assert.deepEqual(
    worktreeTickets({
      linkedItems: [
        {
          provider: "linear",
          type: "issue",
          identifier: "ABC-123",
          url: "https://linear.example.com/demo/issue/ABC-123",
        },
      ],
      linkedLinearIssue: "ABC-123",
      linkedIssue: 5,
      linkedGitLabMR: 6,
    }),
    [
      {
        label: "ABC-123",
        provider: "linear",
        url: "https://linear.example.com/demo/issue/ABC-123",
      },
      { label: "Issue #5", provider: "github" },
      { label: "MR !6", provider: "gitlab" },
    ],
  );
  assert.deepEqual(
    worktreeTickets({ linkedItems: null, linkedIssue: null }),
    [],
  );
});

test("http(s) でない URL は持たせない（押せないバッジになる）", () => {
  assert.deepEqual(
    worktreeTickets({
      linkedItems: [
        {
          provider: "github",
          type: "pr",
          number: 1,
          url: "javascript:alert(1)",
        },
      ],
    }),
    [{ label: "PR #1", provider: "github" }],
  );
});

test("Item のチケットは links にある PR だけ", () => {
  assert.deepEqual(
    itemTickets([{ pr: { number: 7, url: PR_URL } }, { pr: null }, {}]),
    [{ label: "PR #7", provider: "github", url: PR_URL }],
  );
  assert.deepEqual(itemTickets(undefined), []);
});

test("エージェントと worker のノードは、そのセッションの worktree のチケットを持つ", () => {
  const s = buildSnapshot(demoSources(NOW), NOW);
  assert.deepEqual(
    s.tickets[ids.planner].map((t) => t.label),
    ["ABC-123"],
  );
  assert.deepEqual(
    s.tickets[ids.builderA].map((t) => t.label),
    ["ABC-124", "PR #12"],
  );
  // チケットの無いノードは載せない。
  assert.deepEqual(Object.keys(s.tickets).sort(), [ids.planner, ids.builderA]);
});

test("NEEDS YOU の行: agent はその worktree、Item は links の PR", () => {
  const s = buildSnapshot(demoSources(NOW), NOW);
  const of = (id: string) =>
    s.needsYou.find((n) => n.id === id)?.tickets?.map((t) => t.label);
  assert.deepEqual(of(`agent:${ids.builderA}`), ["ABC-124", "PR #12"]);
  assert.deepEqual(of("item:Scheduler:3"), ["PR #7"]);
  assert.equal(of(`agent:${ids.researcher}`), undefined);
});

test("ボットのノードはホームの worktree のチケットだけ（他のセッション分はまとめない）", () => {
  const raw = demoSources(NOW);
  const item = (identifier: string) => ({
    provider: "linear",
    type: "issue",
    identifier,
  });
  raw.worktrees.push({
    worktreeId: "folder:concierge-home",
    bot: "Concierge",
    botHome: true,
    linkedItems: [item("ABC-200")],
  });
  const chat = raw.worktrees.find((w) => w.worktreeId === "repo::concierge");
  if (chat) chat.linkedItems = [item("ABC-201")];
  // worker の worktree にもボット名が付くが、worker 自身のノードに出す。
  const worker = raw.worktrees.find((w) => w.worktreeId === "repo::demo-b");
  if (worker) worker.linkedItems = [item("ABC-202")];
  const s = buildSnapshot(raw, NOW);
  assert.deepEqual(s.tickets["bot:Concierge"], [
    { label: "ABC-200", provider: "linear" },
  ]);
  assert.deepEqual(s.tickets[ids.builderB], [
    { label: "ABC-202", provider: "linear" },
  ]);
});
