import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ChatBus, parseMentions, generateMessageId } from "../chat-bus.ts";

// ---------------------------------------------------------------------------
// parseMentions
// ---------------------------------------------------------------------------

describe("parseMentions", () => {
  it("should_return_empty_array_when_no_mentions", () => {
    assert.deepStrictEqual(parseMentions("hello world"), []);
  });

  it("should_return_empty_array_for_empty_string", () => {
    assert.deepStrictEqual(parseMentions(""), []);
  });

  it("should_parse_single_mention", () => {
    assert.deepStrictEqual(parseMentions("hey @elena check this"), ["elena"]);
  });

  it("should_parse_multiple_mentions", () => {
    const result = parseMentions("@dev and @nadia please review");
    assert.deepStrictEqual(result, ["dev", "nadia"]);
  });

  it("should_deduplicate_mentions", () => {
    const result = parseMentions("@elena @elena @elena");
    assert.deepStrictEqual(result, ["elena"]);
  });

  it("should_lowercase_mentions", () => {
    const result = parseMentions("@Elena @DEV");
    assert.deepStrictEqual(result, ["elena", "dev"]);
  });

  it("should_parse_mentions_with_hyphens_and_underscores", () => {
    const result = parseMentions("@my-agent @another_agent");
    assert.deepStrictEqual(result, ["my-agent", "another_agent"]);
  });

  it("should_parse_mention_at_start_of_string", () => {
    assert.deepStrictEqual(parseMentions("@dev hello"), ["dev"]);
  });

  it("should_parse_mention_at_end_of_string", () => {
    assert.deepStrictEqual(parseMentions("hello @dev"), ["dev"]);
  });
  it("should_extract_word_after_at_sign_even_in_email_like_text", () => {
    // Known limitation: the regex does not distinguish @mentions from emails.
    // Documenting actual behavior, not desired behavior.
    const emailText = "email user" + "@" + "example.com";
    const result = parseMentions(emailText);
    assert.deepStrictEqual(result, ["example"]);
  });
});

// ---------------------------------------------------------------------------
// generateMessageId
// ---------------------------------------------------------------------------

describe("generateMessageId", () => {
  it("should_return_string_starting_with_msg_prefix", () => {
    const id = generateMessageId();
    assert.ok(id.startsWith("msg-"), `Expected id to start with 'msg-', got: ${id}`);
  });

  it("should_return_unique_ids_on_consecutive_calls", () => {
    const id1 = generateMessageId();
    const id2 = generateMessageId();
    assert.notEqual(id1, id2);
  });
});

// ---------------------------------------------------------------------------
// ChatBus
// ---------------------------------------------------------------------------

