#!/usr/bin/env node
// Syntax-check every Terraform file under infrastructure/terraform with the
// HCL2 parser from @cdktf/hcl2json (no Terraform binary / registry needed).
//
//   node scripts/check-hcl.mjs        (or: pnpm hcl:check)
//
// Checks *.tf plus the HCL example files (*.tf.example, *.tfvars.example).
// Prints OK/ERROR per file and exits 1 if any file fails to parse.
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import hcl from "@cdktf/hcl2json";

const { parse } = hcl;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tfRoot = join(repoRoot, "infrastructure", "terraform");
const HCL_FILE = /\.(tf|tf\.example|tfvars\.example)$/;

async function collect(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === ".terraform" || entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await collect(full)));
    else if (entry.isFile() && HCL_FILE.test(entry.name)) out.push(full);
  }
  return out;
}

let files;
try {
  files = (await collect(tfRoot)).sort();
} catch (err) {
  console.error(`ERROR cannot read ${relative(repoRoot, tfRoot)}: ${err.message}`);
  process.exit(1);
}

if (files.length === 0) {
  console.error(`ERROR no Terraform files found under ${relative(repoRoot, tfRoot)}`);
  process.exit(1);
}

let failures = 0;
for (const file of files) {
  const rel = relative(repoRoot, file);
  try {
    // hcl2json only parses files named *.tf / *.tfvars; give examples a .tf name.
    const parseName = rel.replace(/\.example$/, "").replace(/\.tfvars$/, ".tfvars.tf");
    await parse(parseName, await readFile(file, "utf8"));
    console.log(`OK     ${rel}`);
  } catch (err) {
    failures += 1;
    console.log(`ERROR  ${rel}\n       ${String(err?.message ?? err).replace(/\n/g, "\n       ")}`);
  }
}

console.log(`\n${files.length - failures}/${files.length} files parsed${failures ? `, ${failures} error(s)` : ""}.`);
process.exit(failures ? 1 : 0);
