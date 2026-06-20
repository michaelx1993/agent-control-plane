import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  extractPlaneCommentBody,
  extractPlaneIssueId,
  parsePlaneWebhook,
  verifyPlaneWebhookSignature,
} from "../src/webhook";

describe("Plane webhook helpers", () => {
  it("verifies HMAC-SHA256 signatures", () => {
    const body = JSON.stringify({ event: "issue updated" });
    const signature = createHmac("sha256", "secret").update(body).digest("hex");

    expect(verifyPlaneWebhookSignature(body, signature, "secret")).toBe(true);
    expect(verifyPlaneWebhookSignature(body, `sha256=${signature}`, "secret")).toBe(true);
    expect(verifyPlaneWebhookSignature(body, signature, "wrong")).toBe(false);
  });

  it("extracts issue id and comment body from nested payloads", () => {
    const payload = {
      action: "created",
      data: {
        issue: { id: "issue-1" },
        comment_html: "<p>需要返工</p>",
      },
    };

    expect(extractPlaneIssueId(payload)).toBe("issue-1");
    expect(extractPlaneCommentBody(payload)).toBe("<p>需要返工</p>");
  });

  it("requires event headers", () => {
    expect(() => parsePlaneWebhook("{}", null)).toThrow("Missing X-Plane-Event");
  });
});
