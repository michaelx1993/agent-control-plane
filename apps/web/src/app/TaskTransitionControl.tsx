"use client";

import { FormEvent, useMemo, useState } from "react";

import type { PlaneState } from "@/lib/mock-data";
import { operatorFetch } from "./operator-api";

type TransitionOption = {
  state: PlaneState;
  label: string;
};

const mainChain: readonly PlaneState[] = [
  "Todo",
  "Development",
  "Code Review",
  "Human Review",
  "In Merge",
  "Merged",
  "Release Version",
  "Released",
  "Deployment",
  "Deployed",
  "Done",
] as const;

const reworkStates = new Set<PlaneState>([
  "Code Review",
  "Human Review",
  "Merged",
  "Released",
  "Deployed",
  "Blocked",
]);

const terminalStates = new Set<PlaneState>(["Done", "Canceled"]);

export function TaskTransitionControl({ taskId, state }: { taskId: string; state: PlaneState }) {
  const options = useMemo(() => transitionOptionsFor(state), [state]);
  const [nextState, setNextState] = useState<PlaneState>(options[0]?.state ?? "Done");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  if (options.length === 0) {
    return <span className="mutedText">terminal</span>;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const response = await operatorFetch(`/api/tasks/${encodeURIComponent(taskId)}/transition`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          nextState,
          reason: reason.trim() || `Operator transition: ${state} -> ${nextState}`,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? `Transition failed with ${response.status}`);
      }
      window.location.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setPending(false);
    }
  }

  return (
    <form className="transitionAction" onSubmit={submit}>
      <select
        aria-label={`Transition ${taskId}`}
        disabled={pending}
        value={nextState}
        onChange={(event) => setNextState(event.target.value as PlaneState)}
      >
        {options.map((option) => (
          <option key={option.state} value={option.state}>
            {option.label}
          </option>
        ))}
      </select>
      <input
        aria-label={`Transition reason for ${taskId}`}
        disabled={pending}
        placeholder="reason"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
      <button className="inlineIconButton" disabled={pending} type="submit">
        {pending ? "Moving" : "Move"}
      </button>
      {error ? <small>{error}</small> : null}
    </form>
  );
}

function transitionOptionsFor(state: PlaneState): TransitionOption[] {
  if (terminalStates.has(state)) {
    return [];
  }

  const options: TransitionOption[] = [];
  const currentIndex = mainChain.indexOf(state);
  const next = mainChain[currentIndex + 1];
  if (next) {
    options.push({ state: next, label: `Next: ${next}` });
  }

  if (reworkStates.has(state)) {
    options.push({ state: "Development", label: "Rework: Development" });
  }

  if (state !== "Blocked") {
    options.push({ state: "Blocked", label: "Gate: Blocked" });
  }

  options.push({ state: "Done", label: "Close: Done" });
  options.push({ state: "Canceled", label: "Close: Canceled" });

  return dedupeTransitionOptions(options, state);
}

function dedupeTransitionOptions(options: TransitionOption[], currentState: PlaneState) {
  const seen = new Set<PlaneState>([currentState]);
  return options.filter((option) => {
    if (seen.has(option.state)) {
      return false;
    }
    seen.add(option.state);
    return true;
  });
}
