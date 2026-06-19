import { describe, expect, it } from "vitest";
import { repoSlugFromLabels, resolveRepository, type RepositoryDefinition } from "../src/index";

const repositories: RepositoryDefinition[] = [
  { id: "repo-1", projectSlug: "token", slug: "crs-src", aliases: ["crs"], status: "active" },
  { id: "repo-2", projectSlug: "token", slug: "traffic", status: "active" },
  { id: "repo-3", projectSlug: "token", slug: "sub3", status: "archived" },
];

describe("repoSlugFromLabels", () => {
  it("extracts repo:<slug> labels", () => {
    expect(repoSlugFromLabels(["backend", "repo:traffic"])).toBe("traffic");
    expect(repoSlugFromLabels([{ name: "repo:crs-src" }])).toBe("crs-src");
  });
});

describe("resolveRepository", () => {
  it("routes by explicit repo field first", () => {
    const result = resolveRepository(
      { projectSlug: "token", repo: "crs-src", labels: ["repo:traffic"] },
      repositories,
    );

    expect(result).toEqual({
      ok: true,
      value: { slug: "crs-src", repository: repositories[0], source: "field" },
    });
  });

  it("falls back to repo label", () => {
    const result = resolveRepository(
      { projectSlug: "token", labels: ["repo:traffic"] },
      repositories,
    );

    expect(result).toEqual({
      ok: true,
      value: { slug: "traffic", repository: repositories[1], source: "label" },
    });
  });

  it("supports configured aliases", () => {
    const result = resolveRepository({ projectSlug: "token", repo: "CRS" }, repositories);

    expect(result).toEqual({
      ok: true,
      value: { slug: "crs-src", repository: repositories[0], source: "field" },
    });
  });

  it("returns a clear error when repo is missing", () => {
    const result = resolveRepository({ projectSlug: "token", identifier: "TOK-1" }, repositories);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("REPO_REQUIRED");
  });

  it("returns a clear error when repo is unknown", () => {
    const result = resolveRepository({ projectSlug: "token", repo: "missing" }, repositories);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("REPO_NOT_FOUND");
  });

  it("can reject archived repositories for dispatch", () => {
    const result = resolveRepository({ projectSlug: "token", repo: "sub3" }, repositories, {
      requireActive: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("REPO_ARCHIVED");
  });
});
