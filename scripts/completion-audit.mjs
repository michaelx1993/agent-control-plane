#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";

const allowIncomplete = process.env.ACP_COMPLETION_AUDIT_ALLOW_INCOMPLETE === "true";
const allowLocalEvidence = process.env.ACP_COMPLETION_AUDIT_ALLOW_LOCAL_EVIDENCE === "true";
const maxReportAgeHours = Number(process.env.ACP_COMPLETION_AUDIT_MAX_REPORT_AGE_HOURS || "24");
const expectedFinalRunId = process.env.ACP_COMPLETION_FINAL_RUN_ID || "";
const expectedExternalPreflightId = process.env.ACP_EXTERNAL_PREFLIGHT_ID || "";
const expectedReportId = process.env.ACP_CUTOVER_REPORT_ID || "";
const reportFile =
  process.env.ACP_COMPLETION_AUDIT_REPORT_FILE || process.env.ACP_CUTOVER_REPORT_FILE || "";

function readReport(file) {
  if (!file) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    return {
      __readError: error instanceof Error ? error.message : String(error),
    };
  }
}

const report = readReport(reportFile);

function reportFileMode(file) {
  return fileMode(file);
}

function fileMode(file) {
  if (!file) {
    return "";
  }
  try {
    return (fs.statSync(file).mode & 0o777).toString(8);
  } catch {
    return "";
  }
}

function isOwnerOnlyFile(file) {
  return ["600", "400"].includes(fileMode(file));
}

function reportLooksLikeRehearsal() {
  if (!report || report.__readError) {
    return false;
  }
  const manualSummary = evidence("evidence.manualSummary");
  const legacyPoller = evidence("evidence.legacyPoller");
  const taskSource = evidence("evidence.taskSource");
  return [manualSummary, legacyPoller, taskSource].some((value) =>
    value.includes("cutover-rehearsal mock"),
  );
}

function evidence(path, fallback = "") {
  if (!report || report.__readError) {
    return fallback;
  }

  let cursor = report;
  for (const key of path.split(".")) {
    if (!cursor || typeof cursor !== "object" || !(key in cursor)) {
      return fallback;
    }
    cursor = cursor[key];
  }
  return typeof cursor === "string" ? cursor : cursor == null ? fallback : String(cursor);
}

function smokeFlag(path) {
  if (!report || report.__readError) {
    return false;
  }

  let cursor = report;
  for (const key of path.split(".")) {
    if (!cursor || typeof cursor !== "object" || !(key in cursor)) {
      return false;
    }
    cursor = cursor[key];
  }
  return cursor === true;
}

function reportValue(path, fallback = "") {
  if (!report || report.__readError) {
    return fallback;
  }

  let cursor = report;
  for (const key of path.split(".")) {
    if (!cursor || typeof cursor !== "object" || !(key in cursor)) {
      return fallback;
    }
    cursor = cursor[key];
  }
  return cursor == null ? fallback : cursor;
}

function isUrl(value) {
  return /^https?:\/\/\S+$/i.test(value);
}

function isConcrete(value) {
  if (!value) {
    return false;
  }
  if (["recorded", "not-run", "unknown"].includes(value)) {
    return false;
  }
  if (value.includes("not-run") || value.includes("unknown")) {
    return false;
  }
  if (hasTemplatePlaceholder(value)) {
    return false;
  }
  return true;
}

function hasTemplatePlaceholder(value) {
  return (
    value.includes("<") ||
    value.includes(">") ||
    value.includes("example.com") ||
    value.includes("owner/repo") ||
    value.includes("YYYY-MM-DD")
  );
}

function isNonMock(value) {
  if (!isConcrete(value)) {
    return false;
  }
  if (hasTemplatePlaceholder(value)) {
    return false;
  }
  if (reportLooksLikeRehearsal()) {
    return false;
  }
  if (value.includes("cutover-rehearsal mock")) {
    return false;
  }
  if (
    !allowLocalEvidence &&
    /\b(localhost\.?|0\.0\.0\.0|127(?:\.\d{1,3}){0,3})\b|\[?::1\]?/i.test(value)
  ) {
    return false;
  }
  return true;
}

