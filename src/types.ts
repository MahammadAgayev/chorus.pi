import type { AgentSession } from "@earendil-works/pi-coding-agent";

// --- Agent Persona ---

export interface AgentPersona {
  name: string;
  avatar: string;
  specialization: string;
  description: string;
  systemPrompt: string;
  tools?: string[];
  model?: string;
}

// --- Chat Messages ---

export type ChatMessageType =
  | "text"
  | "tool_activity"
  | "system"
  | "join"
  | "leave"
  | "status";

export interface ChatMessage {
  id: string;
  from: string; // agent name or "user"
  mentions: string[]; // parsed @mentions
  content: string;
  timestamp: number;
  type: ChatMessageType;
  replyTo?: string; // message id
  toolName?: string; // for tool_activity
  toolArgs?: Record<string, unknown>;
  toolResult?: string;
  isError?: boolean;
}

// --- Agent State ---

export type AgentStatus = "idle" | "thinking" | "working" | "paused";

export interface AgentState {
  persona: AgentPersona;
  session: AgentSession;
  status: AgentStatus;
  focusTopics: string[];
  ignoredMessageIds: Set<string>;
  lastActive: number;
  messageCount: number;
  turnInProgress: boolean;
  unsubscribe?: () => void;
}

// --- Chat Bus Events ---

export interface ChatBusEvents {
  message: ChatMessage;
  typing: { agent: string; isTyping: boolean };
  agent_joined: { agent: string; persona: AgentPersona };
  agent_left: { agent: string };
}

// --- Chorus Config ---

export interface ChorusConfig {
  task: string;
  agentNames: string[];
  cwd: string;
}