describe("ChatBus", () => {
  let bus: ChatBus;

  beforeEach(() => {
    bus = new ChatBus();
  });

  // --- post ---

  describe("post", () => {
    it("should_add_message_to_history", () => {
      bus.post("user", "hello");
      const history = bus.getHistory();
      assert.equal(history.length, 1);
      assert.equal(history[0].from, "user");
      assert.equal(history[0].content, "hello");
    });

    it("should_default_type_to_text", () => {
      const msg = bus.post("user", "hello");
      assert.equal(msg.type, "text");
    });

    it("should_use_provided_type", () => {
      const msg = bus.post("user", "hello", { type: "system" });
      assert.equal(msg.type, "system");
    });

    it("should_parse_mentions_automatically", () => {
      const msg = bus.post("user", "hey @elena and @dev");
      assert.deepStrictEqual(msg.mentions, ["elena", "dev"]);
    });

    it("should_set_timestamp", () => {
      const before = Date.now();
      const msg = bus.post("user", "hello");
      const after = Date.now();
      assert.ok(msg.timestamp >= before && msg.timestamp <= after);
    });

    it("should_set_replyTo_when_provided", () => {
      const msg = bus.post("user", "hello", { replyTo: "msg-1" });
      assert.equal(msg.replyTo, "msg-1");
    });

    it("should_generate_unique_ids", () => {
      const msg1 = bus.post("user", "first");
      const msg2 = bus.post("user", "second");
      assert.notEqual(msg1.id, msg2.id);
    });

    it("should_emit_message_event_to_listeners", () => {
      const received: unknown[] = [];
      bus.on("message", (msg) => received.push(msg));
      bus.post("user", "hello");
      assert.equal(received.length, 1);
    });

    it("should_handle_empty_content", () => {
      const msg = bus.post("user", "");
      assert.equal(msg.content, "");
      assert.deepStrictEqual(msg.mentions, []);
    });
  });

  // --- system ---

  describe("system", () => {
    it("should_post_with_system_type", () => {
      const msg = bus.system("agent joined");
      assert.equal(msg.type, "system");
      assert.equal(msg.from, "system");
    });
  });

  // --- on / emit ---

  describe("on", () => {
    it("should_call_listener_when_event_emitted", () => {
      let called = false;
      bus.on("message", () => { called = true; });
      bus.post("user", "hello");
      assert.ok(called);
    });

    it("should_return_unsubscribe_function", () => {
      const received: unknown[] = [];
      const unsub = bus.on("message", (msg) => received.push(msg));
      bus.post("user", "first");
      unsub();
      bus.post("user", "second");
      assert.equal(received.length, 1);
    });

    it("should_support_multiple_listeners", () => {
      let count = 0;
      bus.on("message", () => { count++; });
      bus.on("message", () => { count++; });
      bus.post("user", "hello");
      assert.equal(count, 2);
    });

    it("should_not_throw_when_listener_throws", () => {
      bus.on("message", () => { throw new Error("boom"); });
      // This should not throw
      assert.doesNotThrow(() => bus.post("user", "hello"));
    });

    it("should_still_call_remaining_listeners_when_one_throws", () => {
      let secondCalled = false;
      bus.on("message", () => { throw new Error("boom"); });
      bus.on("message", () => { secondCalled = true; });
      bus.post("user", "hello");
      assert.ok(secondCalled, "Second listener should still be called when first throws");
    });
  });

  // --- getHistory ---

  describe("getHistory", () => {
    it("should_return_empty_array_initially", () => {
      assert.deepStrictEqual([...bus.getHistory()], []);
    });

    it("should_return_messages_in_order", () => {
      bus.post("user", "first");
      bus.post("user", "second");
      bus.post("user", "third");
      const history = bus.getHistory();
      assert.equal(history.length, 3);
      assert.equal(history[0].content, "first");
      assert.equal(history[1].content, "second");
      assert.equal(history[2].content, "third");
    });
  });

  // --- getRecentMessages ---

  describe("getRecentMessages", () => {
    it("should_return_last_n_messages", () => {
      bus.post("user", "a");
      bus.post("user", "b");
      bus.post("user", "c");
      const recent = bus.getRecentMessages(2);
      assert.equal(recent.length, 2);
      assert.equal(recent[0].content, "b");
      assert.equal(recent[1].content, "c");
    });

    it("should_return_all_messages_when_count_exceeds_history", () => {
      bus.post("user", "only");
      const recent = bus.getRecentMessages(100);
      assert.equal(recent.length, 1);
    });

    it("should_return_empty_when_no_messages", () => {
      const recent = bus.getRecentMessages(5);
      assert.equal(recent.length, 0);
    });

    it("should_return_empty_when_count_is_zero", () => {
      bus.post("user", "a");
      bus.post("user", "b");
      const recent = bus.getRecentMessages(0);
      assert.equal(recent.length, 0, "Requesting 0 recent messages should return none");
    });
  });

  // --- getMessageById ---

  describe("getMessageById", () => {
    it("should_find_message_by_id", () => {
      const posted = bus.post("user", "find me");
      const found = bus.getMessageById(posted.id);
      assert.ok(found);
      assert.equal(found.content, "find me");
    });

    it("should_return_undefined_for_nonexistent_id", () => {
      const found = bus.getMessageById("does-not-exist");
      assert.equal(found, undefined);
    });
  });

  // --- clear ---

  describe("clear", () => {
    it("should_empty_the_history", () => {
      bus.post("user", "hello");
      const msg = bus.post("user", "world");
      bus.clear();
      assert.equal(bus.getHistory().length, 0);
    });

    it("should_clear_the_message_index_so_getMessageById_returns_undefined", () => {
      const msg = bus.post("user", "find me");
      assert.ok(bus.getMessageById(msg.id), "Message should exist before clear");
      bus.clear();
      assert.equal(bus.getMessageById(msg.id), undefined, "Message should not be found after clear");
    });
  });

  // --- typing events ---

  describe("typing events", () => {
    it("should_emit_typing_events", () => {
      const events: Array<{ agent: string; isTyping: boolean }> = [];
      bus.on("typing", (e) => events.push(e));
      bus.emit("typing", { agent: "elena", isTyping: true });
      bus.emit("typing", { agent: "elena", isTyping: false });
      assert.equal(events.length, 2);
      assert.equal(events[0].isTyping, true);
      assert.equal(events[1].isTyping, false);
    });
  });
});