function pass(name, evidenceValue, detail = "") {
  return { name, status: "passed", evidence: evidenceValue, detail };
}

function fail(name, evidenceValue, detail) {
  return { name, status: "missing", evidence: evidenceValue || "missing", detail };
}

function invalid(name, evidenceValue, detail) {
  return { name, status: "invalid", evidence: evidenceValue || "invalid", detail };
}

function checkUrl(name, value, detail) {
  if (isUrl(value) && isNonMock(value)) {
    return pass(name, value);
  }
  return fail(name, value, detail);
}

function evidenceField(value, field) {
  const parts = String(value)
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
  for (const part of parts) {
    const separator = part.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const key = part.slice(0, separator).trim();
    if (key === field) {
      return part.slice(separator + 1).trim();
    }
  }
  return "";
}

function hasPositiveNumberField(value, field) {
  const raw = evidenceField(value, field);
  return raw !== "" && Number(raw) > 0;
}

function numberField(value, field) {
  const raw = evidenceField(value, field);
  if (raw === "") {
    return Number.NaN;
  }
  return Number(raw);
}

function fieldAtLeast(value, field, minimum) {
  const current = numberField(value, field);
  return Number.isFinite(current) && current >= minimum;
}

function statusFieldIsSuccess(value, field) {
  const current = numberField(value, field);
  return Number.isInteger(current) && current >= 200 && current < 300;
}

function hasZeroNumberField(value, field) {
  const raw = evidenceField(value, field);
  return raw !== "" && Number(raw) === 0;
}

function hasIsoTimestampField(value, field) {
  const raw = evidenceField(value, field);
  if (!raw || ["unknown", "not-run", "recorded"].includes(raw)) {
    return false;
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) && /^\d{4}-\d{2}-\d{2}T/.test(raw);
}

function hasFreshIsoTimestampField(value, field, maxAgeHours) {
  const raw = evidenceField(value, field);
  return hasIsoTimestampField(value, field) && isFreshIsoTimestamp(raw, maxAgeHours);
}

function isFreshIsoTimestamp(value, maxAgeHours) {
  if (!value || typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return false;
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return false;
  }
  const now = Date.now();
  const maxFutureSkewMs = 5 * 60 * 1000;
  if (parsed > now + maxFutureSkewMs) {
    return false;
  }
  const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
  return now - parsed <= maxAgeMs;
}

function hasDateEvidence(value) {
  return /\b\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)?\b/.test(value);
}

function hasFreshDateEvidence(value, maxAgeHours) {
  const match = value.match(/\b\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)?\b/);
  if (!match) {
    return false;
  }
  const raw = match[0].includes("T") ? match[0] : `${match[0]}T00:00:00.000Z`;
  return isFreshIsoTimestamp(raw, maxAgeHours);
}

function containsAny(value, words) {
  const normalized = value.toLowerCase();
  return words.some((word) => normalized.includes(word));
}

function checkOpenHandsPayloadContract(payloadFile) {
  if (!isConcrete(payloadFile) || !isOwnerOnlyFile(payloadFile)) {
    return fail(
      "OpenHands payload contract",
      payloadFile,
      "requires existing owner-only payload_file before contract validation",
    );
  }

  const result = spawnSync("pnpm", ["--silent", "openhands:payload-contract"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      OPENHANDS_PAYLOAD_CONTRACT_FILE: payloadFile,
    },
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 60_000,
  });

  if (result.status === 0) {
    return pass("OpenHands payload contract", payloadFile, "openhands:payload-contract=passed");
  }

  return invalid(
    "OpenHands payload contract",
    payloadFile,
    result.error
      ? "pnpm openhands:payload-contract could not run"
      : "payload_file failed pnpm openhands:payload-contract",
  );
}

const checks = [];

if (!reportFile) {
  checks.push(
    fail("cutover report", "", "set ACP_COMPLETION_AUDIT_REPORT_FILE or ACP_CUTOVER_REPORT_FILE"),
  );
} else if (!report) {
  checks.push(fail("cutover report", reportFile, "report could not be read"));
} else if (report.__readError) {
  checks.push(fail("cutover report", reportFile, report.__readError));
} else if (report.readiness === "passed") {
  checks.push(pass("cutover report", reportFile, "readiness=passed"));
} else {
  checks.push(fail("cutover report", reportFile, `readiness=${report.readiness ?? "missing"}`));
}

