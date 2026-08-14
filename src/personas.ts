import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import type { AgentPersona } from "./types.ts";

let __dirname: string;
try {
  __dirname = path.dirname(fileURLToPath(import.meta.url));
} catch {
  // Fallback for environments where import.meta.url is not a file URL
  __dirname = process.cwd();
}

// Try the directory relative to this file first, then fall back to cwd-relative
const AGENTS_DIR_CANDIDATES = [
  path.join(__dirname, "agents"),
  path.join(process.cwd(), "src", "agents"),
];

function getAgentsDir(): string {
  for (const dir of AGENTS_DIR_CANDIDATES) {
    try {
      fs.accessSync(dir);
      return dir;
    } catch {
      continue;
    }
  }
  return AGENTS_DIR_CANDIDATES[0]; // default even if not found
}

/**
 * Load a single persona from a markdown file.
 */
function loadPersonaFromFile(filePath: string): AgentPersona | null {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }

  const { frontmatter, body } = parseFrontmatter<Record<string, string>>(content);
  if (!frontmatter.name) {
    console.warn(`[chorus] Persona file missing 'name' in frontmatter: ${filePath}`);
    return null;
  }

  const tools = frontmatter.tools
    ?.split(",")
    .map((t: string) => t.trim())
    .filter(Boolean);

  return {
    name: frontmatter.name,
    avatar: frontmatter.avatar ?? "🤖",
    specialization: frontmatter.specialization ?? "General",
    description: frontmatter.description ?? "",
    systemPrompt: body.trim(),
    tools: tools && tools.length > 0 ? tools : undefined,
    model: frontmatter.model,
  };
}

/**
 * Discover all available personas from the agents/ directory.
 */
export function discoverPersonas(): Map<string, AgentPersona> {
  const personas = new Map<string, AgentPersona>();

  const agentsDir = getAgentsDir();
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(agentsDir, { withFileTypes: true });
  } catch {
    console.warn(`[chorus] Agents directory not found: ${agentsDir}. No personas will be available.`);
    return personas;
  }

  for (const entry of entries) {
    if (!entry.name.endsWith(".md")) continue;
    const filePath = path.join(agentsDir, entry.name);
    const persona = loadPersonaFromFile(filePath);
    if (persona) {
      personas.set(persona.name.toLowerCase(), persona);
    }
  }

  return personas;
}

/**
 * Get a persona by name. Falls back to a generic persona if not found.
 */
export function getPersona(name: string): AgentPersona {
  const personas = discoverPersonas();
  const found = personas.get(name.toLowerCase());
  if (found) return found;

  // fallback: generic persona
  return {
    name,
    avatar: "🤖",
    specialization: "General Engineering",
    description: `General-purpose agent: ${name}`,
    systemPrompt: `You are ${name}, a general-purpose software engineer. Help with whatever the team needs.`,
  };
}

/**
 * List all available persona names.
 */
export function listPersonaNames(): string[] {
  return Array.from(discoverPersonas().keys());
}
