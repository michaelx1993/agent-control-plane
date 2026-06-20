#!/usr/bin/env bash
set -euo pipefail

GAP_ID="${ACP_COMPLETION_GAP_ID:-completion-gap-$(date -u +%Y%m%dT%H%M%SZ)-$$}"
REPORT_FILE="${ACP_COMPLETION_GAP_REPORT_FILE:-reports/${GAP_ID}.json}"
VARIABLES_FILE="${ACP_COMPLETION_GAP_VARIABLES_FILE:-reports/${GAP_ID}.variables.txt}"
VARIABLE_MATRIX_FILE="${ACP_COMPLETION_GAP_VARIABLE_MATRIX_FILE:-reports/${GAP_ID}.variables.tsv}"
CHECKLIST_FILE="${ACP_COMPLETION_GAP_CHECKLIST_FILE:-reports/${GAP_ID}.checklist.md}"
ACTION_PLAN_FILE="${ACP_COMPLETION_GAP_ACTION_PLAN_FILE:-reports/${GAP_ID}.action-plan.md}"
DEFAULT_FINAL_ENV_FILE="${ACP_COMPLETION_GAP_DEFAULT_ENV_FILE:-.secrets/completion-final.env}"
COMPLETION_GAP_AUTO_SECRET_ENV_FILE="false"

if [[ -z "${ACP_SECRET_ENV_FILE:-}" && -f "$DEFAULT_FINAL_ENV_FILE" && "${ACP_COMPLETION_GAP_USE_DEFAULT_ENV_FILE:-true}" != "false" ]]; then
  export ACP_SECRET_ENV_FILE="$DEFAULT_FINAL_ENV_FILE"
  COMPLETION_GAP_AUTO_SECRET_ENV_FILE="true"
fi

final_env_file_for_next_command() {
  if [[ -n "${ACP_SECRET_ENV_FILE:-}" ]]; then
    printf '%s' "$ACP_SECRET_ENV_FILE"
  else
    printf '%s' "$DEFAULT_FINAL_ENV_FILE"
  fi
}

final_env_template_command() {
  local final_env_file="$1"
  if [[ -f "$final_env_file" ]]; then
    printf 'ACP_COMPLETION_FINAL_ENV_TEMPLATE_FILE=%s ACP_COMPLETION_FINAL_ENV_TEMPLATE_APPEND_MISSING=true pnpm completion:final-env-template' "$final_env_file"
  else
    printf 'ACP_COMPLETION_FINAL_ENV_TEMPLATE_FILE=%s pnpm completion:final-env-template' "$final_env_file"
  fi
}

export ACP_EXTERNAL_PREFLIGHT_ALLOW_MISSING="true"
export ACP_EXTERNAL_PREFLIGHT_ID="${ACP_EXTERNAL_PREFLIGHT_ID:-${GAP_ID}}"
export ACP_EXTERNAL_PREFLIGHT_REPORT_FILE="$REPORT_FILE"

mkdir -p "$(dirname "$REPORT_FILE")"

OUTPUT_FILE="$(mktemp "${TMPDIR:-/tmp}/acp-completion-gap.XXXXXX")"
cleanup() {
  rm -f "$OUTPUT_FILE"
}
trap cleanup EXIT

pnpm --silent external:preflight >"$OUTPUT_FILE"

status="$(awk -F= '$1 == "external_smoke_preflight" { print $2 }' "$OUTPUT_FILE")"
ready_count="$(awk -F= '$1 == "ready_count" { print $2 }' "$OUTPUT_FILE")"
missing_count="$(awk -F= '$1 == "missing_count" { print $2 }' "$OUTPUT_FILE")"
preflight_id="$(awk -F= '$1 == "external_preflight_id" { print $2 }' "$OUTPUT_FILE")"
final_env_file_for_next_command_value="$(final_env_file_for_next_command)"
final_env_template_command_value="$(final_env_template_command "$final_env_file_for_next_command_value")"

