#!/usr/bin/env node
import fs from "node:fs";

const payloadFile = process.env.OPENHANDS_PAYLOAD_CONTRACT_FILE;

const defaultPayload = {
  conversation: {
    id: "sample-conversation",
    status: "completed",
    ui_url: "https://openhands.example.test/conversations/sample-conversation",
    events: [
      { type: "agent_message", message: "ready" },
      { type: "tool_call", tool: "shell", command: "pnpm test" },
    ],
  },
};

function fail(reason, detail) {
  console.error("openhands_payload_contract=failed");
  console.error(`reason=${reason}`);
  if (detail) console.error(`detail=${detail}`);
  process.exit(1);
}

function readPayload() {
  if (!payloadFile) return defaultPayload;
  let stat;
  try {
    stat = fs.statSync(payloadFile);
  } catch {
    fail("payload_file_missing", payloadFile);
  }
  const mode = stat.mode & 0o777;
  if (mode !== 0o600 && mode !== 0o400) {
    fail("payload_file_permissions", `${payloadFile} mode=${mode.toString(8)}`);
  }
  try {
    return JSON.parse(fs.readFileSync(payloadFile, "utf8"));
  } catch (error) {
    fail("payload_json_invalid", error instanceof Error ? error.message : String(error));
  }
}

function findConversation(payload) {
  if (payload && typeof payload === "object") {
    if (payload.conversation && typeof payload.conversation === "object")
      return payload.conversation;
    if (payload.id || payload.conversation_id || payload.conversationId) return payload;
  }
  return null;
}

function collectEvents(payload, conversation) {
  const candidates = [
    conversation?.events,
    conversation?.event_log,
    conversation?.eventLog,
    conversation?.messages,
    payload?.events,
    payload?.eventLog?.events,
    payload?.event_log?.events,
    payload?.eventLog?.items,
    payload?.event_log?.items,
  ];
  return candidates.find(Array.isArray) ?? [];
}

const payload = readPayload();
const conversation = findConversation(payload);
if (!conversation) fail("conversation_missing");

const conversationId =
  conversation.id ?? conversation.conversation_id ?? conversation.conversationId;
if (!conversationId || typeof conversationId !== "string") fail("conversation_id_missing");

const status = String(
  conversation.status ?? conversation.state ?? conversation.terminal_status ?? "",
).toLowerCase();
if (!status) fail("terminal_status_missing");
const terminalStatuses = new Set([
  "completed",
  "complete",
  "succeeded",
  "success",
  "finished",
  "failed",
  "error",
  "cancelled",
  "canceled",
  "blocked",
  "stalled",
]);
if (!terminalStatuses.has(status)) fail("terminal_status_unknown", status);

const events = collectEvents(payload, conversation);
if (events.length === 0) fail("events_missing");

const raw = JSON.stringify(payload);
if (
  /sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._-]{12,}|password\s*[:=]\s*["']?[^"',\s}]+/i.test(raw)
) {
  fail("secret_like_value_present");
}

console.log("openhands_payload_contract=passed");
console.log(`conversation_id=${conversationId}`);
console.log(`terminal_status=${status}`);
console.log(`events=${events.length}`);
