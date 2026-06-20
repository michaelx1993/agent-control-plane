-- CreateTable
CREATE TABLE "teams" (
    "id" UUID NOT NULL,
    "external_provider" TEXT NOT NULL,
    "external_team_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "external_project_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repositories" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "git_url" TEXT NOT NULL,
    "default_branch" TEXT NOT NULL DEFAULT 'main',
    "local_path" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "repositories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "repository_id" UUID,
    "external_task_id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "priority" INTEGER,
    "labels" JSONB NOT NULL DEFAULT '[]',
    "assignee" TEXT,
    "url" TEXT,
    "last_synced_at" TIMESTAMPTZ(6),
    "sync_cursor" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active_states" TEXT[],
    "next_states" TEXT[],
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_definitions" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "role_id" UUID NOT NULL,
    "runtime" TEXT NOT NULL DEFAULT 'openhands',
    "model" TEXT NOT NULL,
    "reasoning_effort" TEXT NOT NULL DEFAULT 'medium',
    "tool_profile" TEXT NOT NULL,
    "max_turns" INTEGER NOT NULL DEFAULT 80,
    "timeout_seconds" INTEGER NOT NULL DEFAULT 7200,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "agent_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_components" (
    "id" UUID NOT NULL,
    "scope_type" TEXT NOT NULL,
    "scope_id" UUID,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "content" TEXT NOT NULL,
    "changelog" TEXT,
    "author" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "prompt_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_bindings" (
    "id" UUID NOT NULL,
    "scope_type" TEXT NOT NULL,
    "scope_id" UUID NOT NULL,
    "prompt_component_id" UUID NOT NULL,
    "order_index" INTEGER NOT NULL DEFAULT 0,
    "environment" TEXT NOT NULL DEFAULT 'dev',
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "prompt_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_releases" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "repository_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "agent_definition_id" UUID NOT NULL,
    "langfuse_prompt_id" TEXT,
    "langfuse_prompt_version" TEXT,
    "content_hash" TEXT NOT NULL,
    "rendered_content" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prompt_releases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_release_components" (
    "id" UUID NOT NULL,
    "prompt_release_id" UUID NOT NULL,
    "prompt_component_id" UUID NOT NULL,
    "order_index" INTEGER NOT NULL,
    "content_hash" TEXT NOT NULL,

    CONSTRAINT "prompt_release_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "runs" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "repository_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "agent_definition_id" UUID NOT NULL,
    "prompt_release_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "lease_owner" TEXT,
    "lease_expires_at" TIMESTAMPTZ(6),
    "heartbeat_at" TIMESTAMPTZ(6),
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "result_summary" TEXT,
    "failure_reason" TEXT,
    "next_state" TEXT,
    "token_input" BIGINT,
    "token_output" BIGINT,
    "token_total" BIGINT,
    "cost_usd" DECIMAL(12,6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspaces" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "repository_id" UUID NOT NULL,
    "strategy" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "base_ref" TEXT,
    "head_ref" TEXT,
    "status" TEXT NOT NULL DEFAULT 'preparing',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cleaned_at" TIMESTAMPTZ(6),

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_refs" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'openhands',
    "conversation_id" TEXT NOT NULL,
    "event_log_uri" TEXT,
    "event_cursor" TEXT,
    "ui_url" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "conversation_refs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trace_refs" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'langfuse',
    "trace_id" TEXT NOT NULL,
    "generation_id" TEXT,
    "model" TEXT,
    "prompt_release_id" UUID,
    "input_tokens" BIGINT,
    "output_tokens" BIGINT,
    "cost_usd" DECIMAL(12,6),
    "latency_ms" INTEGER,
    "ui_url" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trace_refs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "run_events" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "payload" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "run_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback_items" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "run_id" UUID,
    "source" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "body" TEXT NOT NULL,
    "external_url" TEXT,
    "resolved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "external_provider" TEXT NOT NULL,
    "external_user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID,
    "team_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "message" TEXT NOT NULL,
    "payload" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "teams_key_key" ON "teams"("key");

-- CreateIndex
CREATE UNIQUE INDEX "teams_external_provider_external_team_id_key" ON "teams"("external_provider", "external_team_id");

-- CreateIndex
CREATE UNIQUE INDEX "projects_team_id_slug_key" ON "projects"("team_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "projects_team_id_external_project_id_key" ON "projects"("team_id", "external_project_id");

-- CreateIndex
CREATE UNIQUE INDEX "repositories_git_url_key" ON "repositories"("git_url");

-- CreateIndex
CREATE UNIQUE INDEX "repositories_project_id_slug_key" ON "repositories"("project_id", "slug");

-- CreateIndex
CREATE INDEX "tasks_state_updated_at_idx" ON "tasks"("state", "updated_at");

-- CreateIndex
CREATE INDEX "tasks_repository_id_state_idx" ON "tasks"("repository_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_project_id_external_task_id_key" ON "tasks"("project_id", "external_task_id");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_project_id_identifier_key" ON "tasks"("project_id", "identifier");

-- CreateIndex
CREATE UNIQUE INDEX "roles_key_key" ON "roles"("key");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_components_scope_type_scope_id_name_version_key" ON "prompt_components"("scope_type", "scope_id", "name", "version");

-- CreateIndex
CREATE INDEX "prompt_bindings_scope_type_scope_id_status_idx" ON "prompt_bindings"("scope_type", "scope_id", "status");

-- CreateIndex
CREATE INDEX "prompt_releases_task_id_created_at_idx" ON "prompt_releases"("task_id", "created_at");

-- CreateIndex
CREATE INDEX "prompt_releases_content_hash_idx" ON "prompt_releases"("content_hash");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_release_components_prompt_release_id_order_index_key" ON "prompt_release_components"("prompt_release_id", "order_index");

-- CreateIndex
CREATE INDEX "runs_task_id_created_at_idx" ON "runs"("task_id", "created_at");

-- CreateIndex
CREATE INDEX "runs_status_lease_expires_at_idx" ON "runs"("status", "lease_expires_at");

-- CreateIndex
CREATE INDEX "runs_repository_id_status_idx" ON "runs"("repository_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_run_id_key" ON "workspaces"("run_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_refs_run_id_key" ON "conversation_refs"("run_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_refs_provider_conversation_id_key" ON "conversation_refs"("provider", "conversation_id");

-- CreateIndex
CREATE INDEX "trace_refs_run_id_idx" ON "trace_refs"("run_id");

-- CreateIndex
CREATE INDEX "trace_refs_trace_id_idx" ON "trace_refs"("trace_id");

-- CreateIndex
CREATE INDEX "trace_refs_prompt_release_id_idx" ON "trace_refs"("prompt_release_id");

-- CreateIndex
CREATE INDEX "run_events_run_id_created_at_idx" ON "run_events"("run_id", "created_at");

-- CreateIndex
CREATE INDEX "run_events_event_type_created_at_idx" ON "run_events"("event_type", "created_at");

-- CreateIndex
CREATE INDEX "feedback_items_task_id_resolved_at_idx" ON "feedback_items"("task_id", "resolved_at");

-- CreateIndex
CREATE INDEX "feedback_items_source_created_at_idx" ON "feedback_items"("source", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "users_external_provider_external_user_id_key" ON "users"("external_provider", "external_user_id");

-- CreateIndex
CREATE INDEX "audit_events_entity_type_entity_id_created_at_idx" ON "audit_events"("entity_type", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_action_created_at_idx" ON "audit_events"("action", "created_at");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_definitions" ADD CONSTRAINT "agent_definitions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_bindings" ADD CONSTRAINT "prompt_bindings_prompt_component_id_fkey" FOREIGN KEY ("prompt_component_id") REFERENCES "prompt_components"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_releases" ADD CONSTRAINT "prompt_releases_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_releases" ADD CONSTRAINT "prompt_releases_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_releases" ADD CONSTRAINT "prompt_releases_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_releases" ADD CONSTRAINT "prompt_releases_agent_definition_id_fkey" FOREIGN KEY ("agent_definition_id") REFERENCES "agent_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_release_components" ADD CONSTRAINT "prompt_release_components_prompt_release_id_fkey" FOREIGN KEY ("prompt_release_id") REFERENCES "prompt_releases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_release_components" ADD CONSTRAINT "prompt_release_components_prompt_component_id_fkey" FOREIGN KEY ("prompt_component_id") REFERENCES "prompt_components"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runs" ADD CONSTRAINT "runs_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runs" ADD CONSTRAINT "runs_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runs" ADD CONSTRAINT "runs_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runs" ADD CONSTRAINT "runs_agent_definition_id_fkey" FOREIGN KEY ("agent_definition_id") REFERENCES "agent_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runs" ADD CONSTRAINT "runs_prompt_release_id_fkey" FOREIGN KEY ("prompt_release_id") REFERENCES "prompt_releases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_refs" ADD CONSTRAINT "conversation_refs_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trace_refs" ADD CONSTRAINT "trace_refs_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trace_refs" ADD CONSTRAINT "trace_refs_prompt_release_id_fkey" FOREIGN KEY ("prompt_release_id") REFERENCES "prompt_releases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_items" ADD CONSTRAINT "feedback_items_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_items" ADD CONSTRAINT "feedback_items_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

