create table if not exists acp_user_secret_key_projections (
  id uuid primary key default gen_random_uuid(),
  plane_secret_key_id text not null unique,
  plane_workspace_id text not null,
  owner_user_id text not null default '',
  key text not null,
  description text not null default '',
  provider text not null default 'env',
  provider_ref text not null default '',
  status text not null default 'active',
  projection_version bigint not null,
  updated_at timestamptz not null default current_timestamp
);

create index if not exists acp_user_secret_key_projection_workspace_owner_status_idx
  on acp_user_secret_key_projections (plane_workspace_id, owner_user_id, status);

create index if not exists acp_user_secret_key_projection_key_status_idx
  on acp_user_secret_key_projections (key, status);

create unique index if not exists acp_user_secret_key_projection_active_key_uidx
  on acp_user_secret_key_projections (plane_workspace_id, owner_user_id, key)
  where status = 'active';
