import type {
  ISODateTime,
  PromptComponentStatus,
  PromptScope,
  Result,
  UUID,
} from "../../shared/src/index";
import { controlPlaneError, err, nowIso, ok, sha256Hex } from "../../shared/src/index";

export const PROMPT_RENDER_ORDER = [
  "global",
  "team",
  "project",
  "repo",
  "role",
  "agent",
  "task",
  "runtime",
] as const satisfies readonly PromptScope[];

export interface PromptComponent {
  id: UUID;
  name: string;
  scope: PromptScope;
  version: number;
  status: PromptComponentStatus;
  content: string;
  author: string;
  changelog: string;
  orderIndex?: number;
}

export interface PromptReleaseInput {
  id?: UUID;
  taskId?: UUID;
  repositoryId?: UUID;
  roleId?: UUID;
  agentDefinitionId?: UUID;
  createdAt?: ISODateTime;
}

export interface RenderedPromptComponent {
  id: UUID;
  name: string;
  scope: PromptScope;
  version: number;
  orderIndex: number;
  contentHash: string;
  summary: string;
}

export interface RenderedPromptRelease {
  id?: UUID;
  taskId?: UUID;
  repositoryId?: UUID;
  roleId?: UUID;
  agentDefinitionId?: UUID;
  renderedContent: string;
  contentHash: string;
  components: RenderedPromptComponent[];
  createdAt: ISODateTime;
}

export interface ReleaseComponentSummary {
  orderIndex: number;
  scope: PromptScope;
  name: string;
  version: number;
  contentHash: string;
  summary: string;
}

export function renderPromptRelease(
  components: readonly PromptComponent[],
  release: PromptReleaseInput = {},
): Result<RenderedPromptRelease> {
  const activeComponents = components.filter((component) => component.status === "active");
  if (activeComponents.length === 0) {
    return err(
      controlPlaneError(
        "PROMPT_COMPONENTS_EMPTY",
        "At least one active prompt component is required.",
      ),
    );
  }

  const invalidScope = activeComponents.find(
    (component) => !PROMPT_RENDER_ORDER.includes(component.scope),
  );
  if (invalidScope !== undefined) {
    return err(
      controlPlaneError(
        "PROMPT_SCOPE_INVALID",
        `Prompt component '${invalidScope.name}' has an unsupported scope.`,
        {
          componentId: invalidScope.id,
          scope: invalidScope.scope,
        },
      ),
    );
  }

  const orderedComponents = [...activeComponents].sort(comparePromptComponents);
  const renderedContent = orderedComponents.map(formatComponent).join("\n\n");
  const renderedComponents = orderedComponents.map((component, index) => ({
    id: component.id,
    name: component.name,
    scope: component.scope,
    version: component.version,
    orderIndex: index,
    contentHash: sha256Hex(component.content),
    summary: summarizeContent(component.content),
  }));

  return ok({
    ...release,
    renderedContent,
    contentHash: sha256Hex(renderedContent),
    components: renderedComponents,
    createdAt: release.createdAt ?? nowIso(),
  });
}

export function summarizeReleaseComponents(
  release: RenderedPromptRelease,
): ReleaseComponentSummary[] {
  return release.components.map((component) => ({
    orderIndex: component.orderIndex,
    scope: component.scope,
    name: component.name,
    version: component.version,
    contentHash: component.contentHash,
    summary: component.summary,
  }));
}

export function summarizeContent(content: string, maxLength = 120): string {
  const compact = content.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 3)}...`;
}

function comparePromptComponents(left: PromptComponent, right: PromptComponent): number {
  const scopeDelta =
    PROMPT_RENDER_ORDER.indexOf(left.scope) - PROMPT_RENDER_ORDER.indexOf(right.scope);
  if (scopeDelta !== 0) return scopeDelta;

  const orderDelta = (left.orderIndex ?? 0) - (right.orderIndex ?? 0);
  if (orderDelta !== 0) return orderDelta;

  return left.name.localeCompare(right.name);
}

function formatComponent(component: PromptComponent): string {
  return [
    `<!-- prompt:${component.scope}/${component.name}@v${component.version} -->`,
    component.content.trim(),
  ].join("\n");
}
