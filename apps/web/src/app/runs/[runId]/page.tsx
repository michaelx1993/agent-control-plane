import Link from "next/link";
import { notFound } from "next/navigation";

import { getRunDetail } from "@/lib/control-plane-service";
import { type HealthSignal, type RunStatus } from "@/lib/mock-data";
import { RunFeedbackForm } from "./RunFeedbackForm";

const statusClass: Record<RunStatus | HealthSignal["state"], string> = {
  attention: "statusAttention",
  blocked: "statusAttention",
  claimed: "statusInfo",
  completed: "statusGood",
  degraded: "statusBad",
  failed: "statusBad",
  nominal: "statusGood",
  queued: "statusInfo",
  running: "statusRun",
};

type PageProps = {
  params: Promise<{
    runId: string;
  }>;
};

export default async function RunDetailPage({ params }: PageProps) {
  const { runId } = await params;
  const run = await getRunDetail(runId);

  if (!run) {
    notFound();
  }

  return (
    <main className="shell">
      <header className="detailTopbar">
        <div>
          <Link className="backLink" href="/">
            Runtime Operations Console
          </Link>
          <p className="eyebrow">Run Detail</p>
          <h1>{run.id}</h1>
        </div>
        <span className={`pill ${statusClass[run.status]}`}>{run.status}</span>
      </header>

      <section className="detailGrid" aria-label="Run detail">
        <section className="panel panelWide">
          <div className="panelHead">
            <h2>{run.taskTitle}</h2>
            <span>
              {run.taskId} · {run.project} · {run.repo}
            </span>
          </div>
          <div className="detailBody">
            <dl className="kvGrid">
              <KeyValue label="Role" value={run.role} />
              <KeyValue label="Agent" value={run.agent} />
              <KeyValue label="Model" value={run.model} />
              <KeyValue label="Reasoning" value={run.reasoningEffort} />
              <KeyValue label="Started" value={run.startedAt} />
              <KeyValue label="Heartbeat" value={run.heartbeat} />
              <KeyValue label="Next State" value={run.nextState || "none"} />
              <KeyValue label="Prompt" value={run.promptReleaseId} />
            </dl>

            <div className="linkGrid" aria-label="External run links">
              <ExternalLink label="Plane Task" href={run.planeTaskUrl} />
              <ExternalLink label="OpenHands Conversation" href={run.openHandsUrl} />
              <ExternalLink label="Langfuse Trace" href={run.langfuseUrl} />
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panelHead">
            <h2>Observability</h2>
            <span>refs</span>
          </div>
          <div className="detailBody">
            <dl className="kvStack">
              <KeyValue label="Conversation" value={run.conversationId || "none"} />
              <KeyValue label="Event Cursor" value={run.eventCursor || "none"} />
              <KeyValue label="Trace" value={run.traceId || "none"} />
              <KeyValue label="Input Tokens" value={String(run.tokenInput)} />
              <KeyValue label="Output Tokens" value={String(run.tokenOutput)} />
              <KeyValue label="Cost USD" value={run.costUsd} />
            </dl>
          </div>
        </section>

        <section className="panel">
          <div className="panelHead">
            <h2>Result</h2>
            <span>summary</span>
          </div>
          <div className="detailBody proseBlock">
            <p>{run.resultSummary || "No result summary recorded."}</p>
            {run.failureReason ? <p className="errorText">{run.failureReason}</p> : null}
          </div>
        </section>

        <section className="panel panelWide">
          <div className="panelHead">
            <h2>Event Timeline</h2>
            <span>{run.events.length} events</span>
          </div>
          <div className="timeline">
            {run.events.map((event) => (
              <article className="timelineItem" key={event.id}>
                <span className="timelineType">{event.type}</span>
                <div>
                  <strong>{event.message || event.type}</strong>
                  <small>{event.createdAt}</small>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panelHead">
            <h2>Feedback</h2>
            <span>{run.feedback.length} open items</span>
          </div>
          <div className="feedbackStack">
            {run.feedback.length === 0 ? (
              <p className="emptyText">No feedback attached to this run.</p>
            ) : (
              run.feedback.map((item) => (
                <article className="feedbackItem" key={item.id}>
                  <div>
                    <strong>
                      {item.source} · {item.severity}
                    </strong>
                    <small>{item.createdAt}</small>
                  </div>
                  <p>{item.body}</p>
                  {item.externalUrl ? <a href={item.externalUrl}>Source</a> : null}
                </article>
              ))
            )}
            <RunFeedbackForm runId={run.id} />
          </div>
        </section>

        <section className="panel">
          <div className="panelHead">
            <h2>Prompt Snapshot</h2>
            <span>{run.promptHash}</span>
          </div>
          <pre className="promptPreview">{run.promptPreview || "No prompt snapshot recorded."}</pre>
        </section>
      </section>
    </main>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function ExternalLink({ label, href }: { label: string; href: string }) {
  if (!href) {
    return (
      <span className="externalLinkDisabled">
        <strong>{label}</strong>
        <small>not recorded</small>
      </span>
    );
  }

  return (
    <a className="externalLink" href={href}>
      <strong>{label}</strong>
      <small>{href}</small>
    </a>
  );
}
