import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";

const prisma = new PrismaClient();

async function main() {
  const project = await prisma.project.findFirstOrThrow({
    where: {
      slug: "token",
      status: "active",
    },
    include: {
      repositories: true,
    },
  });
  const repository = project.repositories.find((repo) => repo.slug === "crs-src");
  if (!repository) {
    throw new Error("Repository crs-src not found. Run the base seed first.");
  }

  const role = await prisma.role.findUniqueOrThrow({
    where: {
      key: "development",
    },
  });
  const agentDefinition = await prisma.agentDefinition.findFirstOrThrow({
    where: {
      roleId: role.id,
      status: "active",
    },
    orderBy: {
      updatedAt: "desc",
    },
  });

  const task = await prisma.task.upsert({
    where: {
      projectId_externalTaskId: {
        projectId: project.id,
        externalTaskId: "demo-plane-task-1",
      },
    },
    update: {
      repositoryId: repository.id,
      identifier: "DEMO-1",
      title: "Demo: repo-aware agent run",
      state: "CodeReview",
      priority: 1,
      labels: ["repo:crs-src", "demo"],
      assignee: "agent-control-plane",
      url: "https://plane.local/demo/DEMO-1",
      lastSyncedAt: new Date(),
    },
    create: {
      projectId: project.id,
      repositoryId: repository.id,
      externalTaskId: "demo-plane-task-1",
      identifier: "DEMO-1",
      title: "Demo: repo-aware agent run",
      state: "CodeReview",
      priority: 1,
      labels: ["repo:crs-src", "demo"],
      assignee: "agent-control-plane",
      url: "https://plane.local/demo/DEMO-1",
      lastSyncedAt: new Date(),
    },
  });

  const prompt = [
    "global prompt",
    "team prompt: token-team backend AI engineer",
    "repo prompt: crs-src",
    "role prompt: Development",
    "task context: Demo: repo-aware agent run",
    "runtime constraints: write concise Chinese progress and persist observability refs.",
  ].join("\n\n");
  const promptRelease = await prisma.promptRelease.create({
    data: {
      taskId: task.id,
      repositoryId: repository.id,
      roleId: role.id,
      agentDefinitionId: agentDefinition.id,
      contentHash: createHash("sha256").update(prompt).digest("hex"),
      renderedContent: prompt,
      langfusePromptId: "demo-agent-control-plane",
      langfusePromptVersion: "demo-v1",
    },
  });

  const run = await prisma.run.upsert({
    where: {
      id: "00000000-0000-4000-9000-000000000001",
    },
    update: {
      taskId: task.id,
      repositoryId: repository.id,
      roleId: role.id,
      agentDefinitionId: agentDefinition.id,
      promptReleaseId: promptRelease.id,
      status: "succeeded",
      leaseOwner: null,
      leaseExpiresAt: null,
      heartbeatAt: new Date(),
      startedAt: new Date(Date.now() - 3 * 60 * 1000),
      finishedAt: new Date(),
      resultSummary: "Demo run completed and recorded OpenHands/Langfuse refs.",
      failureReason: null,
      nextState: "CodeReview",
      tokenInput: 18612n,
      tokenOutput: 5319n,
      tokenTotal: 23931n,
      costUsd: "0.870000",
    },
    create: {
      id: "00000000-0000-4000-9000-000000000001",
      taskId: task.id,
      repositoryId: repository.id,
      roleId: role.id,
      agentDefinitionId: agentDefinition.id,
      promptReleaseId: promptRelease.id,
      status: "succeeded",
      heartbeatAt: new Date(),
      startedAt: new Date(Date.now() - 3 * 60 * 1000),
      finishedAt: new Date(),
      resultSummary: "Demo run completed and recorded OpenHands/Langfuse refs.",
      nextState: "CodeReview",
      tokenInput: 18612n,
      tokenOutput: 5319n,
      tokenTotal: 23931n,
      costUsd: "0.870000",
    },
  });

  await prisma.traceRef.deleteMany({
    where: {
      runId: run.id,
    },
  });
  await prisma.feedbackItem.deleteMany({
    where: {
      runId: run.id,
    },
  });
  await prisma.runEvent.deleteMany({
    where: {
      runId: run.id,
    },
  });

  await prisma.conversationRef.upsert({
    where: {
      runId: run.id,
    },
    update: {
      conversationId: "demo-conversation-1",
      eventCursor: "demo-event-128",
      uiUrl: "https://openhands.local/conversations/demo-conversation-1",
    },
    create: {
      runId: run.id,
      conversationId: "demo-conversation-1",
      eventCursor: "demo-event-128",
      uiUrl: "https://openhands.local/conversations/demo-conversation-1",
    },
  });

  await prisma.traceRef.create({
    data: {
      runId: run.id,
      promptReleaseId: promptRelease.id,
      traceId: "demo-trace-1",
      model: agentDefinition.model,
      inputTokens: 18612n,
      outputTokens: 5319n,
      costUsd: "0.870000",
      latencyMs: 183000,
      uiUrl: "https://langfuse.local/project/acp/traces/demo-trace-1",
    },
  });

  await prisma.feedbackItem.create({
    data: {
      taskId: task.id,
      runId: run.id,
      source: "agent",
      severity: "info",
      body: "Demo feedback item: next reviewer should inspect the conversation and trace links.",
      externalUrl: "https://openhands.local/conversations/demo-conversation-1",
    },
  });

  await prisma.runEvent.createMany({
    data: [
      {
        runId: run.id,
        eventType: "claimed",
        message: "Demo Development Agent claimed the task.",
      },
      {
        runId: run.id,
        eventType: "heartbeat",
        message: "OpenHands conversation started and prompt release injected.",
      },
      {
        runId: run.id,
        eventType: "state_sync",
        message: "Recorded OpenHands conversation and Langfuse trace refs.",
      },
      {
        runId: run.id,
        eventType: "completed",
        message: "Demo run completed.",
      },
    ],
  });
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
