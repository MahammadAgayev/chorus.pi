import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { FocusManager } from "../focus-manager.ts";
import type { ChatMessage } from "../types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: overrides.id ?? "msg-1",
    from: overrides.from ?? "someone",
    mentions: overrides.mentions ?? [],
    content: overrides.content ?? "hello world",
    timestamp: overrides.timestamp ?? Date.now(),
    type: overrides.type ?? "text",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// FocusManager
// ---------------------------------------------------------------------------

describe("FocusManager", () => {
  let focus: FocusManager;

  beforeEach(() => {
    focus = new FocusManager("kai");
  });

  // --- ignoreMessage / unignoreMessage ---

  describe("ignoreMessage", () => {
    it("should_add_id_to_ignored_set", () => {
      focus.ignoreMessage("msg-1");
      assert.ok(focus.getIgnoredIds().has("msg-1"));
    });

    it("should_handle_ignoring_same_id_twice", () => {
      focus.ignoreMessage("msg-1");
      focus.ignoreMessage("msg-1");
      assert.equal(focus.getIgnoredIds().size, 1);
    });
  });

  describe("unignoreMessage", () => {
    it("should_remove_id_from_ignored_set", () => {
      focus.ignoreMessage("msg-1");
      focus.unignoreMessage("msg-1");
      assert.ok(!focus.getIgnoredIds().has("msg-1"));
    });

    it("should_not_throw_when_unignoring_unknown_id", () => {
      assert.doesNotThrow(() => focus.unignoreMessage("nonexistent"));
    });
  });

  // --- setFocusTopics / clearFocus ---

  describe("setFocusTopics", () => {
    it("should_set_topics", () => {
      focus.setFocusTopics(["auth", "database"]);
      assert.deepStrictEqual([...focus.getFocusTopics()], ["auth", "database"]);
    });

    it("should_replace_previous_topics", () => {
      focus.setFocusTopics(["auth"]);
      focus.setFocusTopics(["database"]);
      assert.deepStrictEqual([...focus.getFocusTopics()], ["database"]);
    });
  });

  describe("clearFocus", () => {
    it("should_clear_all_topics", () => {
      focus.setFocusTopics(["auth", "database"]);
      focus.clearFocus();
      assert.equal(focus.getFocusTopics().length, 0);
    });
  });

  // --- shouldInclude ---

  describe("shouldInclude", () => {
    // Priority 1: ignored messages are always excluded
    it("should_exclude_ignored_messages", () => {
      focus.ignoreMessage("msg-1");
      const msg = makeMessage({ id: "msg-1" });
      assert.equal(focus.shouldInclude(msg), false);
    });

    it("should_exclude_ignored_message_even_if_agent_is_mentioned", () => {
      focus.ignoreMessage("msg-1");
      const msg = makeMessage({ id: "msg-1", mentions: ["kai"] });
      assert.equal(focus.shouldInclude(msg), false);
    });

    it("should_exclude_ignored_message_even_if_from_self", () => {
      focus.ignoreMessage("msg-1");
      const msg = makeMessage({ id: "msg-1", from: "kai" });
      assert.equal(focus.shouldInclude(msg), false);
    });

    // Priority 2: @mentioned → always included
    it("should_include_message_that_mentions_agent", () => {
      const msg = makeMessage({ mentions: ["kai"] });
      assert.equal(focus.shouldInclude(msg), true);
    });

    it("should_include_mentioned_message_even_with_focus_topics_set", () => {
      focus.setFocusTopics(["database"]);
      const msg = makeMessage({ mentions: ["kai"], content: "hey check this" });
      assert.equal(focus.shouldInclude(msg), true);
    });

    // Priority 3: own messages → always included
    it("should_include_messages_from_self", () => {
      const msg = makeMessage({ from: "kai" });
      assert.equal(focus.shouldInclude(msg), true);
    });

    it("should_include_own_message_even_with_focus_topics_set", () => {
      focus.setFocusTopics(["database"]);
      const msg = makeMessage({ from: "kai", content: "unrelated stuff" });
      assert.equal(focus.shouldInclude(msg), true);
    });

    // Priority 4: system/join/leave → always included
    it("should_include_system_messages", () => {
      const msg = makeMessage({ type: "system" });
      assert.equal(focus.shouldInclude(msg), true);
    });

    it("should_include_join_messages", () => {
      const msg = makeMessage({ type: "join" });
      assert.equal(focus.shouldInclude(msg), true);
    });

    it("should_include_leave_messages", () => {
      const msg = makeMessage({ type: "leave" });
      assert.equal(focus.shouldInclude(msg), true);
    });

    it("should_include_system_messages_even_with_focus_topics_set", () => {
      focus.setFocusTopics(["database"]);
      const msg = makeMessage({ type: "system", content: "agent joined" });
      assert.equal(focus.shouldInclude(msg), true);
    });

    // Priority 5: focus topics → filter by content
    it("should_include_message_matching_focus_topic", () => {
      focus.setFocusTopics(["auth"]);
      const msg = makeMessage({ content: "I'm working on the auth module" });
      assert.equal(focus.shouldInclude(msg), true);
    });

    it("should_exclude_message_not_matching_any_focus_topic", () => {
      focus.setFocusTopics(["auth"]);
      const msg = makeMessage({ content: "fixing the CSS layout" });
      assert.equal(focus.shouldInclude(msg), false);
    });

    it("should_match_focus_topics_case_insensitively", () => {
      focus.setFocusTopics(["Auth"]);
      const msg = makeMessage({ content: "the AUTH module needs work" });
      assert.equal(focus.shouldInclude(msg), true);
    });

    it("should_include_if_any_topic_matches", () => {
      focus.setFocusTopics(["auth", "database"]);
      const msg = makeMessage({ content: "database migration is ready" });
      assert.equal(focus.shouldInclude(msg), true);
    });

    // No focus topics → include everything
    it("should_include_all_messages_when_no_focus_topics", () => {
      const msg = makeMessage({ content: "random chatter" });
      assert.equal(focus.shouldInclude(msg), true);
    });

    it("should_include_all_messages_after_clearing_focus", () => {
      focus.setFocusTopics(["auth"]);
      focus.clearFocus();
      const msg = makeMessage({ content: "unrelated stuff" });
      assert.equal(focus.shouldInclude(msg), true);
    });

    // Edge: tool_activity and status types are not in the bypass list
    it("should_filter_tool_activity_by_focus_topics", () => {
      focus.setFocusTopics(["auth"]);
      const msg = makeMessage({ type: "tool_activity", content: "edited styles.css" });
      assert.equal(focus.shouldInclude(msg), false);
    });

    it("should_filter_status_messages_by_focus_topics", () => {
      focus.setFocusTopics(["auth"]);
      const msg = makeMessage({ type: "status", content: "agent is idle" });
      assert.equal(focus.shouldInclude(msg), false);
    });

    // Edge: own message matching is case-sensitive on from field
    it("should_not_recognize_own_message_when_from_field_case_differs_and_topics_set", () => {
      // Constructor sets agentName to "kai". With focus topics set,
      // messages not matching self/mentions/system must match a topic.
      // "Kai" !== "kai" so it won't be recognized as self.
      focus.setFocusTopics(["database"]);
      const msg = makeMessage({ from: "Kai", content: "unrelated stuff" });
      assert.equal(focus.shouldInclude(msg), false,
        "Case-sensitive from check means 'Kai' is not recognized as 'kai' — message filtered out by topics");
    });
  });

  // --- filterMessages ---

  describe("filterMessages", () => {
    it("should_return_empty_array_for_empty_input", () => {
      assert.deepStrictEqual(focus.filterMessages([]), []);
    });

    it("should_filter_out_ignored_messages", () => {
      focus.ignoreMessage("msg-2");
      const messages = [
        makeMessage({ id: "msg-1", content: "keep" }),
        makeMessage({ id: "msg-2", content: "drop" }),
        makeMessage({ id: "msg-3", content: "keep" }),
      ];
      const result = focus.filterMessages(messages);
      assert.equal(result.length, 2);
      assert.equal(result[0].content, "keep");
      assert.equal(result[1].content, "keep");
    });

    it("should_apply_focus_topic_filtering", () => {
      focus.setFocusTopics(["auth"]);
      const messages = [
        makeMessage({ id: "msg-1", content: "auth token expired" }),
        makeMessage({ id: "msg-2", content: "CSS looks great" }),
        makeMessage({ id: "msg-3", content: "auth middleware done" }),
      ];
      const result = focus.filterMessages(messages);
      assert.equal(result.length, 2);
      assert.equal(result[0].content, "auth token expired");
      assert.equal(result[1].content, "auth middleware done");
    });

    it("should_preserve_order", () => {
      const messages = [
        makeMessage({ id: "msg-1", content: "first" }),
        makeMessage({ id: "msg-2", content: "second" }),
        makeMessage({ id: "msg-3", content: "third" }),
      ];
      const result = focus.filterMessages(messages);
      assert.equal(result[0].content, "first");
      assert.equal(result[1].content, "second");
      assert.equal(result[2].content, "third");
    });
  });
});