cat <<EOF
completion_gap=reported
completion_gap_status=${status:-unknown}
completion_gap_id=${preflight_id:-$GAP_ID}
completion_gap_report_file=${REPORT_FILE}
completion_gap_variables_file=${VARIABLES_FILE}
completion_gap_variable_matrix_file=${VARIABLE_MATRIX_FILE}
completion_gap_checklist_file=${CHECKLIST_FILE}
completion_gap_action_plan_file=${ACTION_PLAN_FILE}
secret_env_file=${ACP_SECRET_ENV_FILE:-not-set}
default_final_env_file=${DEFAULT_FINAL_ENV_FILE}
default_final_env_file_exists=$(if [[ -f "$DEFAULT_FINAL_ENV_FILE" ]]; then printf 'true'; else printf 'false'; fi)
default_final_env_file_hint=$(if [[ "$COMPLETION_GAP_AUTO_SECRET_ENV_FILE" == "true" ]]; then printf 'using_default_secret_env_file'; elif [[ -n "${ACP_SECRET_ENV_FILE:-}" ]]; then printf 'using_explicit_secret_env_file'; elif [[ -f "$DEFAULT_FINAL_ENV_FILE" ]]; then printf 'use_existing_default_with_ACP_SECRET_ENV_FILE'; else printf 'generate_default_final_env_file'; fi)
ready_count=${ready_count:-0}
missing_count=${missing_count:-0}
next_command_generate_env_template=${final_env_template_command_value}
next_command_run_external_preflight_with_env=ACP_SECRET_ENV_FILE=${final_env_file_for_next_command_value} pnpm external:preflight
next_command_run_gap_with_env=ACP_SECRET_ENV_FILE=${final_env_file_for_next_command_value} pnpm completion:gap
next_command_run_final=ACP_SECRET_ENV_FILE=${final_env_file_for_next_command_value} pnpm completion:final
EOF

if [[ -f "$REPORT_FILE" ]]; then
  mkdir -p "$(dirname "$VARIABLES_FILE")"
  mkdir -p "$(dirname "$VARIABLE_MATRIX_FILE")"
  mkdir -p "$(dirname "$CHECKLIST_FILE")"
  mkdir -p "$(dirname "$ACTION_PLAN_FILE")"
  node - "$REPORT_FILE" "$VARIABLES_FILE" "$VARIABLE_MATRIX_FILE" "$CHECKLIST_FILE" "$ACTION_PLAN_FILE" "$final_env_file_for_next_command_value" "$final_env_template_command_value" <<'NODE'