const reportMode = reportFileMode(reportFile);
checks.push(
  ["600", "400"].includes(reportMode)
    ? pass("cutover report permissions", reportMode, "mode must be 600 or 400")
    : fail(
        "cutover report permissions",
        reportMode || "missing",
        "cutover report file must be readable only by the owner",
      ),
);

const generatedAt = reportValue("generatedAt", "");
checks.push(
  isFreshIsoTimestamp(String(generatedAt), maxReportAgeHours)
    ? pass("cutover report freshness", String(generatedAt), `maxAgeHours=${maxReportAgeHours}`)
    : fail(
        "cutover report freshness",
        String(generatedAt || "missing"),
        `report generatedAt must be ISO timestamp within ${maxReportAgeHours}h`,
      ),
);

const reportId = String(reportValue("reportId", ""));
checks.push(
  isConcrete(reportId) && (!expectedReportId || reportId === expectedReportId)
    ? pass("cutover report id", reportId)
    : fail(
        "cutover report id",
        reportId || "missing",
        expectedReportId ? "reportId must match ACP_CUTOVER_REPORT_ID" : "reportId must be present",
      ),
);

const reportFinalRunId = String(reportValue("completionFinalRunId", ""));
checks.push(
  isConcrete(reportFinalRunId) && (!expectedFinalRunId || reportFinalRunId === expectedFinalRunId)
    ? pass("completion final run id", reportFinalRunId)
    : fail(
        "completion final run id",
        reportFinalRunId || "missing",
        expectedFinalRunId
          ? "report completionFinalRunId must match this completion:final invocation"
          : "report completionFinalRunId must be present",
      ),
);

const reportErrors = reportValue("errors", []);
checks.push(
  Array.isArray(reportErrors) && reportErrors.length === 0
    ? pass("cutover report errors", "none")
    : fail(
        "cutover report errors",
        Array.isArray(reportErrors) ? reportErrors.join(";") : String(reportErrors || "missing"),
        "report must have no cutover errors",
      ),
);

const reportWarnings = reportValue("warnings", []);
const reportWorkerExecutionAdapter = String(reportValue("config.workerExecutionAdapter", ""));
const codexExecutionAdapters = new Set(["codex-cli", "codex-app-server"]);
const isCodexExecutionAdapter = (adapter) => codexExecutionAdapters.has(String(adapter));
const inferredExecutionProfile = isCodexExecutionAdapter(reportWorkerExecutionAdapter)
  ? "codex-cli"
  : "openhands-cloud";
const completionExecutionProfile = String(
  process.env.ACP_COMPLETION_EXECUTION_PROFILE ||
    reportValue("config.completionExecutionProfile", inferredExecutionProfile),
);
const isCodexProfile = completionExecutionProfile === "codex-cli";
const isKnownExecutionProfile = [
  "codex-cli",
  "openhands-cloud",
  "openhands-langfuse",
  "external",
].includes(completionExecutionProfile);
const allowedCodexWarnings = [
  "WORKER_EXECUTION_ADAPTER is not openhands-cloud; cutover will not use real OpenHands",
  "LANGFUSE_ENABLED is not true; cutover will not emit real Langfuse traces",
];
const blockingWarnings =
  isCodexProfile && Array.isArray(reportWarnings)
    ? reportWarnings.filter((warning) => !allowedCodexWarnings.includes(String(warning)))
    : reportWarnings;
checks.push(
  Array.isArray(blockingWarnings) && blockingWarnings.length === 0
    ? pass("cutover report warnings", "none")
    : fail(
        "cutover report warnings",
        Array.isArray(blockingWarnings)
          ? blockingWarnings.join(";")
          : String(blockingWarnings || "missing"),
        "report must have no cutover warnings for completion claim",
      ),
);

checks.push(
  isKnownExecutionProfile
    ? pass("completion execution profile", completionExecutionProfile)
    : fail(
        "completion execution profile",
        completionExecutionProfile || "missing",
        "profile must be codex-cli, openhands-cloud, openhands-langfuse, or external",
      ),
);

