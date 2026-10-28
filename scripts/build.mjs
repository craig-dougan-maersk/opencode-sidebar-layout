import { mkdir, readFile, writeFile } from "node:fs/promises";
import { transformFileAsync } from "@babel/core";
import solidPreset from "babel-preset-solid";
import typescriptPreset from "@babel/preset-typescript";

try {
  const result = await transformFileAsync("src/tui.tsx", {
    babelrc: false,
    configFile: false,
    sourceMaps: false,
    presets: [
      [solidPreset, { generate: "universal", moduleName: "@opentui/solid" }],
      [typescriptPreset, { allExtensions: true, isTSX: true }],
    ],
  });
  if (!result.code) throw new Error("Babel produced no output");
  const output = `${result.code}\n`;
  if (process.argv.includes("--check")) {
    const existing = await readFile("dist/tui.js", "utf8");
    if (existing !== output) {
      throw new Error(
        "dist/tui.js is stale; run npm run compile and commit the output",
      );
    }
  } else {
    await mkdir("dist", { recursive: true });
    await writeFile("dist/tui.js", output);
  }
} catch (error) {
  console.error("TUI build failed:", error);
  process.exitCode = 1;
}