const fs = require("node:fs");
const reportFile = process.argv[2];
const variablesFile = process.argv[3];
const variableMatrixFile = process.argv[4];
const checklistFile = process.argv[5];
const actionPlanFile = process.argv[6];
const finalEnvFileForNextCommand = process.argv[7];
const finalEnvTemplateCommand = process.argv[8];
const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
const missing = Array.isArray(report.missing) ? report.missing.map(String) : [];
const placeholderCount = missing.filter((item) => item.includes("template placeholder")).length;
const missingRequiredCount = missing.filter((item) => item.includes(" missing (")).length;
const notTrueCount = missing.filter((item) => item.includes(" must be true")).length;
const unsafeUrlCount = missing.filter((item) => /loopback|localhost|0\.0\.0\.0|::1/.test(item)).length;
const executionProfile = String(report.executionProfile ?? process.env.ACP_COMPLETION_EXECUTION_PROFILE ?? "codex-cli");
const completionFinalAutoBoundVariables = new Set([
  "ACP_COMPLETION_FINAL_RUN_ID",
  "ACP_EXTERNAL_PREFLIGHT_ID",
  "ACP_CUTOVER_REPORT_ID",
  "ACP_CUTOVER_REPORT_FILE",
  "ACP_CUTOVER_RUN_PRODUCTION_SMOKE",
  "ACP_CUTOVER_RUN_PLANE_WRITEBACK_SMOKE",
  "ACP_CUTOVER_RUN_TASK_SOURCE_SMOKE",
  "ACP_CUTOVER_RUN_WORKER_CRASH_SMOKE",
  "ACP_CUTOVER_RUN_WORKER_BUDGET_SMOKE",
  "ACP_CUTOVER_RUN_WORKER_WORKFLOW_SMOKE",
  "ACP_CUTOVER_RUN_SECRET_PROVIDER_SMOKE",
  "ACP_CUTOVER_RUN_SECRET_PROVIDER_AUDIT_SMOKE",
  "ACP_CUTOVER_RUN_EXTERNAL_PREFLIGHT",
  "PLANE_WRITEBACK_ENABLED",
  "PLANE_WRITEBACK_SMOKE_APPLY",
  "WORKER_EXECUTION_ADAPTER",
]);
if (executionProfile === "codex-cli") {
  completionFinalAutoBoundVariables.add("ACP_CUTOVER_RUN_CODEX_ADAPTER_SMOKE");
  completionFinalAutoBoundVariables.add("LANGFUSE_ENABLED");
  completionFinalAutoBoundVariables.add("LANGFUSE_SMOKE_DRY_RUN");
} else {
  completionFinalAutoBoundVariables.add("ACP_CUTOVER_RUN_OPENHANDS_SMOKE");
  completionFinalAutoBoundVariables.add("ACP_CUTOVER_RUN_OPENHANDS_ADAPTER_SMOKE");
  completionFinalAutoBoundVariables.add("ACP_CUTOVER_RUN_OPENHANDS_DB_SMOKE");
  completionFinalAutoBoundVariables.add("ACP_CUTOVER_RUN_LANGFUSE_SMOKE");
  completionFinalAutoBoundVariables.add("ACP_SMOKE_EXTERNAL");
  completionFinalAutoBoundVariables.add("LANGFUSE_ENABLED");
  completionFinalAutoBoundVariables.add("LANGFUSE_SMOKE_DRY_RUN");
  completionFinalAutoBoundVariables.add("OPENHANDS_DB_SMOKE_EXPECT_TRACE_REF");
  completionFinalAutoBoundVariables.add("OPENHANDS_SMOKE_CREATE_CONVERSATION");
  completionFinalAutoBoundVariables.add("OPENHANDS_SMOKE_WAIT_READY");
}
const nextCommands = normalizeNextCommands(report.nextCommands, finalEnvFileForNextCommand);
const variableNames = new Set();
const variableMatrix = new Map();
function classifyReason(item) {
  if (item.includes("template placeholder")) return "placeholder";
  if (item.includes(" missing (")) return "missing_required";
  if (item.includes(" must be true")) return "not_true";
  if (/loopback|localhost|0\.0\.0\.0|::1/.test(item)) return "unsafe_url";
  return "other";
}
for (const item of missing) {
  const scope = item.includes(":") ? item.slice(0, item.indexOf(":")).trim() : "unknown";
  const withoutScope = item.includes(":") ? item.slice(item.indexOf(":") + 1).trim() : item;
  const match = withoutScope.match(/^([A-Z][A-Z0-9_]+)\b/);
  const variableName = match ? match[1] : withoutScope.includes("operator token") ? "ACP_OPERATOR_API_TOKEN" : "";
  if (variableName) {
    variableNames.add(variableName);
    const entry = variableMatrix.get(variableName) ?? { scopes: new Set(), reasons: new Set(), count: 0 };
    entry.scopes.add(scope);
    entry.reasons.add(classifyReason(item));
    entry.count += 1;
    variableMatrix.set(variableName, entry);
  }
}
console.log(`missing_placeholders=${placeholderCount}`);
console.log(`missing_required=${missingRequiredCount}`);
console.log(`missing_not_true=${notTrueCount}`);
console.log(`missing_unsafe_urls=${unsafeUrlCount}`);
const sortedVariableNames = Array.from(variableNames).sort();
const autoBoundMissingVariableNames = sortedVariableNames.filter((variableName) =>
  completionFinalAutoBoundVariables.has(variableName),
);
const manualMissingVariableNames = sortedVariableNames.filter(
  (variableName) => !completionFinalAutoBoundVariables.has(variableName),
);
const manualVariablesByReason = {
  missing_required: manualMissingVariableNames.filter((variableName) =>
    variableMatrix.get(variableName)?.reasons.has("missing_required"),
  ),
  placeholder: manualMissingVariableNames.filter((variableName) => variableMatrix.get(variableName)?.reasons.has("placeholder")),
  not_true: manualMissingVariableNames.filter((variableName) => variableMatrix.get(variableName)?.reasons.has("not_true")),
  unsafe_url: manualMissingVariableNames.filter((variableName) => variableMatrix.get(variableName)?.reasons.has("unsafe_url")),
  other: manualMissingVariableNames.filter((variableName) => variableMatrix.get(variableName)?.reasons.has("other")),
};
fs.writeFileSync(variablesFile, `${sortedVariableNames.join("\n")}${sortedVariableNames.length ? "\n" : ""}`, { mode: 0o600 });
fs.chmodSync(variablesFile, 0o600);
const matrixLines = ["variable\tscopes\treason_types\tmissing_count"];
for (const variableName of sortedVariableNames) {
  const entry = variableMatrix.get(variableName) ?? { scopes: new Set(), reasons: new Set(), count: 0 };
  matrixLines.push(
    `${variableName}\t${Array.from(entry.scopes).sort().join(",")}\t${Array.from(entry.reasons).sort().join(",")}\t${entry.count}`,
  );
}
fs.writeFileSync(variableMatrixFile, `${matrixLines.join("\n")}\n`, { mode: 0o600 });
fs.chmodSync(variableMatrixFile, 0o600);
report.generatedArtifacts = {
  ...(report.generatedArtifacts && typeof report.generatedArtifacts === "object" ? report.generatedArtifacts : {}),
  variablesFile,
  variableMatrixFile,
  checklistFile,
  actionPlanFile,
  missingVariablesCount: sortedVariableNames.length,
  missingVariables: sortedVariableNames,
  completionFinalAutoBoundMissingVariablesCount: autoBoundMissingVariableNames.length,
  completionFinalAutoBoundMissingVariables: autoBoundMissingVariableNames,
  manualMissingVariablesCount: manualMissingVariableNames.length,
  manualMissingVariables: manualMissingVariableNames,
  manualVariablesByReason,
};
report.nextCommands = nextCommands;
fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
fs.chmodSync(reportFile, 0o600);
const groupedMissing = new Map();
for (const item of missing) {
  const scope = item.includes(":") ? item.slice(0, item.indexOf(":")).trim() : "unknown";
  const withoutScope = item.includes(":") ? item.slice(item.indexOf(":") + 1).trim() : item;
  const match = withoutScope.match(/^([A-Z][A-Z0-9_]+)\b/);
  const variableName = match ? match[1] : withoutScope.includes("operator token") ? "ACP_OPERATOR_API_TOKEN" : "manual_evidence";
  const entries = groupedMissing.get(scope) ?? [];
  entries.push({
    variableName,
    reason: classifyReason(item),
    autoBound: completionFinalAutoBoundVariables.has(variableName),
    item,
  });
  groupedMissing.set(scope, entries);
}
const checklistLines = [
  "# Completion Gap Checklist",
  "",
  `- Gap ID: ${mdInline(String(report.preflightId ?? "unknown"))}`,
  `- Status: ${mdInline(String(report.status ?? "unknown"))}`,
  `- Generated At: ${mdInline(String(report.generatedAt ?? "unknown"))}`,
  `- Ready Count: ${Number(report.readyCount ?? 0)}`,
  `- Missing Count: ${missing.length}`,
  `- JSON Report: ${mdInline(reportFile)}`,
  `- Variables File: ${mdInline(variablesFile)}`,
  `- Variable Matrix: ${mdInline(variableMatrixFile)}`,
  "",
  "## Next Commands",
  "",
  "```bash",
  ...nextCommands,
  "```",
  "",
  "## Auto-bound By completion:final",
  "",
];
if (autoBoundMissingVariableNames.length === 0) {
  checklistLines.push("No missing variables are auto-bound by `completion:final`.", "");
} else {
  for (const variableName of autoBoundMissingVariableNames) {
    checklistLines.push(`- ${mdInline(variableName)}`);
  }
  checklistLines.push("");
}
checklistLines.push("## Manual Variables By Reason", "");
for (const [reason, variables] of Object.entries(manualVariablesByReason)) {
  checklistLines.push(`### ${mdText(reason)}`, "");
  if (variables.length === 0) {
    checklistLines.push("No variables in this group.", "");
  } else {
    for (const variableName of variables) {
      checklistLines.push(`- ${mdInline(variableName)}`);
    }
    checklistLines.push("");
  }
}
checklistLines.push(
  "## Missing By Scope",
  "",
);
if (groupedMissing.size === 0) {
  checklistLines.push("No missing items reported.", "");
} else {
  for (const [scope, entries] of Array.from(groupedMissing.entries()).sort((left, right) =>
    left[0].localeCompare(right[0]),
  )) {
    checklistLines.push(`### ${mdText(scope)}`, "");
    for (const entry of entries.sort((left, right) => left.variableName.localeCompare(right.variableName))) {
      if (entry.autoBound) {
        checklistLines.push(
          `- [auto] ${mdInline(entry.variableName)} (${entry.reason}) - ${mdText(entry.item)}; ${mdInline("completion:final")} will bind this value automatically.`,
        );
      } else {
        checklistLines.push(`- [ ] ${mdInline(entry.variableName)} (${entry.reason}) - ${mdText(entry.item)}`);
      }
    }
    checklistLines.push("");
  }
}
const readyScopes = Array.isArray(report.scopeSummary)
  ? report.scopeSummary.filter((scope) => String(scope.status ?? "") === "ready")
  : [];