const requiredSmokeFlags = [
  ["Plane writeback smoke flag", "smoke.planeWriteback"],
  ["task-source smoke flag", "smoke.taskSource"],
  ["worker crash recovery smoke flag", "smoke.workerCrashRecovery"],
  ["worker budget smoke flag", "smoke.workerBudget"],
  ["worker workflow smoke flag", "smoke.workerWorkflow"],
  ["secret provider smoke flag", "smoke.secretProvider"],
  ["secret provider audit smoke flag", "smoke.secretProviderAudit"],
  ["external preflight smoke flag", "smoke.externalPreflight"],
];

if (isCodexProfile) {
  requiredSmokeFlags.push(["Codex adapter smoke flag", "smoke.codexAdapter"]);
} else {
  requiredSmokeFlags.push(
    ["production smoke flag", "smoke.production"],
    ["OpenHands conversation smoke flag", "smoke.openhandsConversation"],
    ["OpenHands adapter smoke flag", "smoke.openhandsAdapter"],
    ["OpenHands DB run smoke flag", "smoke.openhandsDbRun"],
    ["Langfuse trace smoke flag", "smoke.langfuseTrace"],
  );
}

for (const [name, path] of requiredSmokeFlags) {
  checks.push(
    smokeFlag(path)
      ? pass(name, "true")
      : fail(
          name,
          String(reportValue(path, "missing")),
          "required cutover smoke flag must be true",
        ),
  );
}

const requiredGateFlags = [
  ["Plane writeback enabled gate", "gates.planeWritebackEnabled"],
  ["legacy poller readonly gate", "gates.legacyPollerReadonly"],
  ["Linear archive confirmed gate", "gates.linearArchiveConfirmed"],
];

for (const [name, path] of requiredGateFlags) {
  checks.push(
    reportValue(path, false) === true
      ? pass(name, "true")
      : fail(name, String(reportValue(path, "missing")), "required cutover gate must be true"),
  );
}

const workerExecutionAdapter = String(reportValue("config.workerExecutionAdapter", ""));
checks.push(
  (
    isCodexProfile
      ? isCodexExecutionAdapter(workerExecutionAdapter)
      : workerExecutionAdapter === "openhands-cloud"
  )
    ? pass("worker execution adapter", workerExecutionAdapter)
    : fail(
        "worker execution adapter",
        workerExecutionAdapter || "missing",
        isCodexProfile
          ? "completion requires WORKER_EXECUTION_ADAPTER=codex-cli or codex-app-server"
          : "completion requires WORKER_EXECUTION_ADAPTER=openhands-cloud",
      ),
);

if (!isCodexProfile) {
  checks.push(
    reportValue("config.langfuseEnabled", false) === true
      ? pass("Langfuse enabled", "true")
      : fail(
          "Langfuse enabled",
          String(reportValue("config.langfuseEnabled", "missing")),
          "completion requires LANGFUSE_ENABLED=true",
        ),
  );
}

checks.push(
  reportValue("config.cutoverSkipSecretValidate", true) === false
    ? pass("secret validation not skipped", "true")
    : fail(
        "secret validation not skipped",
        String(reportValue("config.cutoverSkipSecretValidate", "missing")),
        "completion must not use ACP_CUTOVER_SKIP_SECRET_VALIDATE=true",
      ),
);

checks.push(
  isCodexProfile || reportValue("config.smokeExternal", false) === true
    ? pass("external production probes", "true")
    : fail(
        "external production probes",
        String(reportValue("config.smokeExternal", "missing")),
        "completion requires ACP_SMOKE_EXTERNAL=true in production smoke",
      ),
);

