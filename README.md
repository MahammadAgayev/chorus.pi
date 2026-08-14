# Chorus 🎵

A multi-agent chat collaboration extension for [pi](https://github.com/earendil-works/pi-mono). Spawns a team of AI agents that communicate in a shared group chat, each with their own persona and specialization.

## Quick Start

```bash
# Install dependencies
cd chorus && npm install

# Run with pi
pi -e ./src/index.ts

# Start a chorus
/chorus start Build a REST API for user management --agents dev,kai,elena

# Talk to the group
/say @elena what's the status on the auth endpoint?

# Check status
/chorus status

# Stop
/chorus stop
```

## Commands

| Command | Description |
|---------|-------------|
| `/chorus start <task> [--agents a,b,c]` | Start a chorus with a task and optional agent list |
| `/chorus status` | Show all agents and message counts |
| `/chorus add <agent>` | Add an agent mid-session |
| `/chorus remove <agent>` | Remove an agent |
| `/chorus pause <agent>` | Pause an agent |
| `/chorus resume <agent>` | Resume a paused agent |
| `/chorus stop` | Stop the chorus |
| `/chorus agents` | List available agent personas |
| `/say <message>` | Post a message to the group chat |

## Agent Personas

Personas are defined as markdown files in `src/agents/`. Add a new agent by dropping a `.md` file with frontmatter.

| Agent | Avatar | Specialization |
|-------|--------|---------------|
| `dev` | 🧑‍🚀 | Generalist / Pragmatist |
| `kai` | 🧑‍💻 | Clean Code & Craft Engineer |
| `elena` | 👩‍🔬 | Reliability & Testing Engineer |
| `lia` | 👩‍🏫 | Senior Engineer / Mentor |
| `marcus` | 🧔‍♂️ | Move-Fast Engineer |
| `nadia` | 👩‍🔧 | Systems & Performance Engineer |
| `omar` | 🧑‍🎓 | Junior-ish Engineer with Big Ideas |

## Key Features

- **Shared group chat**: All agents communicate in a WhatsApp-like group visible in the pi TUI
- **Real work**: Agents use pi's built-in tools (read, edit, bash) to make actual code changes
- **Focus management**: Each agent can ignore irrelevant messages and set topic filters to manage their context window
- **@mentions**: Tag specific agents with `@name` to direct questions
- **File conflict detection**: Warns when two agents modify the same file
- **Concurrent execution**: Up to 4 agents can work simultaneously
- **Persona-based engagement**: Agent personality affects how proactively they engage

## Architecture

```
┌──────────────────────────────────────────────┐
│  pi TUI                                      │
│  ┌────────────────────────────────────────┐  │
│  │  Chat View (custom message renderer)   │  │
│  │  🧑‍💻 kai: Let me clean up the API     │  │
│  │  👩‍🔬 elena: I'll add test coverage     │  │
│  │  👤 You: @dev can you update the docs? │  │
│  └────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────┐  │
│  │  Status Bar (widget below editor)      │  │
│  │  🧑‍💻 kai ●  👩‍🔬 elena 💭  🧑‍🚀 dev ●   │  │
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
