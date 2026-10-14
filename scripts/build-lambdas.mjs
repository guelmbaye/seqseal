#!/usr/bin/env node
/**
 * Bundle every Lambda in services/* with esbuild (ESM, node22, arm64-agnostic) and zip it
 * to services/<name>/dist/<name>.zip — the path Terraform reads (lambda_artifacts_dir).
 *
 * Each bundle carries the active configuration under seqseal-config/ (protocols, policies,
 * source bindings, demo fixtures); Lambdas read it via SEQSEAL_CONFIG_DIR. Protocols and
 * policies are therefore versioned and hashed exactly as they were deployed.
 */
import { build } from "esbuild";
import { cpSync, createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yazl from "yazl";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const services = readdirSync(join(root, "services")).filter((s) => existsSync(join(root, "services", s, "src", "index.ts")) && (!only.length || only.includes(s)));

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function zipDir(dir, out) {
  return new Promise((res, rej) => {
    const zip = new yazl.ZipFile();
    // Fixed mtime → reproducible archives (stable source_code_hash when nothing changed).
    for (const f of walk(dir).sort()) zip.addFile(f, relative(dir, f).split("\\").join("/"), { mtime: new Date("2026-01-01T00:00:00Z"), mode: 0o100644 });
    zip.end();
    zip.outputStream.pipe(createWriteStream(out)).on("close", res).on("error", rej);
  });
}

const t0 = Date.now();
for (const name of services) {
  const svc = join(root, "services", name);
  const stage = join(svc, "dist", "build");
  rmSync(join(svc, "dist"), { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  const result = await build({
    entryPoints: [join(svc, "src", "index.ts")],
    outfile: join(stage, "index.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    sourcemap: true,
    minify: false,
    legalComments: "none",
    metafile: true,
    // CJS dependencies (ajv, yazl…) still call require(): provide it in ESM.
    banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
    logLevel: "warning",
  });
  const cfg = join(stage, "seqseal-config");
  for (const d of ["protocols", "policies", "config", "fixtures/scenarios"]) cpSync(join(root, d), join(cfg, d), { recursive: true });
  const zip = join(svc, "dist", `${name}.zip`);
  await zipDir(stage, zip);
  const kb = Math.round(statSync(zip).size / 1024);
  const inputs = Object.keys(result.metafile.inputs).length;
  console.log(`✓ ${name.padEnd(26)} ${String(kb).padStart(5)} KB  (${inputs} modules)`);
}
console.log(`\n${services.length} Lambda bundles in ${((Date.now() - t0) / 1000).toFixed(1)} s → services/<name>/dist/<name>.zip`);
