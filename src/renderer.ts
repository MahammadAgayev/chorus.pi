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

let colorIndex = 0;
const agentColorMap = new Map<string, string>();

function getAgentColor(agentName: string): string {
  if (!agentColorMap.has(agentName)) {
    agentColorMap.set(agentName, AGENT_COLORS[colorIndex % AGENT_COLORS.length]);
    colorIndex++;
  }
  return agentColorMap.get(agentName)!;
}

/**
 * Render a single chat message as a chat bubble.
 */
export function renderChatMessage(
  msg: ChatMessage,
  fg: ThemeFg,
  bold: ThemeBold,
  agents: Map<string, AgentState>,
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
    const content = highlightMentions(msg.content, fg);
    return `${header}\n${content}`;
  }

  const agent = agents.get(msg.from.toLowerCase());
  const avatar = agent?.persona.avatar ?? "🤖";
  const color = getAgentColor(msg.from);

  if (msg.type === "tool_activity") {
    return fg("dim", `  ${avatar} ${msg.from} → ${msg.content}`);
  }

  const header = fg(color, bold(`${avatar} ${msg.from}`)) + "  " + fg("muted", time);
  const content = highlightMentions(msg.content, fg);

  let replyLine = "";
  if (msg.replyTo) {
    replyLine = fg("dim", `  ↳ replying to ${msg.replyTo}`) + "\n";
  }

  return `${header}\n${replyLine}${content}`;
}

function highlightMentions(text: string, fg: ThemeFg): string {
  return text.replace(/@([\w-]+)/g, (match, name) => {
    const color = getAgentColor(name);
    return fg(color, match);
  });
}

export function renderChatView(
  messages: readonly ChatMessage[],
  fg: ThemeFg,
  bold: ThemeBold,
  agents: Map<string, AgentState>,
  maxMessages = 50,
): string[] {
  const recent = messages.slice(-maxMessages);
  const lines: string[] = [];
  for (const msg of recent) {
    lines.push(renderChatMessage(msg, fg, bold, agents));
    lines.push("");
  }
  return lines;
}

export function renderStatusBar(
  agents: Map<string, AgentState>,
  typingAgents: Set<string>,
  fg: ThemeFg,
): string[] {
  const lines: string[] = [];

  if (typingAgents.size > 0) {
    const names = Array.from(typingAgents)
      .map((name) => {
        const agent = agents.get(name.toLowerCase());
        return agent ? `${agent.persona.avatar} ${name}` : name;
      })
      .join(", ");
    lines.push(fg("muted", `  ${names} typing...`));
  }

  const roster = Array.from(agents.values())
    .map((a) => {
      const statusIcon =
        a.status === "thinking" ? "💭" :
        a.status === "working" ? "⚡" :
        a.status === "paused" ? "⏸️" : "●";
      const statusColor =
        a.status === "paused" ? "muted" :
        a.status === "idle" ? "dim" : "accent";
      return fg(statusColor, `${a.persona.avatar} ${a.persona.name} ${statusIcon}`);
    })
    .join("  ");

  lines.push(roster);
  return lines;
}
