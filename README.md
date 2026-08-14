# Chorus 🎵

A multi-agent chat collaboration extension for [pi](https://github.com/earendil-works/pi-mono). Spawns a team of AI agents that communicate in a shared group chat, each with their own persona and specialization.

## Prerequisites

- [pi](https://github.com/earendil-works/pi-mono) installed and configured
- Node.js 18+
- A configured AI provider in `~/.pi/agent/` (auth.json + models.json)

## Installation

```bash
git clone <repo-url> chorus
cd chorus
npm install
```

Then set up sample personas:

```bash
# From inside pi:
/chorus setup

# Or manually:
mkdir -p ~/.pi/agent/chorus/agents
cp src/agents/*.md ~/.pi/agent/chorus/agents/
```

`/chorus setup` copies the bundled sample personas to `~/.pi/agent/chorus/agents/`, skipping any that already exist.

## Usage

Launch pi with the chorus extension loaded:

```bash
pi -e ./src/index.ts
```

Then use the chorus commands inside pi:

```bash
# Start a session — pick agents interactively
/chorus start Build a REST API for user management

# Or specify agents directly
/chorus start Build a REST API --agents dev,kai,elena

# Talk to the group
/say @elena what's the status on the auth endpoint?

# Or just type — all input routes to the group chat while chorus is active
hey team, how's it going?

# Check status
/chorus status

# Manage agents mid-session
/chorus add marcus
/chorus pause kai
/chorus resume kai
/chorus remove marcus

# List available personas
/chorus agents

# Stop the session
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
| `/chorus setup` | Copy sample personas to `~/.pi/agent/chorus/agents/` |
| `/say <message>` | Post a message to the group chat |

When chorus is running, all non-slash-command input is routed to the group chat automatically — no need to prefix with `/say`.

## Sample Personas

Three sample personas ship in `src/agents/` for getting started:

| Agent | Avatar | Specialization |
|-------|--------|---------------|
| `dev` | 🧑‍🚀 | Generalist |
| `kai` | 🧑‍💻 | Clean Code |
| `elena` | 👩‍🔬 | Testing & Reliability |

Run `/chorus setup` to copy them to `~/.pi/agent/chorus/agents/`. Add your own or customize from there.

## Creating Custom Personas

Chorus loads personas exclusively from `~/.pi/agent/chorus/agents/`. Drop a `.md` file there and it's auto-discovered.

A sample persona (`dev.md`) ships in `src/agents/` — copy it during installation to get started, or copy all of them:

```bash
cp src/agents/*.md ~/.pi/agent/chorus/agents/
```

### Persona file format

```markdown
---
name: yourname
avatar: 🤖
specialization: Your Specialty
description: One-line description shown in agent picker
model: claude-opus-5-thinking
tools: read,bash,edit,write,grep,find,ls
---

Your persona prompt goes here. This becomes the agent's system prompt.
Write it in second person ("You are...") to define personality, quirks, and behavior.
```

### Frontmatter fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | ✅ | Agent name (used in @mentions and chat). Use lowercase. |
| `avatar` | No | Emoji shown in chat. Defaults to 🤖 |
| `specialization` | No | Short label for the agent's focus area |
| `description` | No | One-line description shown in the agent picker UI |
| `model` | No | Model ID to use (must match an ID in your `~/.pi/agent/models.json`). Falls back to the default model if omitted or unmatched. |
| `tools` | No | Comma-separated list of tools to enable. Defaults to `read,bash,edit,write,grep,find,ls` |

### Example: minimal persona

```markdown
---
name: alex
avatar: 🧑‍🎤
specialization: Frontend Engineer
description: CSS wizard, React enthusiast
---

You are Alex, a frontend engineer who loves clean UI and accessible design.
You think in components. You care about user experience above all else.
```

Then start chorus with your custom agent:

```bash
/chorus start Build a dashboard --agents alex,dev
```

### Model configuration

To use a specific model for a persona, set the `model` field to a model ID from your `~/.pi/agent/models.json`. Run `/chorus agents` to verify your persona was discovered.

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
