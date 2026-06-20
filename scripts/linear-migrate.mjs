#!/usr/bin/env node
import fs from "node:fs";
import {
  loadPlaneConfig,
  PlaneClient,
  runLinearToPlaneMigration,
} from "../packages/plane/dist/index.js";

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function readBoolean(name, defaultValue = false) {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return defaultValue;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${name} must be true or false`);
}

const exportPath = requireEnv("LINEAR_EXPORT_PATH");
const exportJson = JSON.parse(fs.readFileSync(exportPath, "utf8"));
const config = loadPlaneConfig();
const client = new PlaneClient({ baseUrl: config.baseUrl, apiKey: config.apiKey });
const result = await runLinearToPlaneMigration({
  config,
  exportJson,
  apply: readBoolean("LINEAR_MIGRATION_APPLY", false),
  includeTerminal: readBoolean("LINEAR_MIGRATION_INCLUDE_TERMINAL", false),
  client,
});

const missingLabelCandidates = result.candidates.filter(
  (candidate) => candidate.missingLabels.length > 0,
).length;

console.log(
  JSON.stringify(
    {
      apply: result.apply,
      planned: result.planned,
      created: result.created,
      skipped: result.skipped.length,
      missingLabelCandidates,
    },
    null,
    2,
  ),
);
