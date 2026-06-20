import { describe, expect, it, vi } from "vitest";
import {
  getMonitoringThresholds,
  loadMonitoringThresholdsFromEnv,
  updateMonitoringThresholds,
} from "../src/monitoring-settings";
import type { DatabaseClient } from "../src/client";

describe("monitoring settings", () => {
  it("loads defaults from environment variables", () => {
    expect(
      loadMonitoringThresholdsFromEnv({
        MONITORING_QUEUE_BACKLOG_WARNING: "7",
        MONITORING_STALLED_RUNS_CRITICAL: "2",
        MONITORING_RETRY_BACKLOG_WARNING: "3",
        MONITORING_FAILURE_RATE_CRITICAL: "0.25",
        MONITORING_FAILURE_RATE_MIN_FINISHED: "8",
        MONITORING_COST_WARNING_USD: "12.5",
        MONITORING_RETRY_BACKOFF_MS: "45000",
      }),
    ).toEqual({
      queueBacklogWarning: 7,
      stalledRunsCritical: 2,
      retryBacklogWarning: 3,
      failureRateCritical: 0.25,
      failureRateMinFinished: 8,
      costWarningUsd: 12.5,
      retryBackoffMs: 45000,
    });
  });

  it("overrides environment defaults from app_settings", async () => {
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [
          { key: "monitoring.queue_backlog_warning", value: 9 },
          { key: "monitoring.failure_rate_critical", value: "0.4" },
        ],
      }),
    } as unknown as DatabaseClient;

    await expect(
      getMonitoringThresholds(client, {
        MONITORING_QUEUE_BACKLOG_WARNING: "7",
        MONITORING_FAILURE_RATE_CRITICAL: "0.2",
      }),
    ).resolves.toMatchObject({
      queueBacklogWarning: 9,
      failureRateCritical: 0.4,
    });
  });

  it("falls back to environment defaults when app_settings is missing", async () => {
    const client = {
      query: vi.fn().mockRejectedValue({ code: "42P01" }),
    } as unknown as DatabaseClient;

    await expect(
      getMonitoringThresholds(client, { MONITORING_QUEUE_BACKLOG_WARNING: "7" }),
    ).resolves.toMatchObject({
      queueBacklogWarning: 7,
    });
  });

  it("persists thresholds and writes an audit event", async () => {
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    } as unknown as DatabaseClient;

    await expect(
      updateMonitoringThresholds(client, {
        queueBacklogWarning: 10,
        stalledRunsCritical: 1,
        retryBacklogWarning: 2,
        failureRateCritical: 0.3,
        failureRateMinFinished: 5,
        costWarningUsd: 25,
        retryBackoffMs: 60000,
        actorName: "operator",
      }),
    ).resolves.toEqual({
      queueBacklogWarning: 10,
      stalledRunsCritical: 1,
      retryBacklogWarning: 2,
      failureRateCritical: 0.3,
      failureRateMinFinished: 5,
      costWarningUsd: 25,
      retryBackoffMs: 60000,
    });

    expect(client.query).toHaveBeenCalledTimes(8);
    expect(client.query).toHaveBeenLastCalledWith(expect.stringContaining("audit_events"), [
      expect.stringContaining('"queueBacklogWarning":10'),
      "operator",
    ]);
  });
});
