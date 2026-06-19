"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { operatorFetch } from "../../operator-api";

export function ResolveFeedbackButton({ feedbackId }: { feedbackId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function resolveFeedback() {
    setPending(true);
    setError("");
    try {
      const response = await operatorFetch(
        `/api/feedback/${encodeURIComponent(feedbackId)}/resolve`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            reason: "Marked resolved from Run Detail",
          }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? `Resolve failed with ${response.status}`);
      }
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setPending(false);
    }
  }

  return (
    <span className="feedbackAction">
      <button
        className="inlineIconButton"
        disabled={pending}
        type="button"
        onClick={resolveFeedback}
      >
        {pending ? "Resolving" : "Resolve"}
      </button>
      {error ? <small>{error}</small> : null}
    </span>
  );
}
