-- Plane Agent Platform runtime foundation.
-- ACP owns projections and runtime execution records; Plane remains the editable source of truth.

CREATE TABLE "acp_config_projection_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "plane_workspace_id" TEXT NOT NULL,
    "plane_outbox_id" BIGINT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "projection_version" BIGINT NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'applied',
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acp_config_projection_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "acp_config_projection_events_plane_workspace_id_plane_outbox_id_key"
  ON "acp_config_projection_events"("plane_workspace_id", "plane_outbox_id");

CREATE INDEX "acp_config_projection_events_entity_idx"
  ON "acp_config_projection_events"("entity_type", "entity_id", "projection_version");

CREATE TABLE "acp_project_projections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "plane_project_workspace_id" TEXT NOT NULL,
    "plane_workspace_id" TEXT NOT NULL,
    "plane_project_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "default_worker_id" TEXT,
    "meta_git_policy" JSONB NOT NULL DEFAULT '{}',
    "projection_version" BIGINT NOT NULL,
    "source_updated_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acp_project_projections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "acp_project_projections_plane_project_workspace_id_key"
  ON "acp_project_projections"("plane_project_workspace_id");

CREATE UNIQUE INDEX "acp_project_projections_plane_workspace_id_slug_key"
  ON "acp_project_projections"("plane_workspace_id", "slug");

CREATE TABLE "acp_user_agent_projections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "plane_user_agent_id" TEXT NOT NULL,
    "owner_user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "default_model" TEXT NOT NULL,
    "tool_profile" JSONB NOT NULL DEFAULT '{}',
    "config_snapshot" JSONB NOT NULL DEFAULT '{}',
    "projection_version" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acp_user_agent_projections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "acp_user_agent_projections_plane_user_agent_id_key"
  ON "acp_user_agent_projections"("plane_user_agent_id");

CREATE INDEX "acp_user_agent_projections_owner_user_id_status_idx"
  ON "acp_user_agent_projections"("owner_user_id", "status");

CREATE TABLE "acp_prompt_projections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "plane_prompt_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "latest_version_id" TEXT,
    "projection_version" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acp_prompt_projections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "acp_prompt_projections_plane_prompt_id_key"
  ON "acp_prompt_projections"("plane_prompt_id");

CREATE INDEX "acp_prompt_projections_workspace_id_scope_status_idx"
  ON "acp_prompt_projections"("workspace_id", "scope", "status");

CREATE TABLE "acp_prompt_version_projections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "plane_prompt_version_id" TEXT NOT NULL,
    "plane_prompt_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "variables" JSONB NOT NULL DEFAULT '{}',
    "content_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acp_prompt_version_projections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "acp_prompt_version_projections_plane_prompt_version_id_key"
  ON "acp_prompt_version_projections"("plane_prompt_version_id");

CREATE UNIQUE INDEX "acp_prompt_version_projections_plane_prompt_id_version_key"
  ON "acp_prompt_version_projections"("plane_prompt_id", "version");

CREATE INDEX "acp_prompt_version_projections_plane_prompt_id_content_hash_idx"
  ON "acp_prompt_version_projections"("plane_prompt_id", "content_hash");

CREATE TABLE "acp_prompt_binding_projections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "plane_binding_id" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "plane_prompt_id" TEXT NOT NULL,
    "version_policy" TEXT NOT NULL,
    "pinned_version_id" TEXT,
    "scope" TEXT NOT NULL,
    "order_index" INTEGER NOT NULL DEFAULT 0,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'active',
    "projection_version" BIGINT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acp_prompt_binding_projections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "acp_prompt_binding_projections_plane_binding_id_key"
  ON "acp_prompt_binding_projections"("plane_binding_id");

CREATE INDEX "acp_prompt_binding_projections_target_idx"
  ON "acp_prompt_binding_projections"("target_type", "target_id", "scope", "status", "order_index");

ALTER TABLE "acp_prompt_binding_projections"
  ADD CONSTRAINT "acp_prompt_binding_projections_version_policy_check"
  CHECK ("version_policy" IN ('latest', 'pinned'));

ALTER TABLE "acp_prompt_binding_projections"
  ADD CONSTRAINT "acp_prompt_binding_projections_pinned_version_check"
  CHECK ("version_policy" <> 'pinned' OR "pinned_version_id" IS NOT NULL);

