#!/usr/bin/env node
import { auditTaskSources, withDatabasePool } from "../packages/db/dist/index.js";

function readBoolean(name, defaultValue) {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return defaultValue;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${name} must be true or false`);
}

function readNumber(name, defaultValue) {
  const raw = process.env[name]?.trim();
  if (!raw) return defaultValue;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be numeric`);
  }
  return parsed;
}

const result = await withDatabasePool((client) =>
  auditTaskSources(client, {
    executionProfile: process.env.TASK_SOURCE_SMOKE_EXECUTION_PROFILE,
    planeBaseUrl: process.env.TASK_SOURCE_SMOKE_PLANE_BASE_URL ?? process.env.PLANE_BASE_URL,
    projectSlug: process.env.TASK_SOURCE_SMOKE_PROJECT_SLUG,
    limit: readNumber("TASK_SOURCE_SMOKE_LIMIT", 50),
    requireSample: readBoolean("TASK_SOURCE_SMOKE_REQUIRE_SAMPLE", true),
    requirePlaneUrl: readBoolean("TASK_SOURCE_SMOKE_REQUIRE_PLANE_URL", true),
    requireRepositoryRouting: readBoolean("TASK_SOURCE_SMOKE_REQUIRE_REPOSITORY_ROUTING", true),
    requireRunEvidence: readBoolean("TASK_SOURCE_SMOKE_REQUIRE_RUN_EVIDENCE", true),
    requireRunEventEvidence: readBoolean("TASK_SOURCE_SMOKE_REQUIRE_RUN_EVENT_EVIDENCE", true),
    requireProgressEvidence: readBoolean("TASK_SOURCE_SMOKE_REQUIRE_PROGRESS_EVIDENCE", true),
    requirePromptReleaseEvidence: readBoolean(
      "TASK_SOURCE_SMOKE_REQUIRE_PROMPT_RELEASE_EVIDENCE",
      true,
    ),
    requireWorkspaceEvidence: readBoolean("TASK_SOURCE_SMOKE_REQUIRE_WORKSPACE_EVIDENCE", true),
    requireConversationEvidence: readBoolean(
      "TASK_SOURCE_SMOKE_REQUIRE_CONVERSATION_EVIDENCE",
      false,
    ),
    requireTraceEvidence: readBoolean("TASK_SOURCE_SMOKE_REQUIRE_TRACE_EVIDENCE", false),
  }),
);

console.log(`checked=${result.checked}`);
console.log(`plane_url_count=${result.planeUrlCount}`);
console.log(`linear_url_count=${result.linearUrlCount}`);
console.log(`routed_count=${result.routedCount}`);
console.log(`run_evidence_count=${result.runEvidenceCount}`);
console.log(`run_event_count=${result.runEventEvidenceCount}`);
console.log(`progress_item_count=${result.progressEvidenceCount}`);
console.log(`prompt_release_count=${result.promptReleaseEvidenceCount}`);
console.log(`workspace_count=${result.workspaceEvidenceCount}`);
console.log(`conversation_evidence_count=${result.conversationEvidenceCount}`);
console.log(`trace_evidence_count=${result.traceEvidenceCount}`);
console.log(`violations=${result.violations.length}`);

if (result.violations.length > 0) {
  console.error("task_source_smoke=failed");
  for (const violation of result.violations) {
    console.error(`violation=${violation.type};identifier=${violation.identifier}`);
  }
  process.exit(1);
}

console.log("task_source_smoke=passed");
