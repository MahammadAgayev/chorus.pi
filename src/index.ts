/**
 * Chorus — Multi-agent chat collaboration extension for pi.
 *
 * Usage:
 *   /chorus start [--agents agent1,agent2,...]
 *   /chorus status
 *   /chorus add <agent>
 *   /chorus remove <agent>
 *   /chorus pause <agent>
 *   /chorus resume <agent>
 *   /chorus stop
 *   /say <message>         — post directly to the group chat
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import { Container, type SelectItem, SelectList, Text } from "@earendil-works/pi-tui";
import type { AgentState, ChatMessage } from "./types.ts";
import { ChatBus } from "./chat-bus.ts";
import { AgentManager } from "./agent-manager.ts";
import { discoverPersonas, getPersonasDir, getSampleAgentsDir, listPersonaNames } from "./personas.ts";
import { ChatRenderer, renderStatusBar } from "./renderer.ts";

export default function (pi: ExtensionAPI) {
  let manager: AgentManager | null = null;
  let chatRenderer: ChatRenderer | null = null;
  let chatUnsub: (() => void) | undefined;
  let typingUnsub: (() => void) | undefined;
  let typingAgents = new Set<string>();

  // --- /chorus command ---

  pi.registerCommand("chorus", {
    description: "Multi-agent chorus: start, status, add, remove, pause, resume, stop",
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/);
      const subcommand = parts[0]?.toLowerCase();

      switch (subcommand) {
        case "start":
          await handleStart(parts.slice(1), ctx);
          break;
        case "status":
          handleStatus(ctx);
          break;
        case "add":
          await handleAdd(parts[1], ctx);
          break;
        case "remove":
          await handleRemove(parts[1], ctx);
          break;
        case "pause":
          await handlePause(parts[1], ctx);
          break;
        case "resume":
          await handleResume(parts[1], ctx);
          break;
        case "stop":
          await handleStop(ctx);
          break;
        case "agents":
          handleListAgents(ctx);
          break;
        case "setup":
          handleSetup(ctx);
          break;
        default:
          ctx.ui.notify(
            "Usage: /chorus start [--agents a,b,c] | status | add <name> | remove <name> | pause <name> | resume <name> | stop | agents",
            "info",
          );
      }
    },
  });

  // --- /say command (available as alias, also works when chorus is inactive) ---

  pi.registerCommand("say", {
    description: "Post a message to the chorus group chat",
    handler: async (args, _ctx) => {
      if (!manager) {
        _ctx.ui.notify("No chorus session active. Use /chorus start first.", "warning");
        return;
      }
      if (!args.trim()) return;
      manager.getBus().post("user", args.trim());
    },
  });

  // --- Custom message renderer for chat messages ---

  pi.registerMessageRenderer("chorus-chat", (message, { expanded }, theme) => {
    try {
      const details = message.details as { chatMessage?: ChatMessage } | undefined;
      if (!details?.chatMessage) {
        return new Text(message.content ?? "", 0, 0);
      }

      const agentMap = new Map<string, AgentState>();
      if (manager) {
        for (const a of manager.getAllAgents()) {
          agentMap.set(a.persona.name.toLowerCase(), a);
        }
      }

      const renderer = chatRenderer ?? new ChatRenderer();
      const rendered = renderer.renderChatMessage(
        details.chatMessage,
        theme.fg.bind(theme),
        theme.bold.bind(theme),
        agentMap,
        (id) => manager?.getBus().getMessageById(id),
      );
      return new Text(rendered, 0, 0);
    } catch {
      // Fallback if rendering fails
      return new Text(message.content ?? "", 0, 0);
    }
  });

  // --- Intercept user input when chorus is active ---
  // When chorus is running, all user messages go to the chat bus
  // instead of pi's main agent. Slash commands still work normally.

  pi.on("input", async (event, ctx) => {
    if (!manager) return { action: "continue" as const };

    // Let slash commands through (/chorus, /say, etc.)
    if (event.text.startsWith("/")) return { action: "continue" as const };

    // Route to chat bus
    manager.getBus().post("user", event.text);
    return { action: "handled" as const };
  });

  // --- Cleanup on session shutdown ---

  pi.on("session_shutdown", async () => {
    await cleanup();
  });

  // --- Handlers ---

  async function handleStart(parts: string[], ctx: ExtensionContext): Promise<void> {
    if (manager) {
      ctx.ui.notify("Chorus already running. Use /chorus stop first.", "warning");
      return;
    }

    // Only arg is the optional --agents list; without it we show the picker.
    let agentNames: string[] = [];
    const agentsIdx = parts.indexOf("--agents");

    if (agentsIdx >= 0) {
      const agentArg = parts[agentsIdx + 1];
      if (agentArg) {
        agentNames = agentArg.split(",").map((s) => s.trim()).filter(Boolean);
      }
    }

    if (agentNames.length === 0) {
      const personas = discoverPersonas();
      if (personas.size === 0) {
        ctx.ui.notify("No agent personas found.", "error");
        return;
      }

      const selected = await pickAgents(ctx, personas);
      if (!selected || selected.length === 0) {
        ctx.ui.notify("No agents selected. Chorus cancelled.", "info");
        return;
      }
      agentNames = selected;
    }

    ctx.ui.notify(`Starting chorus with ${agentNames.length} agents: ${agentNames.join(", ")}`, "info");

    const bus = new ChatBus();
    chatRenderer = new ChatRenderer();
    manager = new AgentManager(bus, {
      agentNames,
      cwd: ctx.cwd,
    });

    // Subscribe to bus messages → render in pi's chat
    chatUnsub = bus.on("message", (msg) => {
      pi.sendMessage({
        customType: "chorus-chat",
        content: formatPlainMessage(msg),
        display: true,
        details: { chatMessage: msg },
      });
    });

    // Subscribe to typing indicators → update widget
    typingAgents = new Set();
    typingUnsub = bus.on("typing", ({ agent, isTyping }) => {
      if (isTyping) typingAgents.add(agent);
      else typingAgents.delete(agent);
      updateWidget(ctx);
    });

    try {
      await manager.start();
      updateWidget(ctx);
      updateStatus(ctx);

      // The team waits for the user's first message rather than inventing work.
      bus.system(
        `Team assembled: ${agentNames.join(", ")}. Just type to talk to the group.`,
      );
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`Failed to start chorus: ${errMsg}`, "error");
      await cleanup();
    }
  }

  function handleStatus(ctx: ExtensionContext): void {
    if (!manager) {
      ctx.ui.notify("No chorus session active.", "info");
      return;
    }

    const agents = manager.getAllAgents();
    const messages = manager.getBus().getHistory();

    let status = `🎵 Chorus Status\n`;
    status += `Messages: ${messages.length}\n`;
    status += `Agents:\n`;

    for (const a of agents) {
      const icon =
        a.status === "thinking" ? "💭" :
        a.status === "working" ? "⚡" :
        a.status === "paused" ? "⏸️" : "●";
      status += `  ${a.persona.avatar} ${a.persona.name} — ${a.persona.specialization} ${icon} ${a.status} (${a.messageCount} msgs)\n`;
      if (a.focusTopics.length > 0) {
        status += `    Focus: ${a.focusTopics.join(", ")}\n`;
      }
    }

    ctx.ui.notify(status, "info");
  }

  async function handleAdd(name: string | undefined, ctx: ExtensionContext): Promise<void> {
    if (!manager) {
      ctx.ui.notify("No chorus session active.", "warning");
      return;
    }

    let agentName = name;

    // If no name given, show a picker with agents not already in the chorus
    if (!agentName) {
      const personas = discoverPersonas();
      const currentNames = new Set(manager.getAgentNames());
      const available: SelectItem[] = Array.from(personas.values())
        .filter((p) => !currentNames.has(p.name.toLowerCase()))
        .map((p) => ({
          value: p.name,
          label: `${p.avatar} ${p.name}`,
          description: p.description,
        }));

      if (available.length === 0) {
        ctx.ui.notify("All available agents are already in the chorus.", "info");
        return;
      }

      agentName = await pickOne(ctx, "Add to team", available);
      if (!agentName) return;
    }

    try {
      await manager.addAgent(agentName);
      updateWidget(ctx);
      updateStatus(ctx);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`Failed to add agent: ${errMsg}`, "error");
    }
  }

  async function handleRemove(name: string | undefined, ctx: ExtensionContext): Promise<void> {
    if (!manager) {
      ctx.ui.notify("No chorus session active.", "warning");
      return;
    }

    let agentName = name;

    // If no name given, show a picker with current agents
    if (!agentName) {
      const agents = manager.getAllAgents();
      if (agents.length === 0) {
        ctx.ui.notify("No agents in the chorus.", "info");
        return;
      }

      const items: SelectItem[] = agents.map((a) => ({
        value: a.persona.name,
        label: `${a.persona.avatar} ${a.persona.name}`,
        description: `${a.persona.specialization} — ${a.messageCount} msgs`,
      }));

      agentName = await pickOne(ctx, "Remove from team", items);
      if (!agentName) return;
    }

    await manager.removeAgent(agentName);
    updateWidget(ctx);
    updateStatus(ctx);
  }

  async function handlePause(name: string | undefined, ctx: ExtensionContext): Promise<void> {
    if (!manager) return;

    let agentName = name;
    if (!agentName) {
      const active = manager.getAllAgents().filter((a) => a.status !== "paused");
      if (active.length === 0) {
        ctx.ui.notify("No active agents to pause.", "info");
        return;
      }
      agentName = await pickOne(ctx, "Pause agent", active.map((a) => ({
        value: a.persona.name,
        label: `${a.persona.avatar} ${a.persona.name}`,
        description: a.persona.specialization,
      })));
      if (!agentName) return;
    }

    manager.pauseAgent(agentName);
    updateWidget(ctx);
  }

  async function handleResume(name: string | undefined, ctx: ExtensionContext): Promise<void> {
    if (!manager) return;

    let agentName = name;
    if (!agentName) {
      const paused = manager.getAllAgents().filter((a) => a.status === "paused");
      if (paused.length === 0) {
        ctx.ui.notify("No paused agents to resume.", "info");
        return;
      }
      agentName = await pickOne(ctx, "Resume agent", paused.map((a) => ({
        value: a.persona.name,
        label: `${a.persona.avatar} ${a.persona.name}`,
        description: a.persona.specialization,
      })));
      if (!agentName) return;
    }

    manager.resumeAgent(agentName);
    updateWidget(ctx);
  }

  async function handleStop(ctx: ExtensionContext): Promise<void> {
    if (!manager) {
      ctx.ui.notify("No chorus session active.", "info");
      return;
    }
    const count = manager.getBus().getHistory().length;
    await cleanup();
    ctx.ui.notify(`Chorus stopped. ${count} messages exchanged.`, "info");
    ctx.ui.setWidget("chorus-status", undefined);
    ctx.ui.setStatus("chorus", undefined);
  }

  function handleListAgents(ctx: ExtensionContext): void {
    const available = listPersonaNames();
    ctx.ui.notify(
      `Available agent personas: ${available.join(", ")}\n\nUse /chorus start --agents name1,name2,...`,
      "info",
    );
  }

  function handleSetup(ctx: ExtensionContext): void {
    const destDir = getPersonasDir();
    const srcDir = getSampleAgentsDir();

    let srcFiles: string[];
    try {
      srcFiles = fs.readdirSync(srcDir).filter((f) => f.endsWith(".md"));
    } catch {
      ctx.ui.notify(`No sample personas found at ${srcDir}`, "error");
      return;
    }

    if (srcFiles.length === 0) {
      ctx.ui.notify("No sample personas to copy.", "info");
      return;
    }

    fs.mkdirSync(destDir, { recursive: true });

    let copied = 0;
    let skipped = 0;
    for (const file of srcFiles) {
      const dest = path.join(destDir, file);
      if (fs.existsSync(dest)) {
        skipped++;
        continue;
      }
      fs.copyFileSync(path.join(srcDir, file), dest);
      copied++;
    }

    ctx.ui.notify(
      `Setup complete: ${copied} persona(s) copied to ${destDir}` +
        (skipped > 0 ? ` (${skipped} already existed, skipped)` : ""),
      "info",
    );
  }

  // --- UI updates ---

  function updateWidget(ctx: ExtensionContext): void {
    if (!manager) return;
    const agentMap = new Map<string, AgentState>();
    for (const a of manager.getAllAgents()) {
      agentMap.set(a.persona.name.toLowerCase(), a);
    }
    const lines = renderStatusBar(
      agentMap,
      typingAgents,
      ctx.ui.theme.fg.bind(ctx.ui.theme),
    );
    ctx.ui.setWidget("chorus-status", lines, { placement: "belowEditor" });
  }

  function updateStatus(ctx: ExtensionContext): void {
    if (!manager) return;
    const agents = manager.getAllAgents();
    const active = agents.filter((a) => a.status !== "paused").length;
    const msgs = manager.getBus().getHistory().length;
    ctx.ui.setStatus(
      "chorus",
      ctx.ui.theme.fg("accent", `🎵 Chorus: ${agents.length} agents • ${msgs} msgs • ${active} active`),
    );
  }

  // --- Helpers ---

  function formatPlainMessage(msg: ChatMessage): string {
    if (msg.type === "system") return `📢 ${msg.content}`;
    if (msg.type === "tool_activity") return `${msg.from} ${msg.content}`;
    return `${msg.from}: ${msg.content}`;
  }

  async function cleanup(): Promise<void> {
    chatUnsub?.();
    typingUnsub?.();
    chatUnsub = undefined;
    typingUnsub = undefined;
    typingAgents.clear();
    if (manager) {
      await manager.dispose();
      manager = null;
    }
    chatRenderer = null;
  }

  // --- Pickers ---

  /**
   * Single-select picker. Returns the selected value or null on cancel.
   */
  async function pickOne(
    ctx: ExtensionContext,
    title: string,
    items: SelectItem[],
  ): Promise<string | null> {
    return ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
      const container = new Container();
      container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
      container.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 0));

      const selectList = new SelectList(items, Math.min(items.length, 10), {
        selectedPrefix: (t: string) => theme.fg("accent", t),
        selectedText: (t: string) => theme.fg("accent", t),
        description: (t: string) => theme.fg("muted", t),
        scrollInfo: (t: string) => theme.fg("dim", t),
        noMatch: (t: string) => theme.fg("warning", t),
      });
      selectList.onSelect = (item: SelectItem) => done(item.value);
      selectList.onCancel = () => done(null);
      container.addChild(selectList);

      container.addChild(new Text(theme.fg("dim", "↑↓ navigate • enter select • esc cancel"), 1, 0));
      container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

      return {
        render: (w: number) => container.render(w),
        invalidate: () => container.invalidate(),
        handleInput: (data: string) => { selectList.handleInput(data); tui.requestRender(); },
      };
    });
  }

  /**
   * Multi-select picker for chorus start. Pick agents one at a time, esc when done.
   */
  async function pickAgents(
    ctx: ExtensionContext,
    personas: Map<string, import("./types.ts").AgentPersona>,
  ): Promise<string[] | null> {
    const selected = new Set<string>();

    const items: SelectItem[] = Array.from(personas.values()).map((p) => ({
      value: p.name,
      label: `${p.avatar} ${p.name}`,
      description: p.description,
    }));

    // Loop: let user pick agents one at a time, show selected so far
    while (true) {
      const remaining = items.filter((i) => !selected.has(i.value));

      // Build header showing who's already picked
      const pickedLabel = selected.size > 0
        ? Array.from(selected)
            .map((n) => {
              const p = personas.get(n);
              return p ? `${p.avatar} ${p.name}` : n;
            })
            .join(", ")
        : "(none yet)";

      const result = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
        const container = new Container();

        container.addChild(
          new DynamicBorder((s: string) => theme.fg("accent", s)),
        );
        container.addChild(
          new Text(
            theme.fg("accent", theme.bold("Pick your team")) +
              "  " +
              theme.fg("dim", `(${selected.size} selected)`),
            1,
            0,
          ),
        );
        container.addChild(
          new Text(theme.fg("muted", `Team: ${pickedLabel}`), 1, 0),
        );

        if (remaining.length === 0) {
          container.addChild(
            new Text(theme.fg("dim", "All agents selected."), 1, 1),
          );
          container.addChild(
            new Text(theme.fg("dim", "Press escape to start"), 1, 0),
          );
          container.addChild(
            new DynamicBorder((s: string) => theme.fg("accent", s)),
          );
          return {
            render: (w: number) => container.render(w),
            invalidate: () => container.invalidate(),
            handleInput: () => done(null),
          };
        }

        const selectList = new SelectList(remaining, Math.min(remaining.length, 10), {
          selectedPrefix: (t: string) => theme.fg("accent", t),
          selectedText: (t: string) => theme.fg("accent", t),
          description: (t: string) => theme.fg("muted", t),
          scrollInfo: (t: string) => theme.fg("dim", t),
          noMatch: (t: string) => theme.fg("warning", t),
        });
        selectList.onSelect = (item: SelectItem) => done(item.value);
        selectList.onCancel = () => done(null);
        container.addChild(selectList);

        container.addChild(
          new Text(
            theme.fg("dim", "↑↓ navigate • enter select • esc done"),
            1,
            0,
          ),
        );
        container.addChild(
          new DynamicBorder((s: string) => theme.fg("accent", s)),
        );

        return {
          render: (w: number) => container.render(w),
          invalidate: () => container.invalidate(),
          handleInput: (data: string) => {
            selectList.handleInput(data);
            tui.requestRender();
          },
        };
      });

      if (result === null) {
        // Escape pressed — done picking
        break;
      }
      selected.add(result);
    }

    return selected.size > 0 ? Array.from(selected) : null;
  }
}
