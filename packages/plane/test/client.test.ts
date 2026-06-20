import { afterEach, describe, expect, it, vi } from "vitest";
import { PlaneApiError, PlaneClient } from "../src/client";

const fixedNowMs = Date.parse("2026-06-19T12:00:00.000Z");

afterEach(() => {
  vi.useRealTimers();
});

describe("PlaneClient", () => {
  it("passes updated_after when listing work items with server delta", async () => {
    let requestedUrl = "";
    const client = new PlaneClient({
      baseUrl: "https://plane.test/",
      apiKey: "token",
      fetchFn: async (url) => {
        requestedUrl = String(url);
        return Response.json({ results: [] });
      },
    });

    await client.listWorkItems("workspace", "project-id", {
      updatedAfter: "2026-06-19T12:05:00.000Z",
    });

    expect(requestedUrl).toBe(
      "https://plane.test/api/v1/workspaces/workspace/projects/project-id/issues/?updated_after=2026-06-19T12%3A05%3A00.000Z",
    );
  });

  it("exposes structured metadata on Plane API errors", async () => {
    const client = new PlaneClient({
      baseUrl: "https://plane.test/",
      apiKey: "token",
      fetchFn: async () =>
        new Response("rate limited", {
          status: 429,
          statusText: "Too Many Requests",
          headers: {
            "Retry-After": "2",
          },
        }),
    });

    await expect(client.listProjectLabels("workspace", "project-id")).rejects.toMatchObject({
      name: "PlaneApiError",
      status: 429,
      statusText: "Too Many Requests",
      body: "rate limited",
      retryAfterMs: 2000,
    } satisfies Partial<PlaneApiError>);
  });

  it("derives retry delay from Retry-After HTTP dates", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(fixedNowMs);

    const client = new PlaneClient({
      baseUrl: "https://plane.test/",
      apiKey: "token",
      fetchFn: async () =>
        new Response("rate limited", {
          status: 429,
          statusText: "Too Many Requests",
          headers: {
            "Retry-After": new Date(fixedNowMs + 3000).toUTCString(),
          },
        }),
    });

    await expect(client.listProjectLabels("workspace", "project-id")).rejects.toMatchObject({
      name: "PlaneApiError",
      status: 429,
      retryAfterMs: 3000,
    } satisfies Partial<PlaneApiError>);
  });

  it("derives retry delay from X-RateLimit-Reset epoch seconds, epoch milliseconds, and ISO date", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(fixedNowMs);

    const resetCases = [
      String((fixedNowMs + 5000) / 1000),
      String(fixedNowMs + 5000),
      new Date(fixedNowMs + 5000).toISOString(),
    ];

    for (const reset of resetCases) {
      const client = new PlaneClient({
        baseUrl: "https://plane.test/",
        apiKey: "token",
        fetchFn: async () =>
          new Response("rate limited", {
            status: 429,
            statusText: "Too Many Requests",
            headers: {
              "X-RateLimit-Reset": reset,
            },
          }),
      });

      await expect(client.listProjectLabels("workspace", "project-id")).rejects.toMatchObject({
        name: "PlaneApiError",
        status: 429,
        retryAfterMs: 5000,
      } satisfies Partial<PlaneApiError>);
    }
  });
});
