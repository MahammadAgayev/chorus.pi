import type { ChatMessage } from "./types.ts";

/**
 * Per-agent focus manager.
 * Decides which chat messages belong in the agent's LLM context.
 */
export class FocusManager {
  private agentName: string;
  private ignoredIds = new Set<string>();
  private focusTopics: string[] = [];

  constructor(agentName: string) {
    this.agentName = agentName;
  }

  ignoreMessage(id: string): void {
    this.ignoredIds.add(id);
  }

  unignoreMessage(id: string): void {
    this.ignoredIds.delete(id);
  }

  setFocusTopics(topics: string[]): void {
    this.focusTopics = topics;
  }

  clearFocus(): void {
    this.focusTopics = [];
  }

  getIgnoredIds(): ReadonlySet<string> {
    return this.ignoredIds;
  }

  getFocusTopics(): readonly string[] {
    return this.focusTopics;
  }

  /**
   * Decide if a message should be included in this agent's context.
   */
  shouldInclude(msg: ChatMessage): boolean {
    if (this.ignoredIds.has(msg.id)) return false;
    if (msg.mentions.includes(this.agentName.toLowerCase())) return true;
    if (msg.from === this.agentName) return true;
    if (msg.type === "system" || msg.type === "join" || msg.type === "leave") return true;

    if (this.focusTopics.length > 0) {
      const lower = msg.content.toLowerCase();
      return this.focusTopics.some((t) => lower.includes(t.toLowerCase()));
    }

    return true;
  }

  filterMessages(messages: ChatMessage[]): ChatMessage[] {
    return messages.filter((m) => this.shouldInclude(m));
  }
}
