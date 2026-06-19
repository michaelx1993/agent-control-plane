import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const team = await prisma.team.upsert({
    where: { key: "TOK" },
    update: {
      name: "token-team",
      description: "Default team for Agent Control Plane MVP",
    },
    create: {
      externalProvider: "plane",
      externalTeamId: "token-team",
      key: "TOK",
      name: "token-team",
      description: "Default team for Agent Control Plane MVP",
    },
  });

  const project = await prisma.project.upsert({
    where: {
      teamId_slug: {
        teamId: team.id,
        slug: "token",
      },
    },
    update: {
      name: "token",
      status: "active",
    },
    create: {
      teamId: team.id,
      externalProjectId: "token",
      slug: "token",
      name: "token",
      description: "Merged token project routed by repository",
      status: "active",
    },
  });

  for (const slug of ["crs-src", "sub3", "traffic"]) {
    await prisma.repository.upsert({
      where: {
        projectId_slug: {
          projectId: project.id,
          slug,
        },
      },
      update: {
        status: "active",
      },
      create: {
        projectId: project.id,
        slug,
        gitUrl: `git@github.com:michaelx1993/${slug}.git`,
        defaultBranch: "main",
        localPath: `/Users/a/code/${slug}`,
        status: "active",
        description: `${slug} repository route`,
      },
    });
  }

  const roles = [
    {
      key: "intake",
      name: "Intake",
      activeStates: ["Todo"],
      nextStates: ["Development", "Blocked"],
      description: "Clarify task scope and route repository",
    },
    {
      key: "development",
      name: "Development",
      activeStates: ["Development"],
      nextStates: ["CodeReview", "Blocked"],
      description: "Implement task changes in the routed repository",
    },
    {
      key: "code_review",
      name: "Code Review",
      activeStates: ["CodeReview"],
      nextStates: ["Development", "HumanReview", "Blocked"],
      description: "Review code changes and request fixes when needed",
    },
    {
      key: "merge",
      name: "Merge",
      activeStates: ["InMerge"],
      nextStates: ["Merged", "Blocked"],
      description: "Merge approved changes",
    },
  ] as const;

  let developmentRoleId: string | undefined;

  for (const role of roles) {
    const saved = await prisma.role.upsert({
      where: { key: role.key },
      update: {
        name: role.name,
        activeStates: [...role.activeStates],
        nextStates: [...role.nextStates],
        description: role.description,
      },
      create: {
        key: role.key,
        name: role.name,
        activeStates: [...role.activeStates],
        nextStates: [...role.nextStates],
        description: role.description,
      },
    });

    if (role.key === "development") {
      developmentRoleId = saved.id;
    }
  }

  if (!developmentRoleId) {
    throw new Error("development role was not seeded");
  }

  await prisma.agentDefinition.upsert({
    where: {
      id: "00000000-0000-4000-8000-000000000001",
    },
    update: {
      roleId: developmentRoleId,
      runtime: "openhands",
      model: "gpt-5.5",
      reasoningEffort: "medium",
      status: "active",
    },
    create: {
      id: "00000000-0000-4000-8000-000000000001",
      name: "Default Development Agent",
      roleId: developmentRoleId,
      runtime: "openhands",
      model: "gpt-5.5",
      reasoningEffort: "medium",
      toolProfile: "default-development",
      maxTurns: 80,
      timeoutSeconds: 7200,
      status: "active",
    },
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
