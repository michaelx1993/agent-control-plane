import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(new URL("../app/runs/[runId]/page.tsx", import.meta.url), "utf8");

describe("run detail conversation labels", () => {
  it("renders Plane runtime snapshot prompt preview and secret key metadata", () => {
    expect(pageSource).toContain("<h2>Runtime Snapshot</h2>");
    expect(pageSource).toContain("<h3>Prompt stack</h3>");
    expect(pageSource).toContain("<h3>Secret keys</h3>");
    expect(pageSource).toContain("<h3>Assembled prompt preview</h3>");
    expect(pageSource).toContain("run.planeRuntimeSnapshot.payload.availableSecretKeys");
    expect(pageSource).toContain(
      "formatPromptPreview(run.planeRuntimeSnapshot.payload.assembledPrompt)",
    );
  });

  it("uses provider-aware labels for conversation and event log refs", () => {
    expect(pageSource).toContain("<h2>Conversation</h2>");
    expect(pageSource).toContain("formatConversationLinkLabel(run.conversation.provider)");
    expect(pageSource).toContain("formatEventLogLinkLabel(run.conversation.provider)");
  });

  it("keeps Codex-first runs from rendering hard-coded OpenHands conversation text", () => {
    expect(pageSource).not.toContain("<h2>OpenHands</h2>");
    expect(pageSource).not.toContain("打开 OpenHands conversation</strong>");
    expect(pageSource).toContain('normalized.startsWith("codex")');
    expect(pageSource).toContain('return "Codex";');
  });

  it("keeps OpenHands labels scoped to OpenHands providers and unknown providers neutral", () => {
    expect(pageSource).toContain('normalized.includes("openhands")');
    expect(pageSource).toContain('return "OpenHands";');
    expect(pageSource).toContain('return "run";');
  });

  it("keeps trace refs provider-aware instead of hard-coding Langfuse UI", () => {
    expect(pageSource).toContain("<h2>Trace Refs</h2>");
    expect(pageSource).not.toContain("<h2>Langfuse Traces</h2>");
    expect(pageSource).toContain("formatTraceLinkLabel(trace.provider)");
    expect(pageSource).toContain('normalized.startsWith("codex")');
    expect(pageSource).toContain('normalized.includes("langfuse")');
    expect(pageSource).toContain('return "external";');
  });
});
