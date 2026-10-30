import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { classifyBuiltin, defaultTitle } from "../dist/tui.js";

// The host registry is authoritative: a plugin the host marks
// `source: "builtin"` is a host section regardless of its id, and a third-party
// plugin that publishes under the `opencode.` namespace is not.
test("classifyBuiltin prefers the host registry over the id prefix", () => {
  const registry = new Set(["opencode.sidebar.mcp", "opencode.sidebar.todo"]);
  assert.equal(classifyBuiltin("opencode.sidebar.mcp", registry), true);
  assert.equal(classifyBuiltin("opencode.sidebar.todo", registry), true);
  // Third-party plugin under the opencode namespace: not a built-in.
  assert.equal(classifyBuiltin("opencode.filebrowser.tui", registry), false);
  assert.equal(classifyBuiltin("opencode.file-viewer.tui", registry), false);
  assert.equal(classifyBuiltin("mcp.manager", registry), false);
});

// Without a registry the id prefix is the only signal available, so it is kept
// as a fallback. This is the pre-existing behaviour and stays as-is.
test("classifyBuiltin falls back to the id prefix when the registry is empty", () => {
  for (const ids of [undefined, new Set()]) {
    assert.equal(classifyBuiltin("opencode.sidebar.mcp", ids), true);
    assert.equal(classifyBuiltin("opencode.home.footer", ids), true);
    assert.equal(classifyBuiltin("opencode/filebrowser", ids), true);
    assert.equal(classifyBuiltin("opencode.filebrowser.tui", ids), true);
    assert.equal(classifyBuiltin("mcp.manager", ids), false);
    assert.equal(classifyBuiltin("plugins.pane", ids), false);
    assert.equal(classifyBuiltin("opencode-skills-tui", ids), false);
  }
});

test("defaultTitle drops surface qualifiers and expands acronyms", () => {
  assert.equal(defaultTitle("opencode.filebrowser.tui"), "Filebrowser");
  assert.equal(defaultTitle("opencode.sidebar.mcp"), "MCP");
  assert.equal(defaultTitle("pr-dashboard.tui"), "Pr Dashboard");
  assert.equal(defaultTitle("graph-live.cli"), "Graph Live");
  assert.equal(defaultTitle("opencode-teams.tui"), "Teams");
  assert.equal(defaultTitle("opencode-skills-tui"), "Skills");
  assert.equal(defaultTitle("streetturtle.current-prompt"), "Current Prompt");
  assert.equal(defaultTitle("timezone.clocks"), "Clocks");
  assert.equal(defaultTitle("mcp.manager"), "Manager");
});

// The registry rule and the per-id override have to be wired into the plugin,
// not just the helper: isManaged must consult the host registry, manageIds and
// the per-section `managed` flag.
test("per-id builtin adoption is wired into the plugin source", async () => {
  const source = await readFile("src/tui.tsx", "utf8");
  assert.match(source, /manageIds: \[\]/);
  assert.match(source, /source === "builtin"/);
  assert.match(source, /classifyBuiltin\(id, hostBuiltins\(\)\)/);
  assert.match(source, /manageIds\(\)\.has\(id\)/);
  assert.match(source, /const override = section\(id\)\.managed/);
  assert.match(source, /managed\?: boolean/);
});
