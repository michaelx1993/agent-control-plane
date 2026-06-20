#!/usr/bin/env node
import fs from "node:fs";

const packageFile = process.env.ACP_DOC_SCRIPT_PARITY_PACKAGE_FILE ?? "package.json";
const localSmokeFile =
  process.env.ACP_DOC_SCRIPT_PARITY_LOCAL_SMOKE_FILE ?? "scripts/local-completion-smoke.sh";
const docFiles = (
  process.env.ACP_DOC_SCRIPT_PARITY_DOC_FILES ??
  [
    "docs/agent-control-plane-production-runbook.md",
    "docs/agent-control-plane-status.md",
    "docs/agent-control-plane-roadmap.md",
  ].join(",")
)
  .split(",")
  .map((file) => file.trim())
  .filter(Boolean);
const localSmokeDocFiles = (
  process.env.ACP_DOC_SCRIPT_PARITY_LOCAL_DOC_FILES ??
  ["docs/agent-control-plane-production-runbook.md", "docs/agent-control-plane-status.md"].join(",")
)
  .split(",")
  .map((file) => file.trim())
  .filter(Boolean);

const localSmokeStepDocs = new Map([
  ["git_diff_check", "git diff --check"],
  ["script_syntax_check", "脚本语法检查"],
  ["doc_script_parity_smoke", "doc-script-parity-smoke"],
  ["check", "pnpm check"],
  ["db_validate", "pnpm db:validate"],
  ["secrets_validate", "pnpm secrets:validate"],
  ["core_db_plane_build", "Core/DB/Plane build"],
  ["operator_query_smoke", "operator:query-smoke"],
  ["linear_migration_smoke", "linear:migrate-smoke"],
  ["plane_human_gate_writeback_smoke", "plane:human-gate-writeback-smoke"],
  ["worker_codex_plane_smoke_skip", "worker:codex-plane-smoke"],
  [
    "worker_codex_plane_app_server_smoke_skip",
    "WORKER_EXECUTION_ADAPTER=codex-app-server pnpm worker:codex-plane-smoke",
  ],
  [
    "worker_codex_plane_app_server_followup_smoke_skip",
    "WORKER_EXECUTION_ADAPTER=codex-app-server WORKER_CODEX_PLANE_SMOKE_FOLLOW_UP=true pnpm worker:codex-plane-smoke",
  ],
  ["worker_codex_plane_report_smoke", "worker:codex-plane-report-smoke"],
  ["openhands_payload_contract", "openhands:payload-contract"],
  ["task_source_local_smoke", "task-source:local-smoke"],
  ["cutover_report_smoke", "cutover:report-smoke"],
  ["external_preflight_smoke", "external:preflight-smoke"],
  ["completion_doctor_smoke", "completion:doctor-smoke"],
  ["completion_gap_smoke", "completion:gap-smoke"],
  ["completion_final_env_template_smoke", "completion:final-env-template-smoke"],
  ["completion_audit_smoke", "completion:audit-smoke"],
  ["completion_final_smoke", "completion:final-smoke"],
  ["completion_local_web_build_smoke", "completion:local-web-build-smoke"],
  ["web_build", "Web production build"],
]);

function readText(file) {
  return fs.readFileSync(file, "utf8");
}

function readDocs(files) {
  return files.map((file) => ({ file, content: readText(file) }));
}

function packageScriptNeedsDoc(name) {
  return (
    name.startsWith("completion:") ||
    name.startsWith("cutover:") ||
    name === "smoke:production" ||
    name.endsWith(":smoke") ||
    name.endsWith("-smoke")
  );
}

function docsContain(docs, token) {
  return docs.some(({ content }) => content.includes(token));
}

function parseLocalSmokeSteps(content) {
  return [...content.matchAll(/^\s*run_step\s+"([^"]+)"/gm)].map((match) => match[1]);
}

const errors = [];
const packageJson = JSON.parse(readText(packageFile));
const scripts = packageJson.scripts ?? {};
const docs = readDocs(docFiles);
const localDocs = readDocs(localSmokeDocFiles);
const localSmokeContent = readText(localSmokeFile);
const localSmokeSteps = parseLocalSmokeSteps(localSmokeContent);
const localSmokeStepSet = new Set(localSmokeSteps);

for (const scriptName of Object.keys(scripts).filter(packageScriptNeedsDoc).sort()) {
  if (!docsContain(docs, scriptName)) {
    errors.push(`missing docs entry for package script: ${scriptName}`);
  }
}

for (const stepName of localSmokeSteps) {
  const docToken = localSmokeStepDocs.get(stepName);
  if (!docToken) {
    errors.push(`missing local smoke parity mapping for run_step: ${stepName}`);
    continue;
  }

  for (const { file, content } of localDocs) {
    if (!content.includes(docToken)) {
      errors.push(`missing local smoke step in ${file}: ${stepName} (${docToken})`);
    }
  }
}

for (const stepName of localSmokeStepDocs.keys()) {
  if (!localSmokeStepSet.has(stepName)) {
    errors.push(`stale local smoke parity mapping without run_step: ${stepName}`);
  }
}

if (errors.length > 0) {
  console.error("doc_script_parity=failed");
  for (const error of errors) {
    console.error(`error=${error}`);
  }
  process.exit(1);
}

console.log("doc_script_parity=passed");
console.log(`package_scripts_checked=${Object.keys(scripts).filter(packageScriptNeedsDoc).length}`);
console.log(`local_smoke_steps_checked=${localSmokeSteps.length}`);
