import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import type { AgentPersona } from "./types.ts";

let __dirname: string;
try {
  __dirname = path.dirname(fileURLToPath(import.meta.url));
} catch {
  __dirname = process.cwd();
}

// Personas are loaded exclusively from the user-level config directory
const AGENTS_DIR = path.join(getAgentDir(), "chorus", "agents");

// Sample personas bundled with the package (for copying during setup)
const SAMPLE_AGENTS_DIR = path.join(__dirname, "agents");

/**
 * Get the directory where persona files are loaded from.
 */
export function getPersonasDir(): string {
  return AGENTS_DIR;
}

/**
 * Get the directory where sample personas are bundled (src/agents/).
 */
export function getSampleAgentsDir(): string {
  return SAMPLE_AGENTS_DIR;
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
 * Load all .md persona files from a directory into the map.
 * Later calls overwrite earlier entries with the same name.
 */
function loadPersonasFromDir(dir: string, personas: Map<string, AgentPersona>): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.name.endsWith(".md")) continue;
    const persona = loadPersonaFromFile(path.join(dir, entry.name));
    if (persona) {
      personas.set(persona.name.toLowerCase(), persona);
    }
  }
}

/**
 * Discover all available personas from ~/.pi/agent/chorus/agents/.
 * @param dir — override the persona directory (used by tests)
 */
export function discoverPersonas(dir?: string): Map<string, AgentPersona> {
  const personas = new Map<string, AgentPersona>();
  loadPersonasFromDir(dir ?? AGENTS_DIR, personas);
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
