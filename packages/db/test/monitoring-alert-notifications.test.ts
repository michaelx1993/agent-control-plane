import { describe, expect, it, vi } from "vitest";
import type { DatabaseClient } from "../src/client";
import {
  listDueMonitoringAlertNotifications,
  markMonitoringAlertNotificationFailed,
  markMonitoringAlertNotificationSent,
  recordMonitoringAlertNotificationFailure,
} from "../src/monitoring-alert-notifications";

describe("monitoring alert notifications", () => {
  it("records failed alert notification payloads for replay", async () => {
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    } as unknown as DatabaseClient;
    const nextAttemptAt = new Date("2026-06-19T12:05:00Z");

    await recordMonitoringAlertNotificationFailure(client, {
      fingerprint: "critical:stalled-runs",
      level: "critical",
      webhookUrl: "https://hooks.example.com/acp",
      format: "slack",
      payload: { text: "alert" },
      reason: "Webhook returned 500",
      nextAttemptAt,
    });

    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("on conflict"), [
      "critical:stalled-runs",
      "critical",
      "https://hooks.example.com/acp",
      "slack",
      '{"text":"alert"}',
      "Webhook returned 500",
      nextAttemptAt,
    ]);
  });

  it("lists due alert notifications", async () => {
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: "notification-1",
            fingerprint: "critical:stalled-runs",
            webhook_url: "https://hooks.example.com/acp",
            format: "generic",
            payload: { text: "alert" },
            attempts: 2,
          },
        ],
      }),
    } as unknown as DatabaseClient;
    const now = new Date("2026-06-19T12:00:00Z");

    await expect(listDueMonitoringAlertNotifications(client, { limit: 5, now })).resolves.toEqual([
      {
        id: "notification-1",
        fingerprint: "critical:stalled-runs",
        webhookUrl: "https://hooks.example.com/acp",
        format: "generic",
        payload: { text: "alert" },
        attempts: 2,
      },
    ]);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("next_attempt_at <= $1"), [
      now,
      5,
    ]);
  });

  it("marks replay records as sent or failed", async () => {
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    } as unknown as DatabaseClient;
    const nextAttemptAt = new Date("2026-06-19T12:10:00Z");

    await markMonitoringAlertNotificationSent(client, "notification-1");
    await markMonitoringAlertNotificationFailed(client, {
      id: "notification-2",
      reason: "network down",
      nextAttemptAt,
    });

    expect(client.query).toHaveBeenNthCalledWith(1, expect.stringContaining("status = 'sent'"), [
      "notification-1",
    ]);
    expect(client.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("attempts = attempts + 1"),
      ["notification-2", "network down", nextAttemptAt],
    );
  });
});
