-- Add active/archive status to Plane project workspace projections.
-- Runtime snapshot joins already require active project projections.

ALTER TABLE "acp_project_projections"
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active';

CREATE INDEX "acp_project_projections_plane_workspace_id_status_idx"
  ON "acp_project_projections"("plane_workspace_id", "status");
