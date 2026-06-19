"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import { OperatorTokenPanel } from "../OperatorTokenPanel";
import { operatorFetch } from "../operator-api";

type PromptScopeType = "global" | "team" | "project" | "repo" | "role" | "agent";
type PromptComponentStatus = "draft" | "active" | "archived";
type PromptBindingEnvironment = "dev" | "staging" | "prod";
type PromptBindingStatus = "active" | "disabled";

type PromptComponentItem = {
  id: string;
  scopeType: PromptScopeType;
  scopeId: string | null;
  name: string;
  version: number;
  status: PromptComponentStatus;
  content: string;
  changelog: string | null;
  author: string | null;
  updatedAt: string;
};

type PromptComponentsResponse = {
  count: number;
  promptComponents: PromptComponentItem[];
};

type PromptComponentDiffLine = {
  type: "unchanged" | "added" | "removed";
  text: string;
};

type PromptComponentDiffResponse = {
  left: PromptComponentItem;
  right: PromptComponentItem;
  summary: {
    added: number;
    removed: number;
    unchanged: number;
  };
  lines: PromptComponentDiffLine[];
};

type PromptBindingItem = {
  id: string;
  scopeType: Exclude<PromptScopeType, "global">;
  scopeId: string;
  promptComponentId: string;
  promptComponentName: string;
  promptComponentVersion: number;
  orderIndex: number;
  environment: PromptBindingEnvironment;
  status: PromptBindingStatus;
  updatedAt: string;
};

type PromptBindingsResponse = {
  count: number;
  promptBindings: PromptBindingItem[];
};

type PromptScopeItem = {
  scopeType: Exclude<PromptScopeType, "global">;
  id: string;
  label: string;
  detail: string;
};

type PromptScopesResponse = {
  count: number;
  scopes: PromptScopeItem[];
};

type ComponentFormState = {
  scopeType: PromptScopeType;
  scopeId: string;
  name: string;
  status: PromptComponentStatus;
  content: string;
  changelog: string;
  author: string;
};

type BindingFormState = {
  scopeType: Exclude<PromptScopeType, "global">;
  scopeId: string;
  promptComponentId: string;
  orderIndex: string;
  environment: PromptBindingEnvironment;
  status: PromptBindingStatus;
};

const initialComponentFormState: ComponentFormState = {
  scopeType: "global",
  scopeId: "",
  name: "",
  status: "draft",
  content: "",
  changelog: "",
  author: "operator",
};

const initialBindingFormState: BindingFormState = {
  scopeType: "repo",
  scopeId: "",
  promptComponentId: "",
  orderIndex: "0",
  environment: "dev",
  status: "active",
};

function scopesFor(scopes: PromptScopeItem[], scopeType: PromptScopeType): PromptScopeItem[] {
  if (scopeType === "global") return [];
  return scopes.filter((scope) => scope.scopeType === scopeType);
}

