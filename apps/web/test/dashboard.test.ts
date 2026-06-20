import { describe, expect, it } from "vitest";
import { getDashboardSnapshot } from "../src/dashboard";

describe("dashboard snapshot", () => {
  it("exposes implemented and pending modules", async () => {
    const snapshot = await getDashboardSnapshot();

    expect(
      snapshot.modules.some((module) => module.name === "Core" && module.status === "ready"),
    ).toBe(true);
    expect(
      snapshot.modules.some((module) => module.name === "Plane" && module.status === "ready"),
    ).toBe(true);
    expect(
      snapshot.modules.some(
        (module) =>
          module.name === "Codex Worker" &&
          module.status === "ready" &&
          module.detail.includes("codex-cli"),
      ),
    ).toBe(true);
    expect(
      snapshot.modules.some(
        (module) =>
          module.name === "Optional Integrations" &&
          module.status === "ready" &&
          module.detail.includes("optional/legacy profile"),
      ),
    ).toBe(true);
    expect(
      snapshot.workflow.some((item) => item.state === "Development" && item.mode === "agent"),
    ).toBe(true);

    if (snapshot.database?.summary) {
      expect(snapshot.database.summary).toHaveProperty("agentQueueLength");
      expect(snapshot.database.summary).toHaveProperty("runSuccessRate24h");
      expect(snapshot.database.summary).toHaveProperty("tokenTotal");
      expect(snapshot.database.summary).toHaveProperty("costUsd");
      expect(snapshot.database.summary).toHaveProperty("alertLevel");
      expect(snapshot.database.summary).toHaveProperty("alerts");
      expect(snapshot.database.summary).toHaveProperty("runTrend");
      expect(snapshot.database.summary).toHaveProperty("runTrendWindow");
      expect(snapshot.database.summary).toHaveProperty("runTrend24h");
      expect(snapshot.database.summary).toHaveProperty("monitoringThresholds");
    }
  });
});
