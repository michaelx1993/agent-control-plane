import { describe, expect, it } from "vitest";

import { scanFile, scanFiles } from "../src/secrets-check.js";

describe("secrets-check", () => {
  it("detects high confidence committed secrets", () => {
    const findings = scanFiles([
      {
        path: ".env",
        content: [
          "OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456",
          "GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz123456",
          "AWS_ACCESS_KEY_ID=AKIAABCDEFGHIJKLMNOP",
        ].join("\n"),
      },
    ]);

    expect(findings.map((finding) => finding.kind)).toEqual([
      "openai-or-compatible-key",
      "github-token",
      "aws-access-key",
    ]);
    expect(findings.every((finding) => finding.preview.includes("[REDACTED]"))).toBe(true);
  });

  it("ignores placeholders and short test strings", () => {
    expect(
      scanFile(
        ".env.example",
        [
          'OPENAI_API_KEY=""',
          "PLANE_API_KEY=secret",
          "CONTROL_PLANE_API_TOKEN=operator-token",
          "Use fake credentials in local tests.",
        ].join("\n"),
      ),
    ).toEqual([]);
  });
});
