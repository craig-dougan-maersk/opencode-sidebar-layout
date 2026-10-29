import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSync } from "@babel/core";
import test from "node:test";

function walk(node, visit) {
  if (!node || typeof node !== "object") return;
  visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((child) => walk(child, visit));
    else if (value && typeof value === "object") walk(value, visit);
  }
}

function validateJavaScript(code) {
  const ast = parseSync(code, { babelrc: false, configFile: false });
  const imports = new Set();
  let filesystemImport = false;
  walk(ast, (node) => {
    assert.ok(!node.type?.startsWith("JSX") && !node.type?.startsWith("TS"));
    if (node.type === "ImportDeclaration") imports.add(node.source.value);
    if (node.type === "StringLiteral") {
      assert.ok(
        !/^react(?:-dom)?(?:\/|$)/.test(node.value),
        "React import found",
      );
    }
    if (node.type === "Identifier") assert.notEqual(node.name, "React");
    if (node.type === "CallExpression" && node.callee.type === "Import") {
      filesystemImport ||= node.arguments[0]?.value === "node:fs";
    }
  });
  assert.deepEqual([...imports].sort(), [
    "@opencode/plugin/tui",
    "@opentui/core",
    "@opentui/solid",
    "solid-js",
  ]);
  assert.ok(filesystemImport, "Preserve external dynamic filesystem imports");
}

test("Git package exports compiled JavaScript rather than raw TSX", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  assert.equal(manifest.exports["./tui"], "./dist/tui.js");
  execFileSync("git", ["ls-files", "--error-unmatch", "dist/tui.js"], {
    stdio: "pipe",
  });
  validateJavaScript(await readFile("dist/tui.js", "utf8"));
});

test("output validator rejects React transforms, JSX and TypeScript", () => {
  for (const code of [
    'import React from "react";',
    'import {jsx} from "react/jsx-runtime";',
    "const panel = <box />;",
    "const count: number = 0;",
  ]) {
    assert.throws(() => validateJavaScript(code));
  }
});

test("committed output is fresh", () => {
  execFileSync(process.execPath, ["scripts/build.mjs", "--check"], {
    stdio: "pipe",
  });
});