checklistLines.push("## Ready Scopes", "");
if (readyScopes.length === 0) {
  checklistLines.push("No fully ready scopes reported.", "");
} else {
  for (const scope of readyScopes) {
    checklistLines.push(`- ${mdInline(String(scope.scope ?? "unknown"))}`);
  }
  checklistLines.push("");
}
fs.writeFileSync(checklistFile, `${checklistLines.join("\n")}\n`, { mode: 0o600 });
fs.chmodSync(checklistFile, 0o600);
const actionPlanLines = [
  "# Completion Cutover Action Plan",
  "",
  `- Gap ID: ${mdInline(String(report.preflightId ?? "unknown"))}`,
  `- Status: ${mdInline(String(report.status ?? "unknown"))}`,
  `- Ready Count: ${Number(report.readyCount ?? 0)}`,
  `- Missing Count: ${missing.length}`,
  `- Secret Env File: ${mdInline(process.env.ACP_SECRET_ENV_FILE || "not-set")}`,
  `- JSON Report: ${mdInline(reportFile)}`,
  `- Checklist: ${mdInline(checklistFile)}`,
  "",
  "## Operator Sequence",
  "",
  "1. Generate or select the final env file.",
  "",
  "```bash",
  finalEnvTemplateCommand,
  "```",
  "",
  "2. Replace every manual variable below with real production or staging cutover values. Do not fill `completion:final` auto-bound variables by hand unless deliberately doing a split run.",
  "",
  "3. Re-run the external preflight directly when validating a prepared env file outside the gap wrapper.",
  "",
  "```bash",
  `ACP_SECRET_ENV_FILE=${finalEnvFileForNextCommand} pnpm external:preflight`,
  "```",
  "",
  "4. Re-run the gap report until `manual_missing_variables_count=0` and `missing_count` only reflects values intentionally auto-bound by `completion:final`.",
  "",
  "```bash",
  `ACP_SECRET_ENV_FILE=${finalEnvFileForNextCommand} pnpm completion:gap`,
  "```",
  "",
  "5. Run the final gate once preflight is clean.",
  "",
  "```bash",
  `ACP_SECRET_ENV_FILE=${finalEnvFileForNextCommand} pnpm completion:final`,
  "```",
  "",
  "## Auto-bound Variables",
  "",
];
if (autoBoundMissingVariableNames.length === 0) {
  actionPlanLines.push("No currently missing variables are auto-bound by `completion:final`.", "");
} else {
  for (const variableName of autoBoundMissingVariableNames) {
    actionPlanLines.push(`- ${mdInline(variableName)}: generated or bound by ${mdInline("completion:final")}`);
  }
  actionPlanLines.push("");
}
actionPlanLines.push("## Manual Variables", "");
if (manualMissingVariableNames.length === 0) {
  actionPlanLines.push("No manual variables are currently missing.", "");
} else {
  for (const [reason, variables] of Object.entries(manualVariablesByReason)) {
    actionPlanLines.push(`### ${mdText(reason)}`, "");
    if (reason === "not_true") {
      actionPlanLines.push("Set each variable in this group to `true` only after the corresponding cutover evidence exists.", "");
    }
    if (variables.length === 0) {
      actionPlanLines.push("No variables in this group.", "");
      continue;
    }
    for (const variableName of variables) {
      const entry = variableMatrix.get(variableName) ?? { scopes: new Set(), reasons: new Set(), count: 0 };
      actionPlanLines.push(
        `- ${mdInline(variableName)}: scopes=${mdInline(Array.from(entry.scopes).sort().join(","))}; missing_count=${entry.count}`,
      );
    }
    actionPlanLines.push("");
  }
}
const missingScopes = Array.isArray(report.scopeSummary)
  ? report.scopeSummary.filter((scope) => String(scope.status ?? "") !== "ready")
  : [];
