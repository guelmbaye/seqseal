#!/usr/bin/env node
// Thin launcher so the `pwps` bin exists before the package is built.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");
if (!existsSync(dist)) {
  console.error("pwps: not built yet. Run `pnpm --filter @pwps/core build` (or `pnpm pwps …` from the monorepo root).");
  process.exit(2);
}
await import(dist);
