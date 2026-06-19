import { readFile, writeFile } from "node:fs/promises";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  linearExportToPlaneImportDrafts,
  type LinearIssuePayload,
} from "../packages/plane/src/index.ts";

type MigrationOutput = {
  generatedAt: string;
  sourceFile: string;
  summary: {
    total: number;
    ready: number;
    missingRepo: number;
  };
  tasks: ReturnType<typeof linearExportToPlaneImportDrafts>;
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const raw = await readFile(args.input, "utf8");
  const input = parseInput(raw, args.input);
  const tasks = linearExportToPlaneImportDrafts(input);
  const output: MigrationOutput = {
    generatedAt: new Date().toISOString(),
    sourceFile: args.input,
    summary: {
      total: tasks.length,
      ready: tasks.filter((task) => !task.blockedReason).length,
      missingRepo: tasks.filter((task) => task.blockedReason === "missing-repo").length,
    },
    tasks,
  };
  const serialized = `${JSON.stringify(output, null, 2)}\n`;

  if (args.output) {
    await writeFile(args.output, serialized, "utf8");
    console.log(`wrote ${args.output}`);
    console.log(JSON.stringify(output.summary));
    return;
  }

  process.stdout.write(serialized);
}

function parseArgs(args: string[]) {
  const parsed: { input?: string; output?: string } = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--output" || arg === "-o") {
      parsed.output = args[index + 1];
      index += 1;
    } else if (!parsed.input) {
      parsed.input = arg;
    }
  }

  return parsed;
}

function parseInput(raw: string, filename: string): unknown {
  const extension = extname(filename).toLowerCase();
  if (extension === ".csv") {
    return parseCsv(raw);
  }

  return JSON.parse(raw) as unknown;
}

function parseCsv(raw: string): LinearIssuePayload[] {
  const rows = parseCsvRows(raw).filter((row) => row.some((cell) => cell.trim()));
  const [header, ...body] = rows;
  if (!header || header.length === 0) {
    return [];
  }

  return body.map((row) => {
    const record: Record<string, string | string[]> = {};
    header.forEach((column, index) => {
      const key = normalizeCsvHeader(column);
      if (!key) return;
      const value = row[index]?.trim() ?? "";
      if (key === "labels" || key === "labelNames") {
        record[key] = value
          .split(/[;,]/)
          .map((label) => label.trim())
          .filter(Boolean);
      } else {
        record[key] = value;
      }
    });
    return record as LinearIssuePayload;
  });
}

function normalizeCsvHeader(header: string): string {
  const normalized = header
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
  const map: Record<string, string> = {
    assignee: "assignee",
    description: "description",
    id: "id",
    identifier: "identifier",
    issueid: "issueId",
    key: "key",
    labels: "labels",
    labelnames: "labelNames",
    priority: "priority",
    project: "project",
    repo: "repo",
    repository: "repository",
    state: "state",
    status: "status",
    team: "team",
    title: "title",
    url: "url",
  };

  return map[normalized] ?? header.trim();
}

function parseCsvRows(raw: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    const next = raw[index + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell);
  rows.push(row);
  return rows;
}

function printUsage() {
  console.error("usage: pnpm linear:migration-plan <linear-export.json|csv> [--output draft.json]");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
