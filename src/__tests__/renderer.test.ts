import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ChatRenderer, renderStatusBar } from "../renderer.ts";
import type { ChatMessage, AgentState, AgentPersona } from "../types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Identity theme functions — just pass through so we can assert on structure */
const fg = (color: string, text: string) => `[${color}]${text}[/${color}]`;
const bold = (text: string) => `<b>${text}</b>`;

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: overrides.id ?? "msg-1",
    from: overrides.from ?? "dev",
    mentions: overrides.mentions ?? [],
    content: overrides.content ?? "hello world",
    timestamp: overrides.timestamp ?? new Date("2026-01-15T14:30:00Z").getTime(),
    type: overrides.type ?? "text",
    ...overrides,
  };
}

function makePersona(overrides: Partial<AgentPersona> = {}): AgentPersona {
  return {
    name: overrides.name ?? "dev",
    avatar: overrides.avatar ?? "🧑‍🚀",
    specialization: overrides.specialization ?? "Generalist",
    description: overrides.description ?? "A dev",
    systemPrompt: overrides.systemPrompt ?? "You are dev.",
    ...overrides,
  };
}

function makeAgentState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    persona: overrides.persona ?? makePersona(),
    session: {} as AgentState["session"], // stub — renderer never touches session
    status: overrides.status ?? "idle",
    focusTopics: overrides.focusTopics ?? [],
    ignoredMessageIds: overrides.ignoredMessageIds ?? new Set(),
    lastActive: overrides.lastActive ?? Date.now(),
    messageCount: overrides.messageCount ?? 0,
    turnInProgress: overrides.turnInProgress ?? false,
    ...overrides,
  };
}

function makeAgentMap(...agents: AgentState[]): Map<string, AgentState> {
  const map = new Map<string, AgentState>();
  for (const a of agents) {
    map.set(a.persona.name.toLowerCase(), a);
  }
  return map;
}

// ---------------------------------------------------------------------------
// ChatRenderer
// ---------------------------------------------------------------------------

