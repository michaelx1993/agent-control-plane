import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export type SecretFinding = {
  file: string;
  line: number;
  kind: string;
  preview: string;
};

type SecretPattern = {
  kind: string;
  pattern: RegExp;
};

const highConfidencePatterns: SecretPattern[] = [
  {
    kind: "private-key-block",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  },
  {
    kind: "openai-or-compatible-key",
    pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/,
  },
  {
    kind: "github-token",
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{30,}\b/,
  },
  {
    kind: "slack-token",
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
  },
  {
    kind: "aws-access-key",
    pattern: /\bAKIA[0-9A-Z]{16}\b/,
  },
  {
    kind: "dotenv-secret-assignment",
    pattern:
      /\b(?:API[_-]?KEY|ACCESS[_-]?TOKEN|AUTH[_-]?TOKEN|BEARER[_-]?TOKEN|CLIENT[_-]?SECRET|PASSWORD|PRIVATE[_-]?KEY|SECRET|TOKEN)\b\s*[:=]\s*["']?[A-Za-z0-9+/_.=-]{24,}["']?/i,
  },
];

const skippedPathPatterns = [
  /^\.git\//,
  /^\.next\//,
  /^coverage\//,
  /^node_modules\//,
  /^backups\//,
  /(^|\/)dist\//,
  /(^|\/)build\//,
  /(^|\/)\.turbo\//,
  /\.test\.[cm]?[tj]sx?$/,
  /(^|\/)pnpm-lock\.yaml$/,
];

const textFilePattern =
  /\.(bash|cjs|css|env|example|js|json|jsx|mjs|md|prisma|sh|sql|ts|tsx|txt|yaml|yml)$/;

export function scanFiles(files: Array<{ path: string; content: string }>): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const file of files) {
    for (const finding of scanFile(file.path, file.content)) {
      findings.push(finding);
    }
  }
  return findings;
}

export function scanFile(file: string, content: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const lines = content.split(/\r?\n/);
  lines.forEach((lineContent, index) => {
    for (const secretPattern of highConfidencePatterns) {
      if (secretPattern.pattern.test(lineContent)) {
        if (
          secretPattern.kind === "dotenv-secret-assignment" &&
          isEnvironmentReference(lineContent)
        ) {
          continue;
        }
        findings.push({
          file,
          line: index + 1,
          kind: secretPattern.kind,
          preview: redactPreview(lineContent.trim()),
        });
      }
    }
  });
  return findings;
}

export function trackedTextFiles(): string[] {
  const root = gitRoot();
  const output = execFileSync("git", ["-C", root, "ls-files"], { encoding: "utf8" });
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((path) => textFilePattern.test(path))
    .filter((path) => !skippedPathPatterns.some((pattern) => pattern.test(path)));
}

export function main() {
  const root = gitRoot();
  const files = trackedTextFiles().map((path) => ({
    path,
    content: readFileSync(join(root, path), "utf8"),
  }));
  const findings = scanFiles(files);
  if (findings.length > 0) {
    console.error("secrets-check failed: possible committed secrets found");
    for (const finding of findings) {
      console.error(`${finding.file}:${finding.line} ${finding.kind} ${finding.preview}`);
    }
    process.exit(1);
  }
  console.log(`secrets-check passed (${files.length} tracked text files scanned)`);
}

function isEnvironmentReference(value: string): boolean {
  return /\b(?:process\.env|import\.meta\.env|env\.[A-Z0-9_]+)\b/.test(value);
}

function redactPreview(value: string): string {
  if (value.length <= 16) {
    return "[REDACTED]";
  }
  return `${value.slice(0, 8)}...[REDACTED]...${value.slice(-4)}`;
}

function gitRoot(): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
}

const isCli = process.argv[1] === fileURLToPath(import.meta.url);
if (isCli) {
  main();
}
