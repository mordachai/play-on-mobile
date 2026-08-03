#!/usr/bin/env node
/**
 * CLI wrapper around scripts/adapters/validate-descriptor.mjs (the browser-
 * safe pure validator, also used live by the world-setting descriptor
 * override's Validate button — see foundry-settings-panel.mjs). Same house
 * style as validate-manifest.mjs — no dependencies, catches "the engine will
 * silently no-op this" mistakes before opening Foundry.
 *
 * Usage: node tools/validate-descriptor.mjs <path-to-descriptor.json>
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { validateDescriptor } from "../scripts/adapters/validate-descriptor.mjs";

export { validateDescriptor };

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: node tools/validate-descriptor.mjs <path-to-descriptor.json>");
    process.exit(1);
  }

  let descriptor;
  try {
    descriptor = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    console.error(`FAIL: ${file} failed to parse: ${err.message}`);
    process.exit(1);
  }

  const { errors } = validateDescriptor(descriptor);
  if (errors.length) {
    for (const e of errors) console.error(`FAIL: ${e}`);
    console.error(`\n${errors.length} problem(s) found.`);
    process.exit(1);
  }
  console.log(`OK: ${file} is a valid descriptor.`);
}
