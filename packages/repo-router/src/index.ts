import type { Result, UUID } from "../../shared/src/index";
import { controlPlaneError, err, ok } from "../../shared/src/index";

export interface RepositoryDefinition {
  id?: UUID;
  projectSlug?: string;
  slug: string;
  aliases?: readonly string[];
  status?: "active" | "archived";
}

export interface RoutableTask {
  id?: UUID;
  identifier?: string;
  projectSlug?: string;
  repo?: string | null;
  repositorySlug?: string | null;
  labels?: readonly (string | { name: string })[];
}

export interface RepositoryRoute {
  slug: string;
  repository: RepositoryDefinition;
  source: "field" | "label";
}

export interface ResolveRepositoryOptions {
  requireActive?: boolean;
}

export function resolveRepository(
  task: RoutableTask,
  repositories: readonly RepositoryDefinition[],
  options: ResolveRepositoryOptions = {},
): Result<RepositoryRoute> {
  const explicitRepo = cleanSlug(task.repo ?? task.repositorySlug ?? undefined);
  const labelRepo = explicitRepo === undefined ? repoSlugFromLabels(task.labels) : undefined;
  const requestedSlug = explicitRepo ?? labelRepo;

  if (requestedSlug === undefined) {
    return err(
      controlPlaneError(
        "REPO_REQUIRED",
        "Task must specify a repository via repo field or repo:<slug> label before dispatch.",
        {
          taskId: task.id,
          identifier: task.identifier,
          projectSlug: task.projectSlug,
        },
      ),
    );
  }

  const repository = repositories.find((candidate) =>
    repositoryMatches(candidate, requestedSlug, task.projectSlug),
  );
  if (repository === undefined) {
    return err(
      controlPlaneError(
        "REPO_NOT_FOUND",
        `Repository '${requestedSlug}' is not configured for this project.`,
        {
          requestedSlug,
          projectSlug: task.projectSlug,
        },
      ),
    );
  }

  if (options.requireActive === true && repository.status === "archived") {
    return err(
      controlPlaneError(
        "REPO_ARCHIVED",
        `Repository '${repository.slug}' is archived and cannot receive agent runs.`,
        {
          requestedSlug,
          projectSlug: task.projectSlug,
        },
      ),
    );
  }

  return ok({
    slug: repository.slug,
    repository,
    source: explicitRepo === undefined ? "label" : "field",
  });
}

export function repoSlugFromLabels(labels: RoutableTask["labels"]): string | undefined {
  if (labels === undefined) return undefined;

  for (const label of labels) {
    const name = typeof label === "string" ? label : label.name;
    const match = /^repo:([a-zA-Z0-9._-]+)$/.exec(name.trim());
    if (match?.[1] !== undefined) return match[1];
  }

  return undefined;
}

function cleanSlug(value: string | null | undefined): string | undefined {
  const cleaned = value?.trim();
  return cleaned === undefined || cleaned.length === 0 ? undefined : cleaned;
}

function repositoryMatches(
  repository: RepositoryDefinition,
  requestedSlug: string,
  projectSlug: string | undefined,
): boolean {
  if (
    projectSlug !== undefined &&
    repository.projectSlug !== undefined &&
    repository.projectSlug !== projectSlug
  ) {
    return false;
  }

  const normalizedRequested = normalizeSlug(requestedSlug);
  if (normalizeSlug(repository.slug) === normalizedRequested) return true;
  return repository.aliases?.some((alias) => normalizeSlug(alias) === normalizedRequested) ?? false;
}

function normalizeSlug(slug: string): string {
  return slug.trim().toLowerCase();
}
