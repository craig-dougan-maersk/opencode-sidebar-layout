import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import pacote from "pacote";
import Arborist from "@npmcli/arborist";

const triggers = [
  "build",
  "prepack",
  "prepare",
  "preinstall",
  "install",
  "postinstall",
];

function assertPreparationFree(manifest) {
  assert.ok(
    !Object.hasOwn(manifest, "workspaces"),
    "workspaces trigger preparation",
  );
  for (const name of triggers) {
    assert.ok(
      !Object.hasOwn(manifest.scripts ?? {}, name),
      `${name} triggers preparation`,
    );
  }
}

test("package avoids every Git dependency preparation trigger", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  assertPreparationFree(manifest);
  for (const name of triggers) {
    assert.throws(
      () =>
        assertPreparationFree({
          ...manifest,
          scripts: { ...manifest.scripts, [name]: "exit 1" },
        }),
      new RegExp(`${name} triggers preparation`),
    );
  }
  for (const workspaces of [[], ["packages/*"], {}]) {
    assert.throws(
      () => assertPreparationFree({ ...manifest, workspaces }),
      /workspaces/,
    );
  }
});

test("actual signed Git packages exercise preparation failure and corrected extraction", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sidebar-layout-git-"));
  const git = (...args) =>
    execFileSync("git", args, { encoding: "utf8", stdio: "pipe" });
  try {
    const repo = join(directory, "repo");
    git(
      "clone",
      "--quiet",
      resolve("test/fixtures/git-preparation.bundle"),
      repo,
    );
    git("-C", repo, "checkout", "--quiet", "-b", "fixture", "corrected");
    for (const ref of ["original", "preparation-trap", "corrected"]) {
      // CI reads existing signed objects; it never creates commits or needs a signing key.
      assert.match(git("-C", repo, "cat-file", "commit", ref), /\ngpgsig /);
    }
    const corrected = JSON.parse(
      git("-C", repo, "show", "corrected:package.json"),
    );
    assert.deepEqual(
      corrected,
      JSON.parse(await readFile("package.json", "utf8")),
      "Regenerate the signed fixture after manifest changes",
    );
    assert.equal(
      git("-C", repo, "show", "corrected:dist/tui.js"),
      await readFile("dist/tui.js", "utf8"),
      "Signed fixture must match canonical output",
    );
    const options = (name) => ({
      ignoreScripts: true,
      Arborist,
      cache: join(directory, `${name}-cache`),
      npmBin: join(directory, "unavailable-npm-cli.js"),
    });
    const spec = (ref) =>
      `git+${pathToFileURL(repo).href}#${git("-C", repo, "rev-parse", ref).trim()}`;
    // Original had no preparation triggers, but exported raw TSX rather than JS.
    const originalDestination = join(directory, "original");
    await pacote.extract(
      spec("original"),
      originalDestination,
      options("original"),
    );
    const original = JSON.parse(
      await readFile(join(originalDestination, "package.json"), "utf8"),
    );
    assertPreparationFree(original);
    assert.equal(original.exports["./tui"], "./src/tui.tsx");
    assert.throws(() =>
      assert.equal(original.exports["./tui"], "./dist/tui.js"),
    );
    await assert.rejects(readFile(join(originalDestination, "dist/tui.js")), {
      code: "ENOENT",
    });
    // Synthetic hook regression, not a claim about upstream sidebar packaging.
    await assert.rejects(
      pacote.extract(
        spec("preparation-trap"),
        join(directory, "red"),
        options("red"),
      ),
      (error) =>
        error.message === "git dep preparation failed" &&
        String(error.stderr).includes("unavailable-npm-cli.js"),
    );
    const destination = join(directory, "green");
    await pacote.extract(spec("corrected"), destination, options("green"));
    const installed = JSON.parse(
      await readFile(join(destination, "package.json"), "utf8"),
    );
    assert.equal(installed.exports["./tui"], "./dist/tui.js");
    assert.equal(
      await readFile(join(destination, "dist/tui.js"), "utf8"),
      await readFile("dist/tui.js", "utf8"),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
