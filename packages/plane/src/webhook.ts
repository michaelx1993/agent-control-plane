import { createHmac, timingSafeEqual } from "node:crypto";

export interface PlaneWebhookEnvelope {
  eventName: string;
  payload: unknown;
}

export function verifyPlaneWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader || !secret) {
    return false;
  }

  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const actual = normalizeSignature(signatureHeader);

  if (!actual || actual.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

export function parsePlaneWebhook(rawBody: string, eventName: string | null): PlaneWebhookEnvelope {
  if (!eventName?.trim()) {
    throw new Error("Missing X-Plane-Event header");
  }

  return {
    eventName,
    payload: JSON.parse(rawBody) as unknown,
  };
}

export function extractPlaneIssueId(payload: unknown): string | undefined {
  const value = findFirstString(payload, ["issue", "issue_id", "work_item", "work_item_id"]);
  return value;
}

export function extractPlaneCommentBody(payload: unknown): string | undefined {
  return findFirstString(payload, ["comment_html", "comment_stripped", "body", "comment"]);
}

function normalizeSignature(signatureHeader: string): string | undefined {
  const signature = signatureHeader.trim().replace(/^sha256=/i, "");

  return /^[a-f0-9]{64}$/i.test(signature) ? signature.toLowerCase() : undefined;
}

function findFirstString(value: unknown, keys: readonly string[]): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }

    if (candidate && typeof candidate === "object") {
      const id = (candidate as Record<string, unknown>).id;
      if (typeof id === "string" && id.trim()) {
        return id;
      }
    }
  }

  for (const candidate of Object.values(record)) {
    const found = findFirstString(candidate, keys);
    if (found) {
      return found;
    }
  }

  return undefined;
}