actionPlanLines.push("## Scope Order", "");
if (missingScopes.length === 0) {
  actionPlanLines.push("All scopes are currently ready.", "");
} else {
  for (const scope of missingScopes.sort((left, right) => Number(right.missing ?? 0) - Number(left.missing ?? 0))) {
    actionPlanLines.push(
      `- ${mdInline(String(scope.scope ?? "unknown"))}: status=${mdInline(String(scope.status ?? "unknown"))}; missing=${Number(scope.missing ?? 0)}; ready=${Number(scope.ready ?? 0)}`,
    );
  }
  actionPlanLines.push("");
}
fs.writeFileSync(actionPlanFile, `${actionPlanLines.join("\n")}\n`, { mode: 0o600 });
fs.chmodSync(actionPlanFile, 0o600);
console.log(`completion_gap_report_mode=${fileMode(reportFile)}`);
console.log(`completion_gap_variables_mode=${fileMode(variablesFile)}`);
console.log(`completion_gap_variable_matrix_mode=${fileMode(variableMatrixFile)}`);
console.log(`completion_gap_checklist_mode=${fileMode(checklistFile)}`);
console.log(`completion_gap_action_plan_mode=${fileMode(actionPlanFile)}`);
console.log(`completion_final_auto_bound_missing_variables_count=${autoBoundMissingVariableNames.length}`);
console.log(`completion_final_auto_bound_missing_variables=${autoBoundMissingVariableNames.join(",")}`);
console.log(`manual_missing_variables_count=${manualMissingVariableNames.length}`);
console.log(`manual_missing_variables=${manualMissingVariableNames.join(",")}`);
for (const [reason, variables] of Object.entries(manualVariablesByReason)) {
  console.log(`manual_${reason}_variables_count=${variables.length}`);
  console.log(`manual_${reason}_variables=${variables.join(",")}`);
}
console.log(`missing_variables_count=${sortedVariableNames.length}`);
console.log(`missing_variables=${sortedVariableNames.join(",")}`);
const scopes = Array.isArray(report.scopeSummary) ? report.scopeSummary : [];
for (const scope of scopes) {
  const name = String(scope.scope || "unknown");
  const status = String(scope.status || "unknown");
  const ready = Number.isFinite(Number(scope.ready)) ? Number(scope.ready) : 0;
  const missing = Number.isFinite(Number(scope.missing)) ? Number(scope.missing) : 0;
  console.log(`scope=${name};status=${status};ready=${ready};missing=${missing}`);
}

