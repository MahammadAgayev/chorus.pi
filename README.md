# Chorus 🎵

A multi-agent chat collaboration extension for [pi](https://github.com/earendil-works/pi-mono). Spawns a team of AI agents that communicate in a shared group chat, each with their own persona, specialization, and randomly assigned mood.

## Quick Start

```bash
# Install dependencies
cd chorus && npm install

# Run with pi
pi -e ./src/index.ts

# Start a chorus
/chorus start Build a REST API for user management --agents architect,backend,reviewer

# Talk to the group
/say @backend what's the status on the auth endpoint?

# Check status
/chorus status

# Stop
/chorus stop
```

## Commands

| Command | Description |
|---------|-------------|
| `/chorus start <task> [--agents a,b,c]` | Start a chorus with a task and optional agent list |
| `/chorus status` | Show all agents, moods, and message counts |
| `/chorus add <agent>` | Add an agent mid-session |
| `/chorus remove <agent>` | Remove an agent |
| `/chorus pause <agent>` | Pause an agent |
| `/chorus resume <agent>` | Resume a paused agent |
| `/chorus stop` | Stop the chorus |
| `/chorus agents` | List available agent personas |
| `/say <message>` | Post a message to the group chat |

## Agent Personas

| Agent | Avatar | Specialization |
|-------|--------|---------------|
| `architect` | 🏗️ | System design, API contracts, architecture |
| `backend` | ⚙️ | Server code, APIs, database |
| `frontend` | 🎨 | UI components, styling, client-side |
| `reviewer` | 🔍 | Code review, testing, quality |
| `debugger` | 🐛 | Bug investigation, error handling |
| `generalist` | 🛠️ | Jack of all trades |

## Moods

Each agent is randomly assigned a mood that shapes their behavior:

| Mood | Emoji | Behavior |
|------|-------|----------|
| `focused` | 🎯 | Stays on task, ignores chatter |
| `enthusiastic` | 🔥 | Proactive, offers help, cheerful |
| `skeptical` | 🤔 | Questions assumptions, devil's advocate |
| `chill` | 😎 | Relaxed, helps when asked |
| `perfectionist` | ✨ | Nothing ships without tests and docs |
| `impatient` | ⚡ | Moves fast, cuts scope |
| `mentor` | 🧑‍🏫 | Explains reasoning, guides others |

## Key Features

- **Shared group chat**: All agents communicate in a WhatsApp-like group visible in the pi TUI
- **Real work**: Agents use pi's built-in tools (read, edit, bash) to make actual code changes
- **Focus management**: Each agent can ignore irrelevant messages and set topic filters to manage their context window
- **@mentions**: Tag specific agents with `@name` to direct questions
- **File conflict detection**: Warns when two agents modify the same file
- **Concurrent execution**: Up to 4 agents can work simultaneously
- **Mood-based engagement**: Agent personality affects how proactively they engage

## Architecture

```
┌──────────────────────────────────────────────┐
│  pi TUI                                      │
│  ┌────────────────────────────────────────┐  │
│  │  Chat View (custom message renderer)   │  │
│  │  🏗️ Architect: Let me design the API  │  │
│  │  ⚙️ Backend: I'll implement /users     │  │
│  │  👤 You: @reviewer check the PR        │  │
│  └────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────┐  │
│  │  Status Bar (widget below editor)      │  │
│  │  🏗️ architect 🎯 ●  ⚙️ backend 🔥 💭  │  │
│  └────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────┐  │
│  │  Editor: /say or /chorus commands      │  │
│  └────────────────────────────────────────┘  │
└──────────────────────────────────────────────┘
         │
         ▼
┌─── Chat Bus ─────────────────────────────────┐
│  Shared event emitter + message history      │
└──────┬──────┬──────┬──────┬──────────────────┘
       │      │      │      │
    ┌──▼──┐┌──▼──┐┌──▼──┐┌──▼──┐
    │Agent││Agent││Agent││Agent│  ← Each has its own
    │  1  ││  2  ││  3  ││  4  │    AgentSession via SDK
    └─────┘└─────┘└─────┘└─────┘
       │      │      │      │
       ▼      ▼      ▼      ▼
    [read] [edit] [bash] [grep]   ← Real tools, real work
```

Each agent runs as an in-process `AgentSession` (via pi's SDK), not as a subprocess. This allows:
- Shared chat bus for real-time communication
- Per-agent context management and focus filtering
- Concurrent tool execution with file mutation queuing
