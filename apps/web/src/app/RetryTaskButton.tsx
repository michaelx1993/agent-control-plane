"use client";

import { useState } from "react";

export function RetryTaskButton({ taskId }: { taskId: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function releaseRetry() {
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/retry`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          reason: "Released from Task Queue",
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? `Retry release failed with ${response.status}`);
      }
      window.location.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setPending(false);
    }
  }

  return (
    <span className="retryAction">
      <button className="inlineIconButton" disabled={pending} onClick={releaseRetry} type="button">
        {pending ? "Releasing" : "Release retry"}
      </button>
      {error ? <small>{error}</small> : null}
    </span>
  );
}
