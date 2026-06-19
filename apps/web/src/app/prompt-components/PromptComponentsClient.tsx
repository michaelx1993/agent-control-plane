"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

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

export function PromptComponentsClient() {
  const [components, setComponents] = useState<PromptComponentItem[]>([]);
  const [bindings, setBindings] = useState<PromptBindingItem[]>([]);
  const [form, setForm] = useState<ComponentFormState>(initialComponentFormState);
  const [bindingForm, setBindingForm] = useState<BindingFormState>(initialBindingFormState);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [bindingSaving, setBindingSaving] = useState(false);
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

  async function loadComponents() {
    setLoading(true);
    setError(undefined);
    try {
      const [componentsResponse, bindingsResponse] = await Promise.all([
        fetch("/api/prompt-components", { cache: "no-store" }),
        fetch("/api/prompt-bindings", { cache: "no-store" }),
      ]);
      const componentsPayload = (await componentsResponse.json()) as PromptComponentsResponse;
      const bindingsPayload = (await bindingsResponse.json()) as PromptBindingsResponse;
      setComponents(componentsPayload.promptComponents);
      setBindings(bindingsPayload.promptBindings);
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
      const response = await fetch("/api/prompt-components", {
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
      const response = await fetch("/api/prompt-bindings", {
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
              <input
                value={form.scopeId}
                onChange={(event) =>
                  setForm((current) => ({ ...current, scopeId: event.target.value }))
                }
              />
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
              <input
                required
                value={bindingForm.scopeId}
                onChange={(event) =>
                  setBindingForm((current) => ({ ...current, scopeId: event.target.value }))
                }
              />
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
