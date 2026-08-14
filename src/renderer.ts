import type { ChatMessage, AgentState } from "./types.ts";

/**
 * Color assignment for agents — cycle through accent colors.
 */
const AGENT_COLORS = [
  "accent",
  "success",
  "warning",
  "error",
  "mdLink",
  "syntaxFunction",
  "syntaxType",
  "syntaxString",
] as const;

type ThemeFg = (color: string, text: string) => string;
type ThemeBold = (text: string) => string;

/**
 * Encapsulates per-session color assignment so that state doesn't leak
 * across chorus sessions. Each ChatRenderer instance tracks its own
 * color index and agent→color mapping.
 */
export class ChatRenderer {
  private colorIndex = 0;
  private agentColorMap = new Map<string, string>();

  private getAgentColor(agentName: string): string {
    if (!this.agentColorMap.has(agentName)) {
      this.agentColorMap.set(agentName, AGENT_COLORS[this.colorIndex % AGENT_COLORS.length]);
      this.colorIndex++;
    }
    return this.agentColorMap.get(agentName)!;
  }

  private highlightMentions(text: string, fg: ThemeFg): string {
    return text.replace(/@([\w-]+)/g, (match, name) => {
      const color = this.getAgentColor(name);
      return fg(color, match);
    });
  }

  /**
   * Render a single chat message as a chat bubble.
   * @param resolveMessage — optional lookup to resolve replyTo IDs into previews
   */
  renderChatMessage(
    msg: ChatMessage,
    fg: ThemeFg,
    bold: ThemeBold,
    agents: Map<string, AgentState>,
    resolveMessage?: (id: string) => ChatMessage | undefined,
  ): string {
    const time = new Date(msg.timestamp).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });

    if (msg.type === "system") {
      return fg("dim", `  📢 ${msg.content}  ${fg("muted", time)}`);
    }

    if (msg.from === "user") {
      const header = fg("accent", bold("👤 You")) + "  " + fg("muted", time);
      const content = this.highlightMentions(msg.content, fg);
      return `${header}\n${content}`;
    }

    const agent = agents.get(msg.from.toLowerCase());
    const avatar = agent?.persona.avatar ?? "🤖";
    const color = this.getAgentColor(msg.from);

    const header = fg(color, bold(`${avatar} ${msg.from}`)) + "  " + fg("muted", time);
    const content = this.highlightMentions(msg.content, fg);

    let replyLine = "";
    if (msg.replyTo) {
      const original = resolveMessage?.(msg.replyTo);
      if (original) {
        // Show a truncated preview of the original message
        const preview = original.content.length > 60
          ? original.content.slice(0, 60) + "…"
          : original.content;
        replyLine = fg("dim", `  ↳ replying to ${original.from}: "${preview}"`) + "\n";
      } else {
        replyLine = fg("dim", `  ↳ replying to ${msg.replyTo}`) + "\n";
      }
    }

    return `${header}\n${replyLine}${content}`;
  }

  renderChatView(
    messages: readonly ChatMessage[],
    fg: ThemeFg,
    bold: ThemeBold,
    agents: Map<string, AgentState>,
    maxMessages = 50,
    resolveMessage?: (id: string) => ChatMessage | undefined,
  ): string[] {
    const recent = messages.slice(-maxMessages);
    const lines: string[] = [];

    for (const msg of recent) {
      if (msg.type === "tool_activity") continue;

      lines.push(this.renderChatMessage(msg, fg, bold, agents, resolveMessage));
      lines.push("");
    }

    return lines;
  }
}

/**
 * renderStatusBar is stateless — no color assignment needed — so it
 * stays as a standalone function.
 */
export function renderStatusBar(
  agents: Map<string, AgentState>,
  typingAgents: Set<string>,
  fg: ThemeFg,
): string[] {
  const roster = Array.from(agents.values())
    .map((a) => {
      const name      = a.persona.name;
      const isTyping  = typingAgents.has(name);
      const msgCount  = a.messageCount > 0 ? ` (${a.messageCount})` : "";

      const { icon, color } = agentStatusAppearance(a.status, isTyping);

      const nameAndIcon = `${a.persona.avatar} ${name} ${icon}${msgCount}`;
      return fg(color, nameAndIcon);
    })
    .join("  ");

  return [roster];
}

function agentStatusAppearance(
  status: AgentState["status"],
  isTyping: boolean,
): { icon: string; color: string } {
  if (status === "paused")   return { icon: "⏸️",  color: "muted"   };
  if (status === "working")  return { icon: "⚡",  color: "success" };
  if (status === "thinking") return { icon: "💭",  color: "warning" };
  if (isTyping)              return { icon: "✍️",   color: "accent"  };
  return                            { icon: "●",   color: "dim"     };
}