export function PromptComponentsClient() {
  const [components, setComponents] = useState<PromptComponentItem[]>([]);
  const [bindings, setBindings] = useState<PromptBindingItem[]>([]);
  const [scopes, setScopes] = useState<PromptScopeItem[]>([]);
  const [form, setForm] = useState<ComponentFormState>(initialComponentFormState);
  const [bindingForm, setBindingForm] = useState<BindingFormState>(initialBindingFormState);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [bindingSaving, setBindingSaving] = useState(false);
  const [diffLeftId, setDiffLeftId] = useState("");
  const [diffRightId, setDiffRightId] = useState("");
  const [diff, setDiff] = useState<PromptComponentDiffResponse | undefined>();
  const [diffLoading, setDiffLoading] = useState(false);
  const [rollbackComponentId, setRollbackComponentId] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    void loadComponents();
  }, []);

  const groupedComponents = useMemo(() => {
    return components.reduce<Record<string, PromptComponentItem[]>>((groups, component) => {
      const key = `${component.scopeType}${component.scopeId ? `:${component.scopeId}` : ""}`;
      groups[key] = [...(groups[key] ?? []), component];
      return groups;
    }, {});
  }, [components]);

  const componentScopes = useMemo(
    () => scopesFor(scopes, form.scopeType),
    [form.scopeType, scopes],
  );
  const bindingScopes = useMemo(
    () => scopesFor(scopes, bindingForm.scopeType),
    [bindingForm.scopeType, scopes],
  );

  async function loadComponents() {
    setLoading(true);
    setError(undefined);
    try {
      const [componentsResponse, bindingsResponse, scopesResponse] = await Promise.all([
        operatorFetch("/api/prompt-components", { cache: "no-store" }),
        operatorFetch("/api/prompt-bindings", { cache: "no-store" }),
        operatorFetch("/api/prompt-scopes", { cache: "no-store" }),
      ]);
      const componentsPayload = (await componentsResponse.json()) as PromptComponentsResponse;
      const bindingsPayload = (await bindingsResponse.json()) as PromptBindingsResponse;
      const scopesPayload = (await scopesResponse.json()) as PromptScopesResponse;
      if (!componentsResponse.ok || !bindingsResponse.ok || !scopesResponse.ok) {
        throw new Error(
          errorPayloadMessage(componentsPayload) ??
            errorPayloadMessage(bindingsPayload) ??
            errorPayloadMessage(scopesPayload) ??
            "Load failed",
        );
      }
      setComponents(componentsPayload.promptComponents);
      setBindings(bindingsPayload.promptBindings);
      setScopes(scopesPayload.scopes);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(undefined);
    try {
      const response = await operatorFetch("/api/prompt-components", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scopeType: form.scopeType,
          scopeId: form.scopeId.trim() || null,
          name: form.name.trim(),
          status: form.status,
          content: form.content,
          changelog: form.changelog.trim() || null,
          author: form.author.trim() || null,
        }),
      });
      const payload = (await response.json()) as PromptComponentItem | { error?: string };
      if (!response.ok) {
        throw new Error("error" in payload && payload.error ? payload.error : "Save failed");
      }
      setForm(initialComponentFormState);
      await loadComponents();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function submitBinding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBindingSaving(true);
    setError(undefined);
    try {
      const response = await operatorFetch("/api/prompt-bindings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scopeType: bindingForm.scopeType,
          scopeId: bindingForm.scopeId.trim(),
          promptComponentId: bindingForm.promptComponentId,
          orderIndex: Number(bindingForm.orderIndex || 0),
          environment: bindingForm.environment,
          status: bindingForm.status,
        }),
      });
      const payload = (await response.json()) as PromptBindingItem | { error?: string };
      if (!response.ok) {
        throw new Error("error" in payload && payload.error ? payload.error : "Save failed");
      }
      setBindingForm(initialBindingFormState);
      await loadComponents();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setBindingSaving(false);
    }
  }

  async function loadDiff() {
    if (!diffLeftId || !diffRightId) return;
    setDiffLoading(true);
    setError(undefined);
    try {
      const response = await operatorFetch(
        `/api/prompt-components/diff?left=${encodeURIComponent(diffLeftId)}&right=${encodeURIComponent(diffRightId)}`,
        { cache: "no-store" },
      );
      const payload = (await response.json()) as PromptComponentDiffResponse | { error?: string };
      if (!response.ok) {
        throw new Error("error" in payload && payload.error ? payload.error : "Diff failed");
      }
      setDiff(payload as PromptComponentDiffResponse);
    } catch (diffError) {
      setError(diffError instanceof Error ? diffError.message : String(diffError));
    } finally {
      setDiffLoading(false);
    }
  }

  async function rollbackComponent(component: PromptComponentItem) {
    setRollbackComponentId(component.id);
    setError(undefined);
    try {
      const response = await operatorFetch(`/api/prompt-components/${component.id}/rollback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          author: "operator",
          changelog: `Rollback active prompt to ${component.name}@v${component.version}`,
        }),
      });
      const payload = (await response.json()) as PromptComponentItem | { error?: string };
      if (!response.ok) {
        throw new Error("error" in payload && payload.error ? payload.error : "Rollback failed");
      }
      await loadComponents();
    } catch (rollbackError) {
      setError(rollbackError instanceof Error ? rollbackError.message : String(rollbackError));
    } finally {
      setRollbackComponentId(undefined);
    }
  }

  return (
    <main className="shell">
      <header className="topbar" aria-label="Prompt components">
        <div>
          <p className="eyebrow">Prompt Platform</p>
          <h1>Prompt Components</h1>
        </div>
        <a className="buttonLink" href="/">
          Dashboard
        </a>
      </header>
      <OperatorTokenPanel />

      <section className="dashboardGrid promptGrid" aria-label="Prompt component manager">
        <section className="panel">
          <div className="panelHead">
            <h2>New Component</h2>
            <span>{saving ? "saving" : "draft"}</span>
          </div>
          <form className="promptForm" onSubmit={submit}>
            <label>
              <span>Scope</span>
              <select
                value={form.scopeType}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    scopeType: event.target.value as PromptScopeType,
                    scopeId: "",
                  }))
                }
              >
                <option value="global">global</option>
                <option value="team">team</option>
                <option value="project">project</option>
                <option value="repo">repo</option>
                <option value="role">role</option>
                <option value="agent">agent</option>
              </select>
            </label>
            <label>
              <span>Scope ID</span>
              {form.scopeType === "global" ? (
                <input value="" disabled />
              ) : (
                <select
                  required
                  value={form.scopeId}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, scopeId: event.target.value }))
                  }
                >
                  <option value="">select {form.scopeType}</option>
                  {componentScopes.map((scope) => (
                    <option key={scope.id} value={scope.id}>
                      {scope.label} · {scope.detail}
                    </option>
                  ))}
                </select>
              )}
            </label>
            <label>
              <span>Name</span>
              <input
                required
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({ ...current, name: event.target.value }))
                }
              />
            </label>
            <label>
              <span>Status</span>
              <select
                value={form.status}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    status: event.target.value as PromptComponentStatus,
                  }))
                }
              >
                <option value="draft">draft</option>
                <option value="active">active</option>
                <option value="archived">archived</option>
              </select>
            </label>
            <label>
              <span>Content</span>
              <textarea
                required
                rows={12}
                value={form.content}
                onChange={(event) =>
                  setForm((current) => ({ ...current, content: event.target.value }))
                }
              />
            </label>
            <label>
              <span>Changelog</span>
              <input
                value={form.changelog}
                onChange={(event) =>
                  setForm((current) => ({ ...current, changelog: event.target.value }))
                }
              />
            </label>
            <label>
              <span>Author</span>
              <input
                value={form.author}
                onChange={(event) =>
                  setForm((current) => ({ ...current, author: event.target.value }))
                }
              />
            </label>
            {error ? <p className="formError">{error}</p> : null}
            <button className="primaryButton" type="submit" disabled={saving}>
              {saving ? "Saving" : "Create"}
            </button>
          </form>
        </section>

        <section className="panel">
          <div className="panelHead">
            <h2>New Binding</h2>
            <span>{bindingSaving ? "saving" : "dev"}</span>
          </div>
          <form className="promptForm" onSubmit={submitBinding}>
            <label>
              <span>Scope</span>
              <select
                value={bindingForm.scopeType}
                onChange={(event) =>
                  setBindingForm((current) => ({
                    ...current,
                    scopeType: event.target.value as BindingFormState["scopeType"],
                    scopeId: "",
                  }))
                }
              >
                <option value="team">team</option>
                <option value="project">project</option>
                <option value="repo">repo</option>
                <option value="role">role</option>
                <option value="agent">agent</option>
              </select>
            </label>
            <label>
              <span>Scope ID</span>
              <select
                required
                value={bindingForm.scopeId}
                onChange={(event) =>
                  setBindingForm((current) => ({ ...current, scopeId: event.target.value }))
                }
              >
                <option value="">select {bindingForm.scopeType}</option>
                {bindingScopes.map((scope) => (
                  <option key={scope.id} value={scope.id}>
                    {scope.label} · {scope.detail}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Component</span>
              <select
                required
                value={bindingForm.promptComponentId}
                onChange={(event) =>
                  setBindingForm((current) => ({
                    ...current,
                    promptComponentId: event.target.value,
                  }))
                }
              >
                <option value="">select component</option>
                {components.map((component) => (
                  <option key={component.id} value={component.id}>
                    {component.scopeType}/{component.name}@v{component.version}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Order</span>
              <input
                inputMode="numeric"
                value={bindingForm.orderIndex}
                onChange={(event) =>
                  setBindingForm((current) => ({ ...current, orderIndex: event.target.value }))
                }
              />
            </label>
            <label>
              <span>Environment</span>
              <select
                value={bindingForm.environment}
                onChange={(event) =>
                  setBindingForm((current) => ({
                    ...current,
                    environment: event.target.value as PromptBindingEnvironment,
                  }))
                }
              >
                <option value="dev">dev</option>
                <option value="staging">staging</option>
                <option value="prod">prod</option>
              </select>
            </label>
            <label>
              <span>Status</span>
              <select
                value={bindingForm.status}
                onChange={(event) =>
                  setBindingForm((current) => ({
                    ...current,
                    status: event.target.value as PromptBindingStatus,
                  }))
                }
              >
                <option value="active">active</option>
                <option value="disabled">disabled</option>
              </select>
            </label>
            <button className="primaryButton" type="submit" disabled={bindingSaving}>
              {bindingSaving ? "Saving" : "Bind"}
            </button>
          </form>
        </section>

        <section className="panel panelWide promptListPanel">
          <div className="panelHead">
            <h2>Components</h2>
            <span>{loading ? "loading" : `${components.length} total`}</span>
          </div>
          <div className="componentGroups">
            {Object.entries(groupedComponents).map(([scope, items]) => (
              <section className="componentGroup" key={scope}>
                <h3>{scope}</h3>
                <div className="releaseStack">
                  {items.map((component) => (
                    <article className="release" key={component.id}>
                      <div className="releaseHead">
                        <strong>{component.name}</strong>
                        <span
                          className={`pill ${
                            component.status === "active" ? "statusGood" : "statusInfo"
                          }`}
                        >
                          v{component.version} {component.status}
                        </span>
                      </div>
                      <p>{component.content}</p>
                      <small>
                        {component.author ?? "unknown"} · {component.changelog ?? "no changelog"}
                      </small>
                      <div className="componentActions">
                        <button
                          className="primaryButton"
                          type="button"
                          onClick={() => setDiffLeftId(component.id)}
                        >
                          Diff left
                        </button>
                        <button
                          className="primaryButton"
                          type="button"
                          onClick={() => setDiffRightId(component.id)}
                        >
                          Diff right
                        </button>
                        <button
                          className="primaryButton"
                          type="button"
                          disabled={rollbackComponentId === component.id}
                          onClick={() => void rollbackComponent(component)}
                        >
                          {rollbackComponentId === component.id ? "Rolling back" : "Rollback"}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ))}
            {!loading && components.length === 0 ? (
              <div className="emptyState">No prompt components</div>
            ) : null}
          </div>
        </section>

        <section className="panel panelWide promptListPanel">
          <div className="panelHead">
            <h2>Diff / Rollback</h2>
            <span>{diffLoading ? "loading" : diff ? "ready" : "select versions"}</span>
          </div>
          <div className="diffControls">
            <label>
              <span>Left</span>
              <select value={diffLeftId} onChange={(event) => setDiffLeftId(event.target.value)}>
                <option value="">select component</option>
                {components.map((component) => (
                  <option key={component.id} value={component.id}>
                    {component.scopeType}/{component.name}@v{component.version}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Right</span>
              <select value={diffRightId} onChange={(event) => setDiffRightId(event.target.value)}>
                <option value="">select component</option>
                {components.map((component) => (
                  <option key={component.id} value={component.id}>
                    {component.scopeType}/{component.name}@v{component.version}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="primaryButton"
              type="button"
              disabled={!diffLeftId || !diffRightId || diffLoading}
              onClick={() => void loadDiff()}
            >
              {diffLoading ? "Comparing" : "Compare"}
            </button>
          </div>
          {diff ? (
            <div className="diffViewer">
              <div className="diffSummary">
                <strong>
                  {diff.left.name}@v{diff.left.version} {"->"} {diff.right.name}@v
                  {diff.right.version}
                </strong>
                <span>
                  +{diff.summary.added} / -{diff.summary.removed} / {diff.summary.unchanged} same
                </span>
              </div>
              <pre>
                {diff.lines
                  .map((line) => {
                    const prefix =
                      line.type === "added" ? "+ " : line.type === "removed" ? "- " : "  ";
                    return `${prefix}${line.text}`;
                  })
                  .join("\n")}
              </pre>
            </div>
          ) : (
            <div className="emptyState">Select two prompt component versions to compare.</div>
          )}
        </section>

        <section className="panel panelWide promptListPanel">
          <div className="panelHead">
            <h2>Bindings</h2>
            <span>{loading ? "loading" : `${bindings.length} total`}</span>
          </div>
          <div className="releaseStack">
            {bindings.map((binding) => (
              <article className="release" key={binding.id}>
                <div className="releaseHead">
                  <strong>
                    {binding.scopeType}:{binding.scopeId}
                  </strong>
                  <span
                    className={`pill ${binding.status === "active" ? "statusGood" : "statusInfo"}`}
                  >
                    {binding.environment} · {binding.status}
                  </span>
                </div>
                <p>
                  {binding.promptComponentName}@v{binding.promptComponentVersion}
                </p>
                <small>order {binding.orderIndex}</small>
              </article>
            ))}
            {!loading && bindings.length === 0 ? (
              <div className="emptyState">No prompt bindings</div>
            ) : null}
          </div>
        </section>
      </section>
    </main>
  );
}

function errorPayloadMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object" || !("error" in payload)) {
    return undefined;
  }
  const error = (payload as { error?: unknown }).error;
  return typeof error === "string" ? error : undefined;
}
