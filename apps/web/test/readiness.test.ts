import { describe, expect, it, vi } from "vitest";
import { getReadinessSnapshot, type ReadinessPool } from "../src/readiness";

describe("readiness snapshot", () => {
  it("reports ready when the lightweight database probe succeeds", async () => {
    const pool = createPool();
    const snapshot = await getReadinessSnapshot(process.env, () => pool);

    expect(snapshot.status).toBe("ready");
    expect(snapshot.database.connected).toBe(true);
    expect(pool.query).toHaveBeenCalledWith("select 1");
    expect(pool.end).toHaveBeenCalledOnce();
  });

  it("reports partial when the database probe fails", async () => {
    const pool = createPool(new Error("connection timeout"));
    const snapshot = await getReadinessSnapshot(process.env, () => pool);

    expect(snapshot.status).toBe("partial");
    expect(snapshot.database.connected).toBe(false);
    expect(snapshot.database.error).toContain("connection timeout");
    expect(pool.end).toHaveBeenCalledOnce();
  });
});

function createPool(error?: Error): ReadinessPool & {
  query: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
} {
  return {
    query: vi.fn(async () => {
      if (error) {
        throw error;
      }
    }),
    end: vi.fn(async () => undefined),
  };
}
