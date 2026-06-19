import { describe, expect, it } from "vitest";
import {
  PROMPT_RENDER_ORDER,
  renderPromptRelease,
  summarizeContent,
  summarizeReleaseComponents,
  type PromptComponent,
} from "../src/index";

const components: PromptComponent[] = [
  active("runtime-constraints", "runtime", "Run tests before summary."),
  active("repo-rules", "repo", "Repository rules."),
  active("global-base", "global", "Global rules."),
  active("agent-profile", "agent", "Agent definition override."),
  active("task-context", "task", "Task title and comments."),
  active("team-rules", "team", "Team rules."),
  active("role-dev", "role", "Development role."),
  active("project-rules", "project", "Project rules."),
  { ...active("old", "global", "Archived rules."), status: "archived" },
];

describe("PROMPT_RENDER_ORDER", () => {
  it("matches the PRD and roadmap prompt assembly order", () => {
    expect(PROMPT_RENDER_ORDER).toEqual([
      "global",
      "team",
      "project",
      "repo",
      "role",
      "agent",
      "task",
      "runtime",
    ]);
  });
});

describe("renderPromptRelease", () => {
  it("renders active components in global/team/project/repo/role/agent/task/runtime order", () => {
    const result = renderPromptRelease(components, {
      id: "release-1",
      taskId: "task-1",
      createdAt: "2026-06-18T00:00:00.000Z",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const scopes = result.value.components.map((component) => component.scope);
    expect(scopes).toEqual([
      "global",
      "team",
      "project",
      "repo",
      "role",
      "agent",
      "task",
      "runtime",
    ]);
    expect(result.value.renderedContent).toContain("<!-- prompt:global/global-base@v1 -->");
    expect(result.value.renderedContent).not.toContain("Archived rules.");
    expect(result.value.contentHash).toHaveLength(64);
  });

  it("returns release component summaries", () => {
    const result = renderPromptRelease([active("global-base", "global", "Global rules.")]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(summarizeReleaseComponents(result.value)).toEqual([
      {
        orderIndex: 0,
        scope: "global",
        name: "global-base",
        version: 1,
        contentHash: result.value.components[0]?.contentHash,
        summary: "Global rules.",
      },
    ]);
  });

  it("returns explicit error when no active components are available", () => {
    const result = renderPromptRelease([
      { ...active("draft", "global", "Draft."), status: "draft" },
    ]);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PROMPT_COMPONENTS_EMPTY");
  });
});

describe("summarizeContent", () => {
  it("compacts whitespace and truncates long content", () => {
    expect(summarizeContent("one\n\n two   three", 20)).toBe("one two three");
    expect(summarizeContent("x".repeat(130), 10)).toBe("xxxxxxx...");
  });
});

function active(name: string, scope: PromptComponent["scope"], content: string): PromptComponent {
  return {
    id: `${scope}-${name}`,
    name,
    scope,
    version: 1,
    status: "active",
    content,
    author: "agent-control-plane",
    changelog: "initial",
  };
}
