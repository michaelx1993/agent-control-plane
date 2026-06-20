import { describe, expect, it } from "vitest";
import { getDatabaseUrl } from "../src/config";

describe("database config", () => {
  it("uses DATABASE_URL when provided", () => {
    expect(getDatabaseUrl({ DATABASE_URL: "postgresql://example/db" })).toBe(
      "postgresql://example/db",
    );
  });

  it("falls back to the local agent control plane postgres container", () => {
    expect(getDatabaseUrl({})).toBe("postgresql://agent:agent@localhost:54329/agent_control_plane");
  });
});
