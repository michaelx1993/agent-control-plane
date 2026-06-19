"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type FeedbackSource = "human" | "code_review" | "pr_review" | "agent" | "plane_comment";
type FeedbackSeverity = "info" | "minor" | "major" | "blocker";

type FeedbackFormState = {
  source: FeedbackSource;
  severity: FeedbackSeverity;
  body: string;
  externalUrl: string;
  returnToDevelopment: boolean;
};

const initialState: FeedbackFormState = {
  source: "human",
  severity: "major",
  body: "",
  externalUrl: "",
  returnToDevelopment: true,
};

export function RunFeedbackForm({ runId }: { runId: string }) {
  const router = useRouter();
  const [form, setForm] = useState<FeedbackFormState>(initialState);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(undefined);
    setSaved(false);

    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/feedback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source: form.source,
          severity: form.severity,
          body: form.body.trim(),
          externalUrl: form.externalUrl.trim() || null,
          returnToDevelopment: form.returnToDevelopment,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to create feedback");
      }

      setForm(initialState);
      setSaved(true);
      router.refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="feedbackForm" onSubmit={submit}>
      <div className="feedbackFormGrid">
        <label>
          <span>Source</span>
          <select
            value={form.source}
            onChange={(event) =>
              setForm((current) => ({ ...current, source: event.target.value as FeedbackSource }))
            }
          >
            <option value="human">human</option>
            <option value="code_review">code_review</option>
            <option value="pr_review">pr_review</option>
            <option value="agent">agent</option>
            <option value="plane_comment">plane_comment</option>
          </select>
        </label>
        <label>
          <span>Severity</span>
          <select
            value={form.severity}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                severity: event.target.value as FeedbackSeverity,
              }))
            }
          >
            <option value="info">info</option>
            <option value="minor">minor</option>
            <option value="major">major</option>
            <option value="blocker">blocker</option>
          </select>
        </label>
      </div>
      <label>
        <span>Feedback</span>
        <textarea
          required
          rows={5}
          value={form.body}
          onChange={(event) => setForm((current) => ({ ...current, body: event.target.value }))}
        />
      </label>
      <label>
        <span>Source URL</span>
        <input
          value={form.externalUrl}
          onChange={(event) =>
            setForm((current) => ({ ...current, externalUrl: event.target.value }))
          }
        />
      </label>
      <label className="checkboxLabel">
        <input
          type="checkbox"
          checked={form.returnToDevelopment}
          onChange={(event) =>
            setForm((current) => ({ ...current, returnToDevelopment: event.target.checked }))
          }
        />
        <span>Return task to Development</span>
      </label>
      {error ? <p className="formError">{error}</p> : null}
      {saved ? <p className="formSuccess">Feedback recorded.</p> : null}
      <button className="primaryButton" type="submit" disabled={saving}>
        {saving ? "Saving" : "Add Feedback"}
      </button>
    </form>
  );
}