if (isCodexProfile) {
  const codexAdapter = evidence("evidence.codexAdapter");
  const codexProvider = evidenceField(codexAdapter, "provider");
  checks.push(
    isConcrete(codexAdapter) &&
      isCodexExecutionAdapter(codexProvider) &&
      isConcrete(evidenceField(codexAdapter, "next_state")) &&
      hasPositiveNumberField(codexAdapter, "events")
      ? pass("Codex adapter smoke", codexAdapter)
      : fail(
          "Codex adapter smoke",
          codexAdapter,
          "requires provider=codex-cli or codex-app-server, next_state and positive events evidence",
        ),
  );
} else {
  const openhandsConversation = evidence("evidence.openhandsConversation");
  checks.push(
    isNonMock(openhandsConversation) &&
      isUrl(evidenceField(openhandsConversation, "ui_url")) &&
      isNonMock(evidenceField(openhandsConversation, "ui_url")) &&
      isConcrete(evidenceField(openhandsConversation, "conversation_id"))
      ? pass("real OpenHands conversation", openhandsConversation)
      : fail(
          "real OpenHands conversation",
          openhandsConversation,
          "requires ui_url and conversation_id evidence from real OpenHands conversation smoke",
        ),
  );

  const openhandsPayloadFile = evidenceField(openhandsConversation, "payload_file");
  checks.push(
    isNonMock(openhandsConversation) &&
      isConcrete(openhandsPayloadFile) &&
      isOwnerOnlyFile(openhandsPayloadFile)
      ? pass("OpenHands payload capture", openhandsPayloadFile)
      : fail(
          "OpenHands payload capture",
          openhandsConversation,
          "requires existing owner-only payload_file evidence from OPENHANDS_SMOKE_PAYLOAD_FILE",
        ),
  );
  checks.push(checkOpenHandsPayloadContract(openhandsPayloadFile));

  const openhandsAdapter = evidence("evidence.openhandsAdapter");
  checks.push(
    isNonMock(openhandsAdapter) &&
      isUrl(evidenceField(openhandsAdapter, "ui_url")) &&
      isNonMock(evidenceField(openhandsAdapter, "ui_url")) &&
      isConcrete(evidenceField(openhandsAdapter, "conversation_id")) &&
      isConcrete(evidenceField(openhandsAdapter, "next_state"))
      ? pass("OpenHands adapter smoke", openhandsAdapter)
      : fail(
          "OpenHands adapter smoke",
          openhandsAdapter,
          "requires ui_url, conversation_id and next_state evidence",
        ),
  );

  const openhandsDbRun = evidence("evidence.openhandsDbRun");
  checks.push(
    isNonMock(openhandsDbRun) &&
      isConcrete(evidenceField(openhandsDbRun, "run_id")) &&
      isConcrete(evidenceField(openhandsDbRun, "conversation_id")) &&
      isUrl(evidenceField(openhandsDbRun, "ui_url")) &&
      isNonMock(evidenceField(openhandsDbRun, "ui_url")) &&
      isUrl(evidenceField(openhandsDbRun, "trace_ui_url")) &&
      isNonMock(evidenceField(openhandsDbRun, "trace_ui_url")) &&
      isConcrete(evidenceField(openhandsDbRun, "prompt_release_id")) &&
      hasPositiveNumberField(openhandsDbRun, "trace_refs") &&
      isConcrete(evidenceField(openhandsDbRun, "next_state")) &&
      hasPositiveNumberField(openhandsDbRun, "events")
      ? pass("OpenHands DB run smoke", openhandsDbRun)
      : fail(
          "OpenHands DB run smoke",
          openhandsDbRun,
          "requires run_id, conversation_id, ui_url, trace_ui_url, prompt_release_id, positive trace_refs, next_state and positive events evidence",
        ),
  );

  const langfuseTrace = evidence("evidence.langfuseTrace");
  checks.push(
    isNonMock(langfuseTrace) &&
      isConcrete(evidenceField(langfuseTrace, "trace_id")) &&
      isUrl(evidenceField(langfuseTrace, "ui_url")) &&
      isNonMock(evidenceField(langfuseTrace, "ui_url"))
      ? pass("real Langfuse trace", langfuseTrace)
      : fail(
          "real Langfuse trace",
          langfuseTrace,
          "requires trace_id and non-mock http(s) Langfuse ui_url evidence",
        ),
  );
}

const planeWriteback = evidence("evidence.planeWriteback");
checks.push(
  isNonMock(planeWriteback) &&
    isConcrete(evidenceField(planeWriteback, "work_item_id")) &&
    isConcrete(evidenceField(planeWriteback, "state")) &&
    evidenceField(planeWriteback, "comment") === "created" &&
    evidenceField(planeWriteback, "verified") === "true" &&
    !planeWriteback.includes("verified=false")
    ? pass("Plane writeback", planeWriteback)
    : fail(
        "Plane writeback",
        planeWriteback,
        "requires work_item_id, state, comment=created and verified=true writeback evidence",
      ),
);