CREATE TABLE "acp_worker_card_projections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "plane_worker_card_id" TEXT NOT NULL,
    "plane_workspace_id" TEXT NOT NULL,
    "worker_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hostname" TEXT,
    "os" TEXT,
    "labels" JSONB NOT NULL DEFAULT '[]',
    "workspace_root" TEXT,
    "last_seen_at" TIMESTAMPTZ(6),
    "status" TEXT NOT NULL DEFAULT 'offline',
    "projection_version" BIGINT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acp_worker_card_projections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "acp_worker_card_projections_plane_worker_card_id_key"
  ON "acp_worker_card_projections"("plane_worker_card_id");

CREATE UNIQUE INDEX "acp_worker_card_projections_plane_workspace_id_worker_id_key"
  ON "acp_worker_card_projections"("plane_workspace_id", "worker_id");

CREATE INDEX "acp_worker_card_projections_status_idx"
  ON "acp_worker_card_projections"("status", "last_seen_at");

CREATE TABLE "acp_run_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "run_id" UUID NOT NULL,
    "snapshot_hash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acp_run_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "acp_run_snapshots_run_id_key"
  ON "acp_run_snapshots"("run_id");

CREATE INDEX "acp_run_snapshots_snapshot_hash_idx"
  ON "acp_run_snapshots"("snapshot_hash");

ALTER TABLE "acp_run_snapshots"
  ADD CONSTRAINT "acp_run_snapshots_run_id_fkey"
  FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "acp_run_pipelines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "run_id" UUID NOT NULL,
    "plane_playbook_version_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acp_run_pipelines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "acp_run_pipelines_run_id_key"
  ON "acp_run_pipelines"("run_id");

ALTER TABLE "acp_run_pipelines"
  ADD CONSTRAINT "acp_run_pipelines_run_id_fkey"
  FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "acp_run_pipeline_nodes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "run_pipeline_id" UUID NOT NULL,
    "node_key" TEXT NOT NULL,
    "node_type" TEXT NOT NULL,
    "role_key" TEXT,
    "assigned_agent_id" TEXT,
    "gate_mode" TEXT NOT NULL DEFAULT 'manual',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "order_index" INTEGER NOT NULL DEFAULT 0,
    "input_snapshot" JSONB NOT NULL DEFAULT '{}',
    "output_summary" TEXT,
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acp_run_pipeline_nodes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "acp_run_pipeline_nodes_run_pipeline_id_node_key_key"
  ON "acp_run_pipeline_nodes"("run_pipeline_id", "node_key");

CREATE INDEX "acp_run_pipeline_nodes_status_idx"
  ON "acp_run_pipeline_nodes"("status", "gate_mode", "order_index");

ALTER TABLE "acp_run_pipeline_nodes"
  ADD CONSTRAINT "acp_run_pipeline_nodes_run_pipeline_id_fkey"
  FOREIGN KEY ("run_pipeline_id") REFERENCES "acp_run_pipelines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "acp_run_pipeline_nodes"
  ADD CONSTRAINT "acp_run_pipeline_nodes_gate_mode_check"
  CHECK ("gate_mode" IN ('manual', 'auto', 'conditional'));

CREATE TABLE "acp_run_pipeline_transitions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "run_pipeline_id" UUID NOT NULL,
    "from_node_key" TEXT NOT NULL,
    "to_node_key" TEXT NOT NULL,
    "condition" JSONB NOT NULL DEFAULT '{}',
    "gate_mode" TEXT NOT NULL DEFAULT 'manual',
    "order_index" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "acp_run_pipeline_transitions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "acp_run_pipeline_transitions_unique_route"
  ON "acp_run_pipeline_transitions"("run_pipeline_id", "from_node_key", "to_node_key", "order_index");

ALTER TABLE "acp_run_pipeline_transitions"
  ADD CONSTRAINT "acp_run_pipeline_transitions_run_pipeline_id_fkey"
  FOREIGN KEY ("run_pipeline_id") REFERENCES "acp_run_pipelines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "acp_run_pipeline_transitions"
  ADD CONSTRAINT "acp_run_pipeline_transitions_gate_mode_check"
  CHECK ("gate_mode" IN ('manual', 'auto', 'conditional'));

CREATE TABLE "acp_node_executions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "run_pipeline_node_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "worker_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "result_summary" TEXT,
    "failure_reason" TEXT,
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acp_node_executions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "acp_node_executions_run_id_created_at_idx"
  ON "acp_node_executions"("run_id", "created_at");

CREATE INDEX "acp_node_executions_status_idx"
  ON "acp_node_executions"("status", "worker_id");

