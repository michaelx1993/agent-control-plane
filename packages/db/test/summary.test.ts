import { describe, expect, it, vi } from "vitest";
import { fetchControlPlaneSummary } from "../src/summary";
import type { DatabaseClient } from "../src/client";

describe("fetchControlPlaneSummary", () => {
  it("maps monitoring metrics for queue, success rate, token, and cost", async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [
            {
              teams: "1",
              projects: "2",
              repositories: "3",
              tasks: "10",
              activeTasks: "8",
              agentQueueLength: "4",
              humanGateTasks: "2",
              blockedTasks: "1",
              activeRuns: "3",
              stalledRuns: "1",
              retryBacklog: "2",
              failedRuns24h: "1",
              succeededRuns24h: "3",
              finishedRuns24h: "4",
              tokenTotal: "12345",
              costUsd: "1.234500",
              promptComponents: "5",
              promptBindings: "6",
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              hour: "2026-06-19 01:00:00-07",
              succeeded_runs: "2",
              failed_runs: "1",
              stalled_runs: "0",
              token_total: "1200",
              cost_usd: "0.420000",
            },
          ],
        }),
    } as unknown as DatabaseClient;

    await expect(fetchControlPlaneSummary(client)).resolves.toEqual({
      teams: 1,
      projects: 2,
      repositories: 3,
      tasks: 10,
      activeTasks: 8,
      agentQueueLength: 4,
      humanGateTasks: 2,
      blockedTasks: 1,
      activeRuns: 3,
      stalledRuns: 1,
      retryBacklog: 2,
      failedRuns24h: 1,
      succeededRuns24h: 3,
      finishedRuns24h: 4,
      runSuccessRate24h: 0.75,
      tokenTotal: 12345,
      costUsd: 1.2345,
      monitoringThresholds: {
        queueBacklogWarning: 20,
        stalledRunsCritical: 0,
        retryBacklogWarning: 0,
        failureRateCritical: 0.5,
        failureRateMinFinished: 3,
        costWarningUsd: 50,
        retryBackoffMs: 300000,
      },
      alertLevel: "critical",
      alerts: [
        {
          key: "stalled-runs",
          level: "critical",
          title: "Run 已停滞",
          detail: "1 个 run 已停滞，超过阈值 0，需要 operator 检查。",
        },
        {
          key: "retry-backlog",
          level: "warning",
          title: "Retry Backlog 堆积",
          detail: "2 个 retryable run 仍在 backoff 窗口内，超过阈值 0。",
        },
        {
          key: "blocked-tasks",
          level: "warning",
          title: "任务被阻塞",
          detail: "1 个任务处于 Blocked。",
        },
      ],
      runTrendWindow: "24h",
      runTrend: [
        {
          hour: "2026-06-19 01:00:00-07",
          succeededRuns: 2,
          failedRuns: 1,
          stalledRuns: 0,
          tokenTotal: 1200,
          costUsd: 0.42,
        },
      ],
      runTrend24h: [
        {
          hour: "2026-06-19 01:00:00-07",
          succeededRuns: 2,
          failedRuns: 1,
          stalledRuns: 0,
          tokenTotal: 1200,
          costUsd: 0.42,
        },
      ],
      promptComponents: 5,
      promptBindings: 6,
    });

    expect(client.query).toHaveBeenCalledTimes(3);
    expect(client.query).toHaveBeenNthCalledWith(2, expect.any(String), [300000]);
    expect(client.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("state::text not in ('Done', 'Canceled', 'Duplicate')"),
      [300000],
    );
    expect(client.query).toHaveBeenNthCalledWith(3, expect.stringContaining("interval '23 hours'"));
  });

  it("can fetch a seven day monitoring trend", async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [
            {
              teams: "1",
              projects: "1",
              repositories: "1",
              tasks: "1",
              activeTasks: "1",
              agentQueueLength: "0",
              humanGateTasks: "0",
              blockedTasks: "0",
              activeRuns: "0",
              stalledRuns: "0",
              retryBacklog: "0",
              failedRuns24h: "0",
              succeededRuns24h: "0",
              finishedRuns24h: "0",
              tokenTotal: "0",
              costUsd: "0",
              promptComponents: "0",
              promptBindings: "0",
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              hour: "2026-06-19 00:00:00-07",
              succeeded_runs: "1",
              failed_runs: "0",
              stalled_runs: "0",
              token_total: "50",
              cost_usd: "0.010000",
            },
          ],
        }),
    } as unknown as DatabaseClient;

    const summary = await fetchControlPlaneSummary(client, { trendWindow: "7d" });

    expect(summary.runTrendWindow).toBe("7d");
    expect(summary.runTrend24h).toEqual([]);
    expect(summary.runTrend).toEqual([
      {
        hour: "2026-06-19 00:00:00-07",
        succeededRuns: 1,
        failedRuns: 0,
        stalledRuns: 0,
        tokenTotal: 50,
        costUsd: 0.01,
      },
    ]);
    expect(client.query).toHaveBeenNthCalledWith(3, expect.stringContaining("interval '6 days'"));
    expect(client.query).toHaveBeenNthCalledWith(3, expect.stringContaining("interval '1 day'"));
  });

  it("uses monitoring threshold environment overrides", async () => {
    const previousEnv = { ...process.env };
    process.env.MONITORING_QUEUE_BACKLOG_WARNING = "3";
    process.env.MONITORING_STALLED_RUNS_CRITICAL = "2";
    process.env.MONITORING_RETRY_BACKLOG_WARNING = "3";
    process.env.MONITORING_FAILURE_RATE_CRITICAL = "0.2";
    process.env.MONITORING_FAILURE_RATE_MIN_FINISHED = "5";
    process.env.MONITORING_COST_WARNING_USD = "1";
    process.env.MONITORING_RETRY_BACKOFF_MS = "90000";

    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [
            {
              teams: "1",
              projects: "1",
              repositories: "1",
              tasks: "30",
              activeTasks: "29",
              agentQueueLength: "4",
              humanGateTasks: "0",
              blockedTasks: "0",
              activeRuns: "1",
              stalledRuns: "2",
              retryBacklog: "3",
              failedRuns24h: "2",
              succeededRuns24h: "4",
              finishedRuns24h: "6",
              tokenTotal: "2000",
              costUsd: "1.500000",
              promptComponents: "1",
              promptBindings: "1",
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }),
    } as unknown as DatabaseClient;

    try {
      const summary = await fetchControlPlaneSummary(client);

      expect(summary.monitoringThresholds).toEqual({
        queueBacklogWarning: 3,
        stalledRunsCritical: 2,
        retryBacklogWarning: 3,
        failureRateCritical: 0.2,
        failureRateMinFinished: 5,
        costWarningUsd: 1,
        retryBackoffMs: 90000,
      });
      expect(summary.alerts.map((alert) => alert.key)).toEqual([
        "high-failure-rate",
        "queue-backlog",
        "cost-threshold",
      ]);
      expect(client.query).toHaveBeenNthCalledWith(2, expect.any(String), [90000]);
    } finally {
      process.env = previousEnv;
    }
  });
});
