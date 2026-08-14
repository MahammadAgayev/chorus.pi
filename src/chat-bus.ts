import type { ChatMessage, ChatBusEvents } from "./types.ts";

type Listener<T> = (data: T) => void;

/**
 * Parse @mentions from message content.
 * Matches @name where name is alphanumeric/hyphens/underscores.
 */
export function parseMentions(content: string): string[] {
  const matches = content.match(/@([\w-]+)/g);
  if (!matches) return [];
  return [...new Set(matches.map((m) => m.slice(1).toLowerCase()))];
}

/**
 * Generate a unique message ID.
 * Uses a module-level counter combined with a base-36 timestamp
 * to ensure uniqueness across the process lifetime.
 */
let nextMessageId = 1;
export function generateMessageId(): string {
  return `msg-${nextMessageId++}-${Date.now().toString(36)}`;
}

/**
 * Shared message bus — the "WhatsApp group".
 * All agents and the user post messages here.
 */
export class ChatBus {
  private listeners = new Map<keyof ChatBusEvents, Set<Listener<any>>>();
  private history: ChatMessage[] = [];
  // O(1) lookup by id — avoids linear scan over history array
  private historyIndex = new Map<string, ChatMessage>();

  on<K extends keyof ChatBusEvents>(
    event: K,
    listener: Listener<ChatBusEvents[K]>,
  ): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
    return () => this.listeners.get(event)?.delete(listener);
  }

  emit<K extends keyof ChatBusEvents>(event: K, data: ChatBusEvents[K]): void {
    const set = this.listeners.get(event);
    if (set) {
      for (const fn of set) {
        try {
          fn(data);
        } catch {
          // listeners must not throw into the bus
        }
      }
    }
  }

  /**
   * Post a chat message to the group. Parses @mentions automatically.
   */
  post(
    from: string,
    content: string,
    opts?: Partial<Pick<ChatMessage, "type" | "replyTo" | "toolName" | "toolArgs" | "toolResult" | "isError">>,
  ): ChatMessage {
    const msg: ChatMessage = {
      id: generateMessageId(),
      from,
      mentions: parseMentions(content),
      content,
      timestamp: Date.now(),
      type: opts?.type ?? "text",
      replyTo: opts?.replyTo,
      toolName: opts?.toolName,
      toolArgs: opts?.toolArgs,
      toolResult: opts?.toolResult,
      isError: opts?.isError,
    };
    this.history.push(msg);
    this.historyIndex.set(msg.id, msg);
    this.emit("message", msg);
    return msg;
  }

  /**
   * Post a system message (no sender).
   */
  system(content: string): ChatMessage {
    return this.post("system", content, { type: "system" });
  }

  getHistory(): readonly ChatMessage[] {
    return this.history;
  }

  getRecentMessages(count: number): ChatMessage[] {
    if (count <= 0) return [];
    return this.history.slice(-count);
  }

  getMessageById(id: string): ChatMessage | undefined {
    return this.historyIndex.get(id);
  }

  clear(): void {
    this.history = [];
    this.historyIndex.clear();
  }
}
