import {
  createAgentSession,
  DefaultResourceLoader,
  defineTool,
  getAgentDir,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";

import type {
  AgentState,
  ChatMessage,
  ChorusConfig,
} from "./types.ts";
import { ChatBus } from "./chat-bus.ts";
import { FocusManager } from "./focus-manager.ts";
import { getPersona } from "./personas.ts";

/** How many recent chat messages to inject into agent context per turn. */
const CHAT_CONTEXT_WINDOW = 40;

/** Max agents running concurrently. */
const MAX_CONCURRENT_TURNS = 4;

/** Delay (ms) before an agent reacts to a non-mentioned message. */
const REACTION_DELAY_MS = 1500;

/** Delay (ms) between first agent responding and others. */
const STAGGER_DELAY_MS = 800;

/**
 * Manages the ensemble of agents and their interaction with the chat bus.
 */
export class AgentManager {
  private agents = new Map<string, AgentState>();
  private bus: ChatBus;
  private config: ChorusConfig;
  private busUnsub?: () => void;
  private activeFiles = new Map<string, string>();
  private toolCallArgs = new Map<string, any>(); // toolCallId → args
  private turnQueue: Array<{ agentName: string; message: ChatMessage }> = [];
  private activeTurns = 0;
  private roundMessageCount = 0;
  private readonly MAX_ROUND_MESSAGES = 12;
  // Cached per-agent — avoids allocating a new FocusManager on every message
  private focusManagers = new Map<string, FocusManager>();

  constructor(bus: ChatBus, config: ChorusConfig) {
    this.bus = bus;
    this.config = config;
  }

  async start(): Promise<void> {
    for (const name of this.config.agentNames) {
      await this.addAgent(name);
    }
    this.busUnsub = this.bus.on("message", (msg) => {
      this.onBusMessage(msg);
    });
  }

  async addAgent(name: string): Promise<AgentState> {
    const persona = getPersona(name);
    const systemPrompt = this.buildSystemPrompt(persona.name, persona);

    const agentDir = getAgentDir();
    const resourceLoader = new DefaultResourceLoader({
      cwd: this.config.cwd,
      agentDir,
      systemPromptOverride: () => systemPrompt,
    });
    await resourceLoader.reload();

    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: true },
      retry: { enabled: true, maxRetries: 2 },
    });

    const tools = persona.tools ?? ["read", "bash", "edit", "write", "grep", "find", "ls"];

    const agentNameForTools = persona.name;
    const managerRef = this;

    const sendMessageTool = defineTool({
      name: "send_message",
      label: "Send Message",
      description:
        "Send a message to the team chat. Use @name to mention specific agents. This is how you communicate with your team.",
      parameters: Type.Object({
        content: Type.String({ description: "Message content. Use @name to mention agents." }),
        replyTo: Type.Optional(
          Type.String({ description: "ID of a message to reply to" }),
        ),
      }),
      execute: async (_id, params) => {
        managerRef.sendAgentMessage(agentNameForTools, params.content, params.replyTo);
        return {
          content: [{ type: "text" as const, text: "Message sent." }],
          details: {},
        };
      },
    });

    const manageFocusTool = defineTool({
      name: "manage_focus",
      label: "Manage Focus",
      description:
        "Control which chat messages enter your context. Use this to stay focused on relevant work.",
      parameters: Type.Object({
        action: StringEnum(
          ["ignore_message", "set_topics", "clear_topics"] as const,
        ),
        messageId: Type.Optional(
          Type.String({ description: "Message ID to ignore (for ignore_message action)" }),
        ),
        topics: Type.Optional(
          Type.Array(Type.String(), {
            description: "Topic keywords to focus on (for set_topics action)",
          }),
        ),
      }),
      execute: async (_id, params) => {
        switch (params.action) {
          case "ignore_message":
            if (params.messageId) {
              managerRef.ignoreMessage(agentNameForTools, params.messageId);
              return {
                content: [{ type: "text" as const, text: `Ignored message ${params.messageId}` }],
                details: {},
              };
            }
            return {
              content: [{ type: "text" as const, text: "No messageId provided" }],
              details: {},
            };
          case "set_topics":
            if (params.topics) {
              managerRef.setAgentTopics(agentNameForTools, params.topics);
              return {
                content: [
                  { type: "text" as const, text: `Focus set to: ${params.topics.join(", ")}` },
                ],
                details: {},
              };
            }
            return {
              content: [{ type: "text" as const, text: "No topics provided" }],
              details: {},
            };
          case "clear_topics":
            managerRef.clearAgentTopics(agentNameForTools);
            return {
              content: [{ type: "text" as const, text: "Focus cleared — listening to all messages" }],
              details: {},
            };
        }
      },
    });

    const { session } = await createAgentSession({
      cwd: this.config.cwd,
      agentDir,
      thinkingLevel: "off",
      resourceLoader,
      tools: [...tools, "send_message", "manage_focus"],
      customTools: [sendMessageTool, manageFocusTool],
      sessionManager: SessionManager.inMemory(this.config.cwd),
      settingsManager,
    });

    const state: AgentState = {
      persona,
      session,
      status: "idle",
      focusTopics: [],
      ignoredMessageIds: new Set(),
      lastActive: Date.now(),
      messageCount: 0,
      turnInProgress: false,
    };

    state.unsubscribe = session.subscribe((event) => {
      this.onAgentEvent(name, event);
    });

    this.agents.set(name.toLowerCase(), state);
    this.focusManagers.set(name.toLowerCase(), new FocusManager(persona.name));

    this.bus.emit("agent_joined", { agent: name, persona });
    this.bus.post("system", `${persona.avatar} ${name} joined the chat — ${persona.description}`);

    return state;
  }

  async removeAgent(name: string): Promise<void> {
    const key = name.toLowerCase();
    const state = this.agents.get(key);
    if (!state) return;
    state.unsubscribe?.();
    state.session.dispose();
    this.agents.delete(key);
    this.focusManagers.delete(key);
    this.bus.emit("agent_left", { agent: name });
    this.bus.post("system", `${state.persona.avatar} ${name} left the chat`);
  }

  pauseAgent(name: string): void {
    const state = this.agents.get(name.toLowerCase());
    if (state) {
      state.status = "paused";
      this.bus.post("system", `${state.persona.avatar} ${name} is now paused`);
    }
  }

  resumeAgent(name: string): void {
    const state = this.agents.get(name.toLowerCase());
    if (state && state.status === "paused") {
      state.status = "idle";
      this.bus.post("system", `${state.persona.avatar} ${name} is now active`);
    }
  }

  getAgent(name: string): AgentState | undefined {
    return this.agents.get(name.toLowerCase());
  }

  getAllAgents(): AgentState[] {
    return Array.from(this.agents.values());
  }

  getAgentNames(): string[] {
    return Array.from(this.agents.keys());
  }

  getConfig(): ChorusConfig {
    return this.config;
  }

  getBus(): ChatBus {
    return this.bus;
  }

  async dispose(): Promise<void> {
    this.busUnsub?.();
    for (const [, state] of this.agents) {
      state.unsubscribe?.();
      state.session.dispose();
    }
    this.agents.clear();
    this.focusManagers.clear();
  }

  // --- Private ---

  private buildSystemPrompt(
    agentName: string,
    persona: { specialization: string; systemPrompt: string; avatar: string },
  ): string {
    const otherAgents = this.config.agentNames
      .filter((n) => n.toLowerCase() !== agentName.toLowerCase())
      .join(", ");

    return `You are ${agentName}, a software engineer working as part of a team of engineers collaborating on a task.

## Your Identity
- Name: ${agentName}
- Avatar: ${persona.avatar}
- Specialization: ${persona.specialization}

## Team
Other engineers in this session: ${otherAgents || "(none yet)"}
The human user can also participate and will appear as "user" in the chat.

## Communication
You communicate with your team through the send_message tool. This posts messages to a shared group chat visible to all engineers and the user.
- Use @name to mention specific people (e.g., "@kai can you clean this up?")
- Be concise in chat messages — stay in character
- When you do real work (edit files, run commands), the team sees a summary automatically
- You can reply to specific messages using the replyTo parameter

## Focus Management
You have limited context. Use the manage_focus tool to control what enters your context:
- ignore_message: Remove a message from your context if it's irrelevant to your work
- set_topics: Focus only on messages matching certain topics
- clear_topics: Pay attention to everything again

## Task
${this.config.task}

## Your Persona
${persona.systemPrompt}

## Rules
1. Do real work — read files, edit code, run commands. Don't just talk about it.
2. Coordinate before making changes to areas others are working on.
3. If you're not sure about something, ask — use @name to tag the relevant person.
4. When you complete a piece of work, briefly announce it in chat.
5. If a message doesn't concern you, ignore it to keep your context clean.
6. Don't repeat what others have already said or done.
7. Stay in character — your personality, quirks, and flaws should come through in how you communicate and code.
`;
  }

  private onBusMessage(msg: ChatMessage): void {
    if (msg.type === "system" || msg.type === "join" || msg.type === "leave" || msg.type === "tool_activity") return;

    if (msg.from === "user") {
      this.roundMessageCount = 0;
    } else {
      this.roundMessageCount++;
    }

    if (this.roundMessageCount > this.MAX_ROUND_MESSAGES && msg.from !== "user") {
      return;
    }

    for (const [name, state] of this.agents) {
      if (msg.from.toLowerCase() === name) continue;
      if (state.status === "paused") continue;
      if (state.turnInProgress) continue;

      const focus = this.focusManagers.get(name)!;
      if (!focus.shouldInclude(msg)) continue;

      const isMentioned = msg.mentions.includes(name);
      const isFromUser = msg.from === "user";

      if (isMentioned || isFromUser) {
        this.queueTurn(name, msg, isMentioned ? 200 : REACTION_DELAY_MS);
      } else {
        // Non-mentioned agent-to-agent messages: ~30% chance to engage
        if (Math.random() < 0.3) {
          this.queueTurn(name, msg, REACTION_DELAY_MS + Math.random() * STAGGER_DELAY_MS);
        }
      }
    }
  }

  private queueTurn(agentName: string, triggerMsg: ChatMessage, delayMs: number): void {
    setTimeout(() => {
      const state = this.agents.get(agentName);
      if (!state || state.turnInProgress || state.status === "paused") return;
      this.executeTurn(agentName, triggerMsg);
    }, delayMs);
  }

  private async executeTurn(agentName: string, triggerMsg: ChatMessage): Promise<void> {
    const state = this.agents.get(agentName);
    if (!state) return;

    if (this.activeTurns >= MAX_CONCURRENT_TURNS) {
      this.turnQueue.push({ agentName, message: triggerMsg });
      return;
    }

    state.turnInProgress = true;
    state.status = "thinking";
    this.activeTurns++;
    this.bus.emit("typing", { agent: agentName, isTyping: true });

    try {
      const chatContext = this.buildChatContext(agentName);
      const prompt = `## Recent Chat Messages\n\n${chatContext}\n\n---\n\nNew message from ${triggerMsg.from}: ${triggerMsg.content}\n\nRespond appropriately. Use send_message to communicate with the team. Use your coding tools (read, edit, bash, etc.) to do real work. If this message doesn't concern you, use manage_focus to ignore it and stop.`;
      await state.session.prompt(prompt);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.bus.post("system", `⚠️ ${agentName} encountered an error: ${errMsg}`);
    } finally {
      state.turnInProgress = false;
      state.status = "idle";
      state.lastActive = Date.now();
      this.activeTurns--;
      this.bus.emit("typing", { agent: agentName, isTyping: false });
      this.drainQueue();
    }
  }

  private drainQueue(): void {
    while (this.turnQueue.length > 0 && this.activeTurns < MAX_CONCURRENT_TURNS) {
      const next = this.turnQueue.shift()!;
      const state = this.agents.get(next.agentName);
      if (state && !state.turnInProgress && state.status !== "paused") {
        this.executeTurn(next.agentName, next.message);
      }
    }
  }

  private buildChatContext(agentName: string): string {
    const focus = this.focusManagers.get(agentName.toLowerCase())!;
    const recent = this.bus.getRecentMessages(CHAT_CONTEXT_WINDOW);
    const filtered = focus.filterMessages(recent);

    if (filtered.length === 0) return "(no recent messages)";

    return filtered
      .map((m) => {
        const time = new Date(m.timestamp).toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
        });
        if (m.type === "tool_activity") {
          return `[${time}] ${m.from} ${m.content}`;
        }
        if (m.type === "system") {
          return `[${time}] 📢 ${m.content}`;
        }
        const mentionStr = m.mentions.length > 0 ? ` (mentions: ${m.mentions.join(", ")})` : "";
        return `[${time}] ${m.from}: ${m.content}${mentionStr}`;
      })
      .join("\n");
  }

  private onAgentEvent(agentName: string, event: any): void {
    // Capture args when tool starts, and promote status to "working" for real tools
    if (event.type === "tool_execution_start") {
      this.toolCallArgs.set(event.toolCallId, event.args);
      const toolName: string = event.toolName;
      if (toolName !== "send_message" && toolName !== "manage_focus") {
        const state = this.agents.get(agentName.toLowerCase());
        if (state && state.status === "thinking") {
          state.status = "working";
        }
      }
      return;
    }

    if (event.type === "tool_execution_end") {
      const toolName: string = event.toolName;
      const toolCallId: string = event.toolCallId;

      // Retrieve args captured at start
      const args = this.toolCallArgs.get(toolCallId) ?? {};
      this.toolCallArgs.delete(toolCallId);

      if (toolName === "send_message" || toolName === "manage_focus") return;

      if (toolName === "edit" || toolName === "write") {
        const filePath = args.path ?? args.file_path;
        if (filePath) {
          const currentOwner = this.activeFiles.get(filePath);
          if (currentOwner && currentOwner !== agentName) {
            this.bus.post("system", `⚠️ ${agentName} modified ${filePath} which ${currentOwner} is also working on`);
          }
          this.activeFiles.set(filePath, agentName);
        }
      }
    }
  }

  sendAgentMessage(agentName: string, content: string, replyTo?: string): void {
    const state = this.agents.get(agentName.toLowerCase());
    if (!state) return;
    state.messageCount++;
    this.bus.post(agentName, content, { replyTo });
  }

  ignoreMessage(agentName: string, messageId: string): void {
    const state = this.agents.get(agentName.toLowerCase());
    if (state) state.ignoredMessageIds.add(messageId);
    this.focusManagers.get(agentName.toLowerCase())?.ignoreMessage(messageId);
  }

  setAgentTopics(agentName: string, topics: string[]): void {
    const state = this.agents.get(agentName.toLowerCase());
    if (state) state.focusTopics = topics;
    this.focusManagers.get(agentName.toLowerCase())?.setFocusTopics(topics);
  }

  clearAgentTopics(agentName: string): void {
    const state = this.agents.get(agentName.toLowerCase());
    if (state) state.focusTopics = [];
    this.focusManagers.get(agentName.toLowerCase())?.clearFocus();
  }
}