describe("ChatRenderer", () => {
  let renderer: ChatRenderer;
  let agents: Map<string, AgentState>;

  beforeEach(() => {
    renderer = new ChatRenderer();
    agents = makeAgentMap(
      makeAgentState({ persona: makePersona({ name: "dev", avatar: "🧑‍🚀" }) }),
      makeAgentState({ persona: makePersona({ name: "elena", avatar: "👩‍🔬" }) }),
    );
  });

  // --- renderChatMessage: system messages ---

  describe("renderChatMessage — system messages", () => {
    it("should_render_system_message_with_announcement_icon", () => {
      const msg = makeMessage({ type: "system", from: "system", content: "agent joined" });
      const result = renderer.renderChatMessage(msg, fg, bold, agents);
      assert.ok(result.includes("📢"), "Should contain announcement icon");
      assert.ok(result.includes("agent joined"), "Should contain message content");
    });

    it("should_render_system_message_with_dim_color", () => {
      const msg = makeMessage({ type: "system", from: "system", content: "test" });
      const result = renderer.renderChatMessage(msg, fg, bold, agents);
      assert.ok(result.includes("[dim]"), "Should use dim color for system messages");
    });
  });

  // --- renderChatMessage: user messages ---

  describe("renderChatMessage — user messages", () => {
    it("should_render_user_message_with_you_label", () => {
      const msg = makeMessage({ from: "user", content: "hello team" });
      const result = renderer.renderChatMessage(msg, fg, bold, agents);
      assert.ok(result.includes("👤 You"), "Should show '👤 You' for user messages");
    });

    it("should_render_user_message_with_accent_color", () => {
      const msg = makeMessage({ from: "user", content: "hello" });
      const result = renderer.renderChatMessage(msg, fg, bold, agents);
      assert.ok(result.includes("[accent]"), "Should use accent color for user header");
    });

    it("should_highlight_mentions_in_user_message", () => {
      const msg = makeMessage({ from: "user", content: "hey @elena check this" });
      const result = renderer.renderChatMessage(msg, fg, bold, agents);
      assert.ok(result.includes("@elena"), "Should contain the mention");
    });
  });

  // --- renderChatMessage: agent messages ---

  describe("renderChatMessage — agent messages", () => {
    it("should_render_agent_avatar_from_agent_map", () => {
      const msg = makeMessage({ from: "dev", content: "on it" });
      const result = renderer.renderChatMessage(msg, fg, bold, agents);
      assert.ok(result.includes("🧑‍🚀"), "Should use agent's avatar from the map");
    });

    it("should_fallback_to_robot_emoji_when_agent_not_in_map", () => {
      const msg = makeMessage({ from: "unknown-agent", content: "hi" });
      const result = renderer.renderChatMessage(msg, fg, bold, new Map());
      assert.ok(result.includes("🤖"), "Should fallback to 🤖 for unknown agents");
    });

    it("should_render_agent_name_in_header", () => {
      const msg = makeMessage({ from: "elena", content: "tests pass" });
      const result = renderer.renderChatMessage(msg, fg, bold, agents);
      assert.ok(result.includes("elena"), "Should show agent name");
    });

    it("should_include_message_content", () => {
      const msg = makeMessage({ from: "dev", content: "shipping it" });
      const result = renderer.renderChatMessage(msg, fg, bold, agents);
      assert.ok(result.includes("shipping it"), "Should include message content");
    });
  });

  // --- renderChatMessage: replyTo ---

  describe("renderChatMessage — replyTo", () => {
    it("should_render_reply_preview_when_original_message_found", () => {
      const original = makeMessage({ id: "msg-original", from: "elena", content: "should we add tests?" });
      const reply = makeMessage({ from: "dev", content: "yes definitely", replyTo: "msg-original" });
      const resolve = (id: string) => (id === "msg-original" ? original : undefined);
      const result = renderer.renderChatMessage(reply, fg, bold, agents, resolve);
      assert.ok(result.includes("replying to elena"), "Should show who is being replied to");
      assert.ok(result.includes("should we add tests?"), "Should show preview of original");
    });

    it("should_truncate_reply_preview_when_original_is_long", () => {
      const longContent = "a".repeat(100);
      const original = makeMessage({ id: "msg-original", from: "elena", content: longContent });
      const reply = makeMessage({ from: "dev", content: "agreed", replyTo: "msg-original" });
      const resolve = (id: string) => (id === "msg-original" ? original : undefined);
      const result = renderer.renderChatMessage(reply, fg, bold, agents, resolve);
      assert.ok(result.includes("…"), "Should truncate long replies with ellipsis");
      // The preview should be 60 chars max + ellipsis
      assert.ok(!result.includes(longContent), "Should NOT contain the full 100-char content");
    });

    it("should_show_message_id_when_original_not_found", () => {
      const reply = makeMessage({ from: "dev", content: "yes", replyTo: "msg-deleted" });
      const resolve = (_id: string) => undefined;
      const result = renderer.renderChatMessage(reply, fg, bold, agents, resolve);
      assert.ok(result.includes("msg-deleted"), "Should show raw message ID as fallback");
    });

    it("should_show_message_id_when_resolveMessage_is_not_provided", () => {
      const reply = makeMessage({ from: "dev", content: "yes", replyTo: "msg-orphan" });
      const result = renderer.renderChatMessage(reply, fg, bold, agents);
      assert.ok(result.includes("msg-orphan"), "Should show raw ID when no resolver given");
    });

    it("should_not_render_reply_line_when_no_replyTo", () => {
      const msg = makeMessage({ from: "dev", content: "just a normal message" });
      const result = renderer.renderChatMessage(msg, fg, bold, agents);
      assert.ok(!result.includes("replying to"), "Should not have reply line for normal messages");
      assert.ok(!result.includes("↳"), "Should not have reply arrow for normal messages");
    });
  });

  // --- renderChatMessage: color assignment ---

  describe("renderChatMessage — color assignment", () => {
    it("should_assign_consistent_color_to_same_agent", () => {
      const msg1 = makeMessage({ id: "msg-1", from: "dev", content: "first" });
      const msg2 = makeMessage({ id: "msg-2", from: "dev", content: "second" });
      const result1 = renderer.renderChatMessage(msg1, fg, bold, agents);
      const result2 = renderer.renderChatMessage(msg2, fg, bold, agents);
      // Both should use the same color tag in the header
      const colorMatch1 = result1.match(/\[(\w+)\]<b>/);
      const colorMatch2 = result2.match(/\[(\w+)\]<b>/);
      assert.ok(colorMatch1 && colorMatch2, "Should have color tags");
      assert.equal(colorMatch1![1], colorMatch2![1], "Same agent should get same color across messages");
    });

    it("should_assign_different_colors_to_different_agents", () => {
      const msg1 = makeMessage({ id: "msg-1", from: "dev", content: "hi" });
      const msg2 = makeMessage({ id: "msg-2", from: "elena", content: "hi" });
      renderer.renderChatMessage(msg1, fg, bold, agents);
      renderer.renderChatMessage(msg2, fg, bold, agents);
      // They should get different colors (first two from the palette)
      const result1 = renderer.renderChatMessage(makeMessage({ from: "dev", content: "x" }), fg, bold, agents);
      const result2 = renderer.renderChatMessage(makeMessage({ from: "elena", content: "x" }), fg, bold, agents);
      const color1 = result1.match(/\[(\w+)\]<b>/)?.[1];
      const color2 = result2.match(/\[(\w+)\]<b>/)?.[1];
      assert.ok(color1 && color2, "Both agents should have color tags");
      assert.notEqual(color1, color2, "Different agents should get different colors");
    });
  });

  // --- renderChatView ---

  describe("renderChatView", () => {
    it("should_return_empty_array_for_no_messages", () => {
      const result = renderer.renderChatView([], fg, bold, agents);
      assert.deepStrictEqual(result, []);
    });

    it("should_render_each_message_followed_by_empty_line", () => {
      const messages = [
        makeMessage({ id: "msg-1", from: "dev", content: "first" }),
        makeMessage({ id: "msg-2", from: "elena", content: "second" }),
      ];
      const result = renderer.renderChatView(messages, fg, bold, agents);
      // Each message produces 2 entries: rendered message + empty string
      assert.equal(result.length, 4, "Should have 2 messages × 2 lines each");
      assert.equal(result[1], "", "Should have empty line after first message");
      assert.equal(result[3], "", "Should have empty line after second message");
    });

    it("should_respect_maxMessages_parameter", () => {
      const messages = [
        makeMessage({ id: "msg-1", content: "old" }),
        makeMessage({ id: "msg-2", content: "newer" }),
        makeMessage({ id: "msg-3", content: "newest" }),
      ];
      const result = renderer.renderChatView(messages, fg, bold, agents, 2);
      // Only the last 2 messages should be rendered (4 lines: 2 messages × 2)
      assert.equal(result.length, 4, "Should only render last 2 messages");
      assert.ok(!result.some((l) => l.includes("old")), "Should not include the oldest message");
      assert.ok(result.some((l) => l.includes("newest")), "Should include the newest message");
    });

    it("should_default_maxMessages_to_50", () => {
      // Create 55 messages
      const messages = Array.from({ length: 55 }, (_, i) =>
        makeMessage({ id: `msg-${i}`, content: `message-${i}` }),
      );
      const result = renderer.renderChatView(messages, fg, bold, agents);
      // 50 messages × 2 lines each = 100
      assert.equal(result.length, 100, "Should render at most 50 messages (100 lines)");
      assert.ok(!result.some((l) => l.includes("message-0")), "Should drop earliest messages");
      assert.ok(result.some((l) => l.includes("message-54")), "Should include latest message");
    });

    it("should_pass_resolveMessage_to_each_message_render", () => {
      const original = makeMessage({ id: "msg-orig", from: "elena", content: "original text" });
      const reply = makeMessage({ id: "msg-reply", from: "dev", content: "reply text", replyTo: "msg-orig" });
      const resolve = (id: string) => (id === "msg-orig" ? original : undefined);
      const result = renderer.renderChatView([reply], fg, bold, agents, 50, resolve);
      assert.ok(result.some((l) => l.includes("replying to elena")), "Should resolve reply in chat view");
    });

    it("should_skip_tool_activity_messages", () => {
      const messages = [
        makeMessage({ id: "msg-1", from: "dev", content: "hello" }),
        makeMessage({ id: "msg-2", type: "tool_activity", from: "elena", content: "wrote src/foo.ts", toolName: "write" }),
        makeMessage({ id: "msg-3", type: "tool_activity", from: "elena", content: "$ npm test", toolName: "bash" }),
        makeMessage({ id: "msg-4", from: "dev", content: "nice" }),
      ];
      const result = renderer.renderChatView(messages, fg, bold, agents);
      // Only 2 regular messages rendered, each with separator = 4 lines
      assert.equal(result.length, 4, "Should skip tool_activity messages entirely");
      assert.ok(!result.some((l) => l.includes("wrote src/foo.ts")), "Should not include tool activity content");
      assert.ok(!result.some((l) => l.includes("npm test")), "Should not include tool activity content");
    });
  });
});

