-- Align ACP Plane agent config projections with the Plane extension API contract.

CREATE TABLE "acp_role_projections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "plane_role_id" TEXT NOT NULL,
    "plane_workspace_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "plane_prompt_id" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'active',
    "projection_version" BIGINT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acp_role_projections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "acp_role_projections_plane_role_id_key"
  ON "acp_role_projections"("plane_role_id");

CREATE UNIQUE INDEX "acp_role_projections_plane_workspace_id_key_key"
  ON "acp_role_projections"("plane_workspace_id", "key");

CREATE INDEX "acp_role_projections_plane_workspace_id_status_idx"
  ON "acp_role_projections"("plane_workspace_id", "status");

CREATE TABLE "acp_repository_projections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "plane_repository_id" TEXT NOT NULL,
    "plane_workspace_id" TEXT NOT NULL,
    "plane_project_id" TEXT,
    "key" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'github',
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "default_branch" TEXT NOT NULL DEFAULT 'default',
    "local_path" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "required" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'active',
    "projection_version" BIGINT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acp_repository_projections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "acp_repository_projections_plane_repository_id_key"
  ON "acp_repository_projections"("plane_repository_id");

CREATE UNIQUE INDEX "acp_repository_projections_plane_workspace_id_key_key"
  ON "acp_repository_projections"("plane_workspace_id", "key");

CREATE INDEX "acp_repository_projections_plane_project_id_status_idx"
  ON "acp_repository_projections"("plane_project_id", "status");
