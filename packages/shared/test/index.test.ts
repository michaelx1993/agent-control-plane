import { describe, expect, it } from "vitest";
import {
  addSeconds,
  err,
  FEEDBACK_SEVERITIES,
  isErr,
  isIsoDateTime,
  isOk,
  ok,
  sha256Hex,
  toIsoDateTime,
} from "../src/index";

describe("Result helpers", () => {
  it("narrows ok and error results", () => {
    const good = ok("sealed");
    const bad = err({ code: "BROKEN", message: "failed" });

    expect(isOk(good)).toBe(true);
    expect(isErr(bad)).toBe(true);
    if (isOk(good)) expect(good.value).toBe("sealed");
    if (isErr(bad)) expect(bad.error.code).toBe("BROKEN");
  });
});

describe("feedback severity helpers", () => {
  it("defines shared feedback severity ordering", () => {
    expect(FEEDBACK_SEVERITIES).toEqual(["info", "minor", "major", "blocker"]);
  });
});

describe("datetime helpers", () => {
  it("normalizes values to ISO datetimes", () => {
    const rendered = toIsoDateTime("2026-06-18T00:00:00.000Z");

    expect(rendered.ok).toBe(true);
    if (rendered.ok) expect(isIsoDateTime(rendered.value)).toBe(true);
  });

  it("returns explicit errors for invalid datetimes", () => {
    const rendered = toIsoDateTime("not-a-date");

    expect(rendered.ok).toBe(false);
    if (!rendered.ok) expect(rendered.error.code).toBe("INVALID_DATETIME");
  });

  it("adds seconds without mutating the source time", () => {
    const rendered = addSeconds("2026-06-18T00:00:00.000Z", 90);

    expect(rendered).toEqual({ ok: true, value: "2026-06-18T00:01:30.000Z" });
  });
});

describe("sha256Hex", () => {
  it("hashes prompt content deterministically", () => {
    expect(sha256Hex("agent-control-plane")).toBe(
      "c9dd5eb8025455a3abca8ff66ae6778da65081fc9da41117c5426cc10d7377ab",
    );
  });
});
