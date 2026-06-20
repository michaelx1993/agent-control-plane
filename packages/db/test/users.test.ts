import { describe, expect, it, vi } from "vitest";
import { insertUserAuditEvent, listUsers, upsertOperatorUser } from "../src/users";
import type { DatabaseClient } from "../src/client";

describe("operator users", () => {
  it("upserts local operator users and returns database identity", async () => {
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: "00000000-0000-4000-8000-000000000901",
            external_provider: "local",
            external_user_id: "local-operator",
            name: "local-operator",
            email: null,
          },
        ],
      }),
    } as unknown as DatabaseClient;

    await expect(
      upsertOperatorUser(client, {
        userId: "00000000-0000-4000-8000-000000000901",
        name: "local-operator",
      }),
    ).resolves.toEqual({
      id: "00000000-0000-4000-8000-000000000901",
      externalProvider: "local",
      externalUserId: "local-operator",
      name: "local-operator",
    });

    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("insert into users"), [
      "00000000-0000-4000-8000-000000000901",
      "local",
      "local-operator",
      "local-operator",
      null,
    ]);
  });

  it("lists users by latest update time", async () => {
    const createdAt = new Date("2026-06-19T12:00:00Z");
    const updatedAt = new Date("2026-06-19T12:05:00Z");
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: "00000000-0000-4000-8000-000000000901",
            external_provider: "local",
            external_user_id: "local-operator",
            name: "local-operator",
            email: "operator@example.com",
            created_at: createdAt,
            updated_at: updatedAt,
          },
        ],
      }),
    } as unknown as DatabaseClient;

    await expect(listUsers(client, { limit: 10 })).resolves.toEqual([
      {
        id: "00000000-0000-4000-8000-000000000901",
        externalProvider: "local",
        externalUserId: "local-operator",
        name: "local-operator",
        email: "operator@example.com",
        createdAt,
        updatedAt,
      },
    ]);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("from users"), [10]);
  });

  it("writes user audit events with actor context", async () => {
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    } as unknown as DatabaseClient;

    await expect(
      insertUserAuditEvent(client, {
        userId: "00000000-0000-4000-8000-000000000901",
        action: "user.upsert",
        message: "Operator user upserted.",
        actor: {
          userId: "00000000-0000-4000-8000-000000000902",
          name: "admin",
          roles: ["admin"],
        },
      }),
    ).resolves.toBeUndefined();
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("insert into audit_events"), [
      "00000000-0000-4000-8000-000000000902",
      "user.upsert",
      "00000000-0000-4000-8000-000000000901",
      "Operator user upserted.",
      "admin",
      ["admin"],
    ]);
  });
});
