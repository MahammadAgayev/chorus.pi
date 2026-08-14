import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { discoverPersonas, getPersona, listPersonaNames } from "../personas.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "fixtures", "agents");

// ---------------------------------------------------------------------------
// discoverPersonas
// ---------------------------------------------------------------------------

describe("discoverPersonas", () => {
  it("should_return_a_map_of_personas", () => {
    const personas = discoverPersonas(FIXTURES_DIR);
    assert.ok(personas instanceof Map, "Should return a Map");
    assert.ok(personas.size > 0, "Should discover at least one persona");
  });

  it("should_key_personas_by_lowercase_name", () => {
    const personas = discoverPersonas(FIXTURES_DIR);
    for (const [key, persona] of personas) {
      assert.equal(key, persona.name.toLowerCase(), `Key '${key}' should match lowercase persona name '${persona.name}'`);
    }
  });

  it("should_include_known_agent_dev", () => {
    const personas = discoverPersonas(FIXTURES_DIR);
    assert.ok(personas.has("dev"), "Should have 'dev' persona");
    const dev = personas.get("dev")!;
    assert.equal(dev.name, "dev");
    assert.ok(dev.avatar, "dev should have an avatar");
    assert.ok(dev.specialization, "dev should have a specialization");
    assert.ok(dev.systemPrompt.length > 0, "dev should have a non-empty systemPrompt");
  });

  it("should_include_known_agent_elena", () => {
    const personas = discoverPersonas(FIXTURES_DIR);
    assert.ok(personas.has("elena"), "Should have 'elena' persona");
    const elena = personas.get("elena")!;
    assert.equal(elena.name, "elena");
    assert.equal(elena.avatar, "👩‍🔬");
  });

  it("should_parse_all_required_fields_for_each_persona", () => {
    const personas = discoverPersonas(FIXTURES_DIR);
    for (const [name, persona] of personas) {
      assert.ok(persona.name, `${name} should have a name`);
      assert.ok(persona.avatar, `${name} should have an avatar`);
      assert.ok(persona.specialization, `${name} should have a specialization`);
      assert.ok(typeof persona.description === "string", `${name} should have a description string`);
      assert.ok(persona.systemPrompt.length > 0, `${name} should have a non-empty systemPrompt`);
    }
  });

  it("should_return_empty_map_for_nonexistent_directory", () => {
    const personas = discoverPersonas("/tmp/nonexistent-chorus-test-dir");
    assert.equal(personas.size, 0, "Should return empty map when directory doesn't exist");
  });
});

// ---------------------------------------------------------------------------
// getPersona — these use the default dir (environment-dependent)
// so we only test the fallback behavior here
// ---------------------------------------------------------------------------

describe("getPersona", () => {
  it("should_return_fallback_persona_for_unknown_name", () => {
    const unknown = getPersona("nonexistent-agent-xyz");
    assert.equal(unknown.name, "nonexistent-agent-xyz", "Fallback should preserve the requested name");
    assert.equal(unknown.avatar, "🤖", "Fallback should use robot emoji");
    assert.ok(unknown.systemPrompt.length > 0, "Fallback should have a systemPrompt");
  });

  it("should_return_persona_with_all_required_fields", () => {
    // Use fallback to avoid env dependency
    const persona = getPersona("fallback-test-agent");
    assert.ok("name" in persona, "Should have name");
    assert.ok("avatar" in persona, "Should have avatar");
    assert.ok("specialization" in persona, "Should have specialization");
    assert.ok("description" in persona, "Should have description");
    assert.ok("systemPrompt" in persona, "Should have systemPrompt");
  });
});

// ---------------------------------------------------------------------------
// listPersonaNames — uses discoverPersonas internally, so env-dependent
// We test the shape, not specific content
// ---------------------------------------------------------------------------

describe("listPersonaNames", () => {
  it("should_return_array_of_strings", () => {
    const names = listPersonaNames();
    assert.ok(Array.isArray(names), "Should return an array");
    for (const name of names) {
      assert.equal(typeof name, "string", "Each name should be a string");
    }
  });

  it("should_return_lowercase_names", () => {
    const names = listPersonaNames();
    for (const name of names) {
      assert.equal(name, name.toLowerCase(), `Name '${name}' should be lowercase`);
    }
  });

  it("should_match_discoverPersonas_keys", () => {
    const names = listPersonaNames();
    const personas = discoverPersonas();
    const keys = Array.from(personas.keys()).sort();
    assert.deepStrictEqual(names.sort(), keys, "listPersonaNames should match discoverPersonas keys");
  });
});