ALTER TABLE "acp_node_executions"
  ADD CONSTRAINT "acp_node_executions_run_pipeline_node_id_fkey"
  FOREIGN KEY ("run_pipeline_node_id") REFERENCES "acp_run_pipeline_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "acp_node_executions"
  ADD CONSTRAINT "acp_node_executions_run_id_fkey"
  FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "acp_prerequisite_checks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "run_pipeline_node_id" UUID NOT NULL,
    "check_key" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acp_prerequisite_checks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "acp_prerequisite_checks_node_status_idx"
  ON "acp_prerequisite_checks"("run_pipeline_node_id", "status");

ALTER TABLE "acp_prerequisite_checks"
  ADD CONSTRAINT "acp_prerequisite_checks_run_pipeline_node_id_fkey"
  FOREIGN KEY ("run_pipeline_node_id") REFERENCES "acp_run_pipeline_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "acp_scm_change_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "run_id" UUID NOT NULL,
    "run_pipeline_node_id" UUID,
    "provider" TEXT NOT NULL,
    "repository_full_name" TEXT NOT NULL,
    "change_request_id" TEXT NOT NULL,
    "url" TEXT,
    "source_branch" TEXT NOT NULL,
    "target_branch" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "review_status" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acp_scm_change_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "acp_scm_change_requests_provider_repository_full_name_change_request_id_key"
  ON "acp_scm_change_requests"("provider", "repository_full_name", "change_request_id");

CREATE INDEX "acp_scm_change_requests_run_id_idx"
  ON "acp_scm_change_requests"("run_id", "created_at");

ALTER TABLE "acp_scm_change_requests"
  ADD CONSTRAINT "acp_scm_change_requests_run_id_fkey"
  FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "acp_scm_change_requests"
  ADD CONSTRAINT "acp_scm_change_requests_run_pipeline_node_id_fkey"
  FOREIGN KEY ("run_pipeline_node_id") REFERENCES "acp_run_pipeline_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "acp_release_artifacts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "run_id" UUID NOT NULL,
    "run_pipeline_node_id" UUID,
    "artifact_type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT,
    "uri" TEXT NOT NULL,
    "digest" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acp_release_artifacts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "acp_release_artifacts_run_id_idx"
  ON "acp_release_artifacts"("run_id", "created_at");

CREATE INDEX "acp_release_artifacts_artifact_type_name_idx"
  ON "acp_release_artifacts"("artifact_type", "name", "version");

ALTER TABLE "acp_release_artifacts"
  ADD CONSTRAINT "acp_release_artifacts_run_id_fkey"
  FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "acp_release_artifacts"
  ADD CONSTRAINT "acp_release_artifacts_run_pipeline_node_id_fkey"
  FOREIGN KEY ("run_pipeline_node_id") REFERENCES "acp_run_pipeline_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "acp_deployment_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "run_id" UUID NOT NULL,
    "run_pipeline_node_id" UUID,
    "environment" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "artifact_uri" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acp_deployment_records_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "acp_deployment_records_run_id_idx"
  ON "acp_deployment_records"("run_id", "created_at");

CREATE INDEX "acp_deployment_records_environment_status_idx"
  ON "acp_deployment_records"("environment", "status");

ALTER TABLE "acp_deployment_records"
  ADD CONSTRAINT "acp_deployment_records_run_id_fkey"
  FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "acp_deployment_records"
  ADD CONSTRAINT "acp_deployment_records_run_pipeline_node_id_fkey"
  FOREIGN KEY ("run_pipeline_node_id") REFERENCES "acp_run_pipeline_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "acp_project_meta_repos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "plane_project_workspace_id" TEXT NOT NULL,
    "local_path" TEXT NOT NULL,
    "remote_url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "last_sync_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acp_project_meta_repos_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "acp_project_meta_repos_plane_project_workspace_id_key"
  ON "acp_project_meta_repos"("plane_project_workspace_id");

CREATE TABLE "acp_project_memory_commits" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "project_meta_repo_id" UUID NOT NULL,
    "run_id" UUID,
    "file_path" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "commit_sha" TEXT,
    "summary" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acp_project_memory_commits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "acp_project_memory_commits_repo_file_created_at_idx"
  ON "acp_project_memory_commits"("project_meta_repo_id", "file_path", "created_at");

ALTER TABLE "acp_project_memory_commits"
  ADD CONSTRAINT "acp_project_memory_commits_project_meta_repo_id_fkey"
  FOREIGN KEY ("project_meta_repo_id") REFERENCES "acp_project_meta_repos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "acp_project_memory_commits"
  ADD CONSTRAINT "acp_project_memory_commits_run_id_fkey"
  FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