if (!isCodexProfile || smokeFlag("smoke.production")) {
  const productionSmoke = evidence("evidence.productionSmoke");
  checks.push(
    isNonMock(productionSmoke) &&
      isUrl(evidenceField(productionSmoke, "plane")) &&
      statusFieldIsSuccess(productionSmoke, "plane_status") &&
      (isCodexProfile ||
        (isUrl(evidenceField(productionSmoke, "openhands")) &&
          statusFieldIsSuccess(productionSmoke, "openhands_status") &&
          isUrl(evidenceField(productionSmoke, "langfuse")) &&
          statusFieldIsSuccess(productionSmoke, "langfuse_status")))
      ? pass("production smoke", productionSmoke)
      : fail(
          "production smoke",
          productionSmoke,
          isCodexProfile
            ? "requires plane external probe URL with 2xx status evidence"
            : "requires plane, openhands and langfuse external probe URLs with 2xx status evidence",
        ),
  );
}

const taskSource = evidence("evidence.taskSource");
const taskSourceChecked = numberField(taskSource, "checked");
const requiredTaskSourceFields = isCodexProfile
  ? [
      "plane_urls",
      "routed",
      "runs",
      "run_events",
      "progress_items",
      "prompt_releases",
      "workspaces",
    ]
  : ["plane_urls", "routed", "runs", "conversations", "traces"];
checks.push(
  isNonMock(taskSource) &&
    Number.isFinite(taskSourceChecked) &&
    taskSourceChecked > 0 &&
    hasZeroNumberField(taskSource, "linear_urls") &&
    requiredTaskSourceFields.every((field) => fieldAtLeast(taskSource, field, taskSourceChecked))
    ? pass("task source cutover", taskSource)
    : fail(
        "task source cutover",
        taskSource,
        isCodexProfile
          ? "requires checked>0, linear_urls=0, and plane_urls/routed/runs/run_events/progress_items/prompt_releases/workspaces covering every checked task"
          : "requires checked>0, linear_urls=0, and plane_urls/routed/runs/conversations/traces covering every checked task",
      ),
);

const providerAudit = evidence("evidence.secretProviderAudit");
const providerSmoke = evidence("evidence.secretProvider");
checks.push(
  isNonMock(providerSmoke) &&
    hasPositiveNumberField(providerSmoke, "variables") &&
    evidenceField(providerSmoke, "validation") === "passed"
    ? pass("secret provider smoke", providerSmoke)
    : fail(
        "secret provider smoke",
        providerSmoke,
        "requires real provider smoke evidence with variables>0 and validation=passed",
      ),
);

checks.push(
  isNonMock(providerAudit) &&
    isConcrete(evidenceField(providerAudit, "source")) &&
    hasPositiveNumberField(providerAudit, "events") &&
    hasPositiveNumberField(providerAudit, "matched_events") &&
    hasFreshIsoTimestampField(providerAudit, "newest_event_at", maxReportAgeHours)
    ? pass("secret provider audit", providerAudit)
    : fail(
        "secret provider audit",
        providerAudit,
        `requires real provider audit evidence with source, positive events, matched events and newest_event_at within ${maxReportAgeHours}h`,
      ),
);

const externalPreflight = evidence("evidence.externalPreflight");
const externalPreflightId = evidenceField(externalPreflight, "preflight_id");
const expectedExternalPreflightReadyCount = isCodexProfile
  ? smokeFlag("smoke.production")
    ? "7"
    : "6"
  : "9";
checks.push(
  isConcrete(externalPreflight) &&
    isConcrete(externalPreflightId) &&
    (!expectedExternalPreflightId || externalPreflightId === expectedExternalPreflightId) &&
    evidenceField(externalPreflight, "ready_count") === expectedExternalPreflightReadyCount &&
    evidenceField(externalPreflight, "missing_count") === "0"
    ? pass("external preflight", externalPreflight)
    : fail(
        "external preflight",
        externalPreflight,
        expectedExternalPreflightId
          ? `requires preflight_id matching this completion:final invocation, ready_count=${expectedExternalPreflightReadyCount} and missing_count=0 evidence`
          : `requires preflight_id, ready_count=${expectedExternalPreflightReadyCount} and missing_count=0 evidence`,
      ),
);