// ---------------------------------------------------------------------------
// renderStatusBar
// ---------------------------------------------------------------------------

describe("renderStatusBar", () => {
  function makeAgentMap(...agents: AgentState[]): Map<string, AgentState> {
    const map = new Map<string, AgentState>();
    for (const a of agents) {
      map.set(a.persona.name.toLowerCase(), a);
    }
    return map;
  }

  it("should_render_roster_with_agent_avatars_and_names", () => {
    const agents = makeAgentMap(
      makeAgentState({ persona: makePersona({ name: "dev", avatar: "🧑‍🚀" }) }),
    );
    const result = renderStatusBar(agents, new Set(), fg);
    const roster = result[result.length - 1];
    assert.ok(roster.includes("🧑‍🚀"), "Should include agent avatar");
    assert.ok(roster.includes("dev"), "Should include agent name");
  });

  it("should_show_thinking_icon_for_thinking_agents", () => {
    const agents = makeAgentMap(
      makeAgentState({ persona: makePersona({ name: "dev" }), status: "thinking" }),
    );
    const result = renderStatusBar(agents, new Set(), fg);
    const roster = result[0];
    assert.ok(roster.includes("💭"), "Should show thinking icon");
    assert.ok(!roster.includes("thinking"), "Should NOT show text label — icon is enough");
    assert.ok(roster.includes("[warning]"), "Should use warning color for thinking");
  });

  it("should_show_working_icon_for_working_agents", () => {
    const agents = makeAgentMap(
      makeAgentState({ persona: makePersona({ name: "dev" }), status: "working" }),
    );
    const result = renderStatusBar(agents, new Set(), fg);
    const roster = result[0];
    assert.ok(roster.includes("⚡"), "Should show working icon");
    assert.ok(!roster.includes("working"), "Should NOT show text label — icon is enough");
    assert.ok(roster.includes("[success]"), "Should use success color for working");
  });

  it("should_show_paused_icon_for_paused_agents", () => {
    const agents = makeAgentMap(
      makeAgentState({ persona: makePersona({ name: "dev" }), status: "paused" }),
    );
    const result = renderStatusBar(agents, new Set(), fg);
    const roster = result[result.length - 1];
    assert.ok(roster.includes("⏸️"), "Should show paused icon");
    assert.ok(!roster.includes("paused"), "Should NOT show text label — icon is enough");
  });

  it("should_show_dot_for_idle_agents", () => {
    const agents = makeAgentMap(
      makeAgentState({ persona: makePersona({ name: "dev" }), status: "idle" }),
    );
    const result = renderStatusBar(agents, new Set(), fg);
    const roster = result[0];
    assert.ok(roster.includes("dev"), "Should show agent name");
    assert.ok(roster.includes("●"), "Should show dot for idle agent");
    assert.ok(roster.includes("[dim]"), "Should use dim color for idle");
  });

  it("should_show_message_count_when_greater_than_zero", () => {
    const agents = makeAgentMap(
      makeAgentState({ persona: makePersona({ name: "dev" }), messageCount: 5 }),
    );
    const result = renderStatusBar(agents, new Set(), fg);
    const roster = result[result.length - 1];
    assert.ok(roster.includes("(5)"), "Should show message count");
  });

  it("should_not_show_message_count_when_zero", () => {
    const agents = makeAgentMap(
      makeAgentState({ persona: makePersona({ name: "dev" }), messageCount: 0 }),
    );
    const result = renderStatusBar(agents, new Set(), fg);
    const roster = result[result.length - 1];
    assert.ok(!roster.includes("(0)"), "Should not show (0) message count");
  });

  it("should_show_replying_indicator_when_idle_agent_is_typing", () => {
    const agents = makeAgentMap(
      makeAgentState({ persona: makePersona({ name: "dev", avatar: "🧑‍🚀" }), status: "idle" }),
    );
    const typing = new Set(["dev"]);
    const result = renderStatusBar(agents, typing, fg);
    assert.equal(result.length, 1, "Should be a single line");
    assert.ok(result[0].includes("✍️"), "Should show replying icon for typing agent");
    assert.ok(!result[0].includes("replying"), "Should NOT show text label — icon is enough");
    assert.ok(result[0].includes("[accent]"), "Should use accent color for replying");
  });

  it("should_prefer_status_over_typing_when_agent_is_thinking", () => {
    const agents = makeAgentMap(
      makeAgentState({ persona: makePersona({ name: "dev" }), status: "thinking" }),
    );
    const typing = new Set(["dev"]);
    const result = renderStatusBar(agents, typing, fg);
    assert.ok(result[0].includes("💭"), "Should show thinking icon over typing");
    assert.ok(!result[0].includes("thinking"), "Should NOT show text label — icon is enough");
  });

  it("should_use_dim_color_for_idle_non_typing_agents", () => {
    const agents = makeAgentMap(
      makeAgentState({ persona: makePersona({ name: "dev" }), status: "idle" }),
    );
    const result = renderStatusBar(agents, new Set(), fg);
    assert.ok(result[0].includes("[dim]"), "Should use dim color for idle non-typing agent");
  });

  it("should_use_muted_color_for_paused_agents", () => {
    const agents = makeAgentMap(
      makeAgentState({ persona: makePersona({ name: "dev" }), status: "paused" }),
    );
    const result = renderStatusBar(agents, new Set(), fg);
    const roster = result[result.length - 1];
    assert.ok(roster.includes("[muted]"), "Should use muted color for paused agent");
  });

  it("should_return_single_line", () => {
    const agents = makeAgentMap(
      makeAgentState({ persona: makePersona({ name: "dev" }) }),
      makeAgentState({ persona: makePersona({ name: "elena" }) }),
    );
    const typing = new Set(["dev"]);
    const result = renderStatusBar(agents, typing, fg);
    assert.equal(result.length, 1, "Should always return exactly one line");
  });

  it("should_render_multiple_agents_in_roster", () => {
    const agents = makeAgentMap(
      makeAgentState({ persona: makePersona({ name: "dev", avatar: "🧑‍🚀" }) }),
      makeAgentState({ persona: makePersona({ name: "elena", avatar: "👩‍🔬" }) }),
    );
    const result = renderStatusBar(agents, new Set(), fg);
    const roster = result[result.length - 1];
    assert.ok(roster.includes("dev"), "Should include first agent");
    assert.ok(roster.includes("elena"), "Should include second agent");
  });
});