test("build writes output and rejects stale, missing, invalid and empty inputs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sidebar-layout-build-"));
  const script = fileURLToPath(
    new URL("../scripts/build.mjs", import.meta.url),
  );
  const run = (...args) =>
    execFileSync(process.execPath, [script, ...args], {
      cwd: directory,
      stdio: "pipe",
    });
  try {
    assert.throws(() => run());
    await mkdir(join(directory, "src"));
    await writeFile(
      join(directory, "src/tui.tsx"),
      await readFile("src/tui.tsx"),
    );
    run();
    validateJavaScript(await readFile(join(directory, "dist/tui.js"), "utf8"));
    run("--check");
    await writeFile(join(directory, "dist/tui.js"), "// stale\n");
    assert.throws(() => run("--check"), /stale; run npm run compile/);
    assert.equal(
      await readFile(join(directory, "dist/tui.js"), "utf8"),
      "// stale\n",
    );
    await rm(join(directory, "dist/tui.js"));
    assert.throws(() => run("--check"));
    await writeFile(join(directory, "src/tui.tsx"), "const invalid = <");
    assert.throws(() => run());
    await writeFile(join(directory, "src/tui.tsx"), "");
    assert.throws(() => run(), /Babel produced no output/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("header retains one supported onMouseDown without duplicate onClick", async () => {
  const ast = parseSync(await readFile("src/tui.tsx", "utf8"), {
    babelrc: false,
    configFile: false,
    parserOpts: { plugins: ["typescript", "jsx"] },
  });
  const attributes = [];
  walk(ast, (node) => {
    if (node.type === "JSXAttribute") attributes.push(node.name.name);
  });
  assert.equal(attributes.filter((name) => name === "onMouseDown").length, 1);
  assert.ok(!attributes.includes("onClick"));
});

test("sidebar sections are adopted from sibling plugins and default to collapsed", async () => {
  const compiled = await readFile("dist/tui.js", "utf8");
  // Default is collapsed: the option only expands when explicitly set to false.
  assert.match(
    compiled,
    /context\.options\?\.collapsedByDefault\s*!==\s*false/,
    "the collapsed default must be driven by the plugin option",
  );
  // Adoption reads the host's resolved slot graph and re-renders what it displaced.
  assert.match(compiled, /slots\.resolved\(\)/);
  assert.match(compiled, /suppressed/);
  // No section may keep the old hard-coded expanded default.
  assert.doesNotMatch(
    compiled,
    /mcpCost:\s*true/,
    "sections must not default to expanded",
  );
  const source = await readFile("src/tui.tsx", "utf8");
  // Two-phase claim: probe with prepend, then replace once the host is found.
  assert.match(source, /prepend:\s*SIDEBAR_SLOT/);
  assert.match(source, /replace:\s*SIDEBAR_SLOT/);
  // `mode: "coexist"` disables adoption entirely.
  assert.match(source, /mode\s*!==\s*"coexist"/);
  // Host built-ins pass through unless explicitly adopted.
  assert.match(source, /isManaged\s*=\s*\(id: string\)/);
  // The re-implemented sections and their hard-coded ids are gone.
  assert.doesNotMatch(source, /SECTIONS/);
  assert.doesNotMatch(source, /mcpCost/);
});

test("setup claims the sidebar in adopt mode and stays inert in coexist mode", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sidebar-layout-setup-"));
  try {
    await mkdir(join(directory, ".config", "opencode"), { recursive: true });
    const probe = `
      const fs = require("node:fs");
      const path = require("node:path");
      (async () => {
        process.env.HOME = process.argv[1];
        const { default: plugin } = await import(process.argv[2]);
        const calls = [];
        const context = {
          options: { collapsedByDefault: true },
          location: {},
          theme: { text: { base: "base", error: "error" } },
          ui: { slot: (claim) => { calls.push(claim); return () => {}; } },
          keymap: { layer: () => {}, commands: () => [], dispatch: () => {} },
          client: { plugin: { list: async () => [] } },
          data: { location: { default: () => ({}) } },
        };
        const dispose = await plugin.setup(context);
        const adopt = {
          count: calls.length,
          keys: Object.keys(calls[0] || {}).sort(),
          render: typeof (calls[0] || {}).render,
          dispose: typeof dispose,
        };
        calls.length = 0;
        fs.writeFileSync(
          path.join(process.argv[1], ".config", "opencode", "sidebar-layout.json"),
          JSON.stringify({ mode: "coexist" }),
        );
        await plugin.setup(context);
        process.stdout.write(
          JSON.stringify({ id: plugin.id, adopt, coexist: calls.length }),
        );
      })().catch((error) => {
        process.stderr.write(String((error && error.stack) || error));
        process.exit(1);
      });
    `;
    const output = execFileSync(
      process.execPath,
      ["--conditions=browser", "-e", probe, directory, resolve("dist/tui.js")],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    const result = JSON.parse(output);
    assert.equal(result.id, "sidebar.layout");
    assert.equal(result.adopt.count, 1);
    assert.deepEqual(result.adopt.keys, ["prepend", "render"]);
    assert.equal(result.adopt.render, "function");
    assert.equal(result.adopt.dispose, "function");
    assert.equal(result.coexist, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("root graph alone resolves patched Seroval", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
  const installed = JSON.parse(
    await readFile("node_modules/seroval/package.json", "utf8"),
  );
  assert.equal(manifest.overrides.seroval, "1.6.8");
  const resolutions = Object.entries(lock.packages).filter(([path]) =>
    path.endsWith("node_modules/seroval"),
  );
  assert.equal(resolutions.length, 1);
  assert.equal(resolutions[0][1].version, "1.6.8");
  assert.equal(installed.version, "1.6.8");
});

test("scripts-disabled archive contains only documented compiled export", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sidebar-layout-package-"));
  try {
    const packed = JSON.parse(
      execFileSync(
        "npm",
        ["pack", "--ignore-scripts", "--json", "--pack-destination", directory],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      ),
    )[0];
    assert.deepEqual(packed.files.map((file) => file.path).sort(), [
      "README.md",
      "dist/tui.js",
      "package.json",
    ]);
    const extract = (path) =>
      execFileSync(
        "tar",
        ["-xOf", join(directory, packed.filename), `package/${path}`],
        { encoding: "utf8" },
      );
    assert.equal(
      JSON.parse(extract("package.json")).exports["./tui"],
      "./dist/tui.js",
    );
    validateJavaScript(extract("dist/tui.js"));
    await writeFile(join(directory, "tui.mjs"), extract("dist/tui.js"));
    execFileSync(process.execPath, ["--check", join(directory, "tui.mjs")], {
      stdio: "pipe",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
