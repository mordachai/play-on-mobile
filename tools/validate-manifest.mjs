#!/usr/bin/env node
/**
 * Framework-free sanity check for module.json — catches "module won't even
 * load" mistakes before opening Foundry. Run manually: node tools/validate-manifest.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const moduleRoot = join(__dirname, "..");
const manifestPath = join(moduleRoot, "module.json");

let errors = 0;
const fail = (msg) => {
  console.error(`FAIL: ${msg}`);
  errors++;
};
const ok = (msg) => console.log(`OK:   ${msg}`);

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  ok("module.json is valid JSON");
} catch (err) {
  fail(`module.json failed to parse: ${err.message}`);
  process.exit(1);
}

const requiredFields = ["id", "title", "version", "compatibility", "esmodules"];
for (const field of requiredFields) {
  if (manifest[field] === undefined) fail(`module.json missing required field "${field}"`);
  else ok(`module.json has field "${field}"`);
}

const folderName = basename(moduleRoot);
if (manifest.id !== folderName) {
  fail(`module.json id "${manifest.id}" does not match folder name "${folderName}"`);
} else {
  ok(`id matches folder name ("${folderName}")`);
}

function checkPaths(list, label) {
  if (!Array.isArray(list)) return;
  for (const entry of list) {
    const relPath = typeof entry === "string" ? entry : entry.path ?? entry.src;
    if (!relPath) continue;
    const abs = join(moduleRoot, relPath);
    if (existsSync(abs)) ok(`${label} path exists: ${relPath}`);
    else fail(`${label} path missing on disk: ${relPath}`);
  }
}

checkPaths(manifest.esmodules, "esmodule");
checkPaths(manifest.styles, "style");
checkPaths(manifest.languages, "language");

if (errors > 0) {
  console.error(`\n${errors} problem(s) found.`);
  process.exit(1);
} else {
  console.log("\nmodule.json looks good.");
}