function safeStringArray(value) {
  return Array.isArray(value) ? value.map(String) : [];
}

function normalizeNextCommands(value, finalEnvFile) {
  const commands = safeStringArray(value).map((command) => {
    if (/^ACP_SECRET_ENV_FILE=\S+ pnpm external:preflight$/.test(command) || command === "pnpm external:preflight") {
      return `ACP_SECRET_ENV_FILE=${finalEnvFile} pnpm external:preflight`;
    }
    if (/^ACP_SECRET_ENV_FILE=\S+ pnpm completion:gap$/.test(command)) {
      return `ACP_SECRET_ENV_FILE=${finalEnvFile} pnpm completion:gap`;
    }
    if (/^ACP_SECRET_ENV_FILE=\S+ pnpm completion:final$/.test(command)) {
      return `ACP_SECRET_ENV_FILE=${finalEnvFile} pnpm completion:final`;
    }
    return command;
  });
  const requiredCommands = [
    finalEnvTemplateCommand,
    `ACP_SECRET_ENV_FILE=${finalEnvFile} pnpm external:preflight`,
    `ACP_SECRET_ENV_FILE=${finalEnvFile} pnpm completion:gap`,
    `ACP_SECRET_ENV_FILE=${finalEnvFile} pnpm completion:final`,
  ];
  for (const command of requiredCommands) {
    if (!commands.includes(command)) {
      commands.push(command);
    }
  }
  return commands;
}

function mdInline(value) {
  return `\`${String(value).replaceAll("`", "\\`")}\``;
}

function mdText(value) {
  return String(value).replaceAll("\n", " ").replaceAll("|", "\\|");
}

function fileMode(file) {
  return (fs.statSync(file).mode & 0o777).toString(8);
}
NODE
fi

if [[ "${ACP_COMPLETION_GAP_SHOW_MISSING:-false}" == "true" ]]; then
  grep '^missing=' "$OUTPUT_FILE" || true
fi
