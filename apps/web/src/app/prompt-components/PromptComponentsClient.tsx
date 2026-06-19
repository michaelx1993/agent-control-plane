"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type PromptScopeType = "global" | "team" | "project" | "repo" | "role" | "agent";
type PromptComponentStatus = "draft" | "active" | "archived";

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

type FormState = {
  scopeType: PromptScopeType;
  scopeId: string;
  name: string;
  status: PromptComponentStatus;
  content: string;
  changelog: string;
  author: string;
};

const initialFormState: FormState = {
  scopeType: "global",
  scopeId: "",
  name: "",
  status: "draft",
  content: "",
  changelog: "",
  author: "operator",
};

export function PromptComponentsClient() {
  const [components, setComponents] = useState<PromptComponentItem[]>([]);
  const [form, setForm] = useState<FormState>(initialFormState);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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
      const response = await fetch("/api/prompt-components", { cache: "no-store" });
      const payload = (await response.json()) as PromptComponentsResponse;
      setComponents(payload.promptComponents);
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
      setForm(initialFormState);
      await loadComponents();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
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
      </section>
    </main>
  );
}