const legacyPoller = evidence("evidence.legacyPoller");
checks.push(
  isNonMock(legacyPoller) &&
    hasFreshDateEvidence(legacyPoller, maxReportAgeHours) &&
    containsAny(legacyPoller, ["disabled", "stopped", "readonly", "read-only", "frozen"])
    ? pass("legacy poller frozen", legacyPoller)
    : fail(
        "legacy poller frozen",
        legacyPoller,
        `requires non-mock old poller disabled/stopped/readonly evidence with date within ${maxReportAgeHours}h`,
      ),
);

const linearArchive = evidence("evidence.linearArchive");
checks.push(
  isNonMock(linearArchive) &&
    hasFreshDateEvidence(linearArchive, maxReportAgeHours) &&
    containsAny(linearArchive, ["archived", "archive", "readonly", "read-only"])
    ? pass("Linear archive-only", linearArchive)
    : fail(
        "Linear archive-only",
        linearArchive,
        `requires non-mock Linear archived/read-only evidence with date within ${maxReportAgeHours}h`,
      ),
);

const workerCrashRecovery = evidence("evidence.workerCrashRecovery");
checks.push(
  smokeFlag("smoke.workerCrashRecovery") &&
    isConcrete(workerCrashRecovery) &&
    isConcrete(evidenceField(workerCrashRecovery, "stale_run_id")) &&
    isConcrete(evidenceField(workerCrashRecovery, "recovered_run_id")) &&
    evidenceField(workerCrashRecovery, "recovered_attempt") === "2" &&
    isConcrete(evidenceField(workerCrashRecovery, "next_state"))
    ? pass("worker crash recovery", workerCrashRecovery)
    : fail(
        "worker crash recovery",
        workerCrashRecovery,
        "requires stale_run_id, recovered_run_id, recovered_attempt=2 and next_state evidence",
      ),
);

const workerBudget = evidence("evidence.workerBudget");
checks.push(
  smokeFlag("smoke.workerBudget") &&
    isConcrete(workerBudget) &&
    isConcrete(evidenceField(workerBudget, "task_id")) &&
    hasPositiveNumberField(workerBudget, "estimated_cost_usd") &&
    hasPositiveNumberField(workerBudget, "max_estimated_cost_usd_per_run") &&
    ["1", "true"].includes(evidenceField(workerBudget, "budget_blocked")) &&
    evidenceField(workerBudget, "final_state") === "Blocked"
    ? pass("worker budget gate", workerBudget)
    : fail(
        "worker budget gate",
        workerBudget,
        "requires task_id, positive cost thresholds, budget_blocked and final_state=Blocked evidence",
      ),
);

const workerWorkflow = evidence("evidence.workerWorkflow");
checks.push(
  smokeFlag("smoke.workerWorkflow") &&
    isConcrete(workerWorkflow) &&
    isConcrete(evidenceField(workerWorkflow, "task_id")) &&
    hasPositiveNumberField(workerWorkflow, "runs") &&
    evidenceField(workerWorkflow, "final_state") === "Done"
    ? pass("worker workflow", workerWorkflow)
    : fail(
        "worker workflow",
        workerWorkflow,
        "requires task_id, positive runs and final_state=Done evidence",
      ),
);

const failed = checks.filter((check) => check.status !== "passed");

for (const check of checks) {
  const prefix =
    check.status === "passed"
      ? "completion_audit_pass"
      : check.status === "invalid"
        ? "completion_audit_invalid"
        : "completion_audit_missing";
  console.log(`${prefix}=${check.name}`);
  console.log(`evidence=${check.evidence}`);
  if (check.detail) {
    console.log(`detail=${check.detail}`);
  }
}

console.log(`completion_audit_total=${checks.length}`);
console.log(`completion_audit_missing_count=${failed.length}`);
console.log(`completion_audit_status=${failed.length === 0 ? "passed" : "incomplete"}`);

if (failed.length > 0 && !allowIncomplete) {
  process.exit(1);
}
