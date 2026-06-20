insert into teams (
  id,
  external_provider,
  external_team_id,
  key,
  name,
  description,
  created_at,
  updated_at
)
values (
  '00000000-0000-4000-8000-000000000001',
  'plane',
  'token-team',
  'TOK',
  'token-team',
  'Token team for crs-src, sub3, and traffic repositories.',
  now(),
  now()
)
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  updated_at = now();

insert into users (
  id,
  external_provider,
  external_user_id,
  name,
  email,
  created_at,
  updated_at
)
values (
  '00000000-0000-4000-8000-000000000901',
  'local',
  'local-operator',
  'local-operator',
  null,
  now(),
  now()
)
on conflict (external_provider, external_user_id) do update set
  name = excluded.name,
  updated_at = now();

insert into projects (
  id,
  team_id,
  external_project_id,
  slug,
  name,
  description,
  status,
  created_at,
  updated_at
)
values (
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000001',
  'token',
  'token',
  'token',
  'Unified token project. Tasks must declare the target repo explicitly.',
  'active',
  now(),
  now()
)
on conflict (team_id, slug) do update set
  description = excluded.description,
  status = excluded.status,
  updated_at = now();

insert into repositories (
  id,
  project_id,
  slug,
  git_url,
  default_branch,
  local_path,
  status,
  description,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000101',
    'crs-src',
    'git@github.com:michaelx1993/crs-src.git',
    'main',
    null,
    'active',
    'CRS backend/source repository.',
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-000000000202',
    '00000000-0000-4000-8000-000000000101',
    'sub3',
    'git@github.com:michaelx1993/sub3.git',
    'main',
    null,
    'active',
    'Sub2/sub3 repository.',
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-000000000203',
    '00000000-0000-4000-8000-000000000101',
    'traffic',
    'git@github.com:michaelx1993/traffic.git',
    'main',
    null,
    'active',
    'Traffic repository.',
    now(),
    now()
  )
on conflict (git_url) do update set
  slug = excluded.slug,
  status = excluded.status,
  description = excluded.description,
  updated_at = now();

insert into roles (
  id,
  key,
  name,
  active_states,
  next_states,
  description,
  status,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-4000-8000-000000000301',
    'intake',
    'Intake Agent',
    array['Todo'],
    array['Development', 'Blocked', 'Done', 'Canceled'],
    'Clarifies task context and prepares workpad before implementation.',
    'active',
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-000000000302',
    'development',
    'Development Agent',
    array['Development'],
    array['Code Review', 'Blocked', 'Done', 'Canceled'],
    'Implements or reworks the task.',
    'active',
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-000000000303',
    'code_review',
    'Code Review Agent',
    array['Code Review'],
    array['Human Review', 'Development', 'Blocked', 'Done', 'Canceled'],
    'Performs machine review and validation before human review.',
    'active',
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-000000000304',
    'merge',
    'Merge Agent',
    array['In Merge'],
    array['Merged', 'Development', 'Blocked', 'Done', 'Canceled'],
    'Merges approved work and records merge evidence.',
    'active',
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-000000000305',
    'release',
    'Release Agent',
    array['Release Version'],
    array['Released', 'Development', 'Blocked', 'Done', 'Canceled'],
    'Prepares release version, changelog, tag, or artifact.',
    'active',
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-000000000306',
    'deploy',
    'Deploy Agent',
    array['Deployment'],
    array['Deployed', 'Development', 'Blocked', 'Done', 'Canceled'],
    'Deploys approved released artifact and records deployment evidence.',
    'active',
    now(),
    now()
  )
on conflict (key) do update set
  name = excluded.name,
  active_states = excluded.active_states,
  next_states = excluded.next_states,
  description = excluded.description,
  status = excluded.status,
  updated_at = now();

insert into agent_definitions (
  id,
  name,
  role_id,
  runtime,
  model,
  reasoning_effort,
  tool_profile,
  max_turns,
  timeout_seconds,
  status,
  created_at,
  updated_at
)
select
  ('00000000-0000-4000-8000-0000000004' || lpad(row_number() over (order by key)::text, 2, '0'))::uuid,
  name,
  id,
  'openhands',
  'gpt-5.5',
  'high',
  'default',
  80,
  7200,
  'active',
  now(),
  now()
from roles
where key in ('intake', 'development', 'code_review', 'merge', 'release', 'deploy')
on conflict (id) do update set
  name = excluded.name,
  role_id = excluded.role_id,
  model = excluded.model,
  reasoning_effort = excluded.reasoning_effort,
  status = excluded.status,
  updated_at = now();

insert into prompt_components (
  id,
  scope_type,
  scope_id,
  name,
  version,
  status,
  content,
  changelog,
  author,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-4000-8000-000000000501',
    'global',
    null,
    'Global Chinese Runtime',
    1,
    'active',
    '所有 agent 默认使用中文回复。执行前读取任务描述、评论、workpad、PR feedback，并持续更新进度。',
    'Initial global runtime prompt.',
    'agent-control-plane',
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-000000000502',
    'team',
    '00000000-0000-4000-8000-000000000001',
    'Token Team Backend AI Infra',
    1,
    'active',
    '你是一位资深服务端 AI 工程师，从高可用、低延迟、可观测、成本可控的角度实现服务端和 AI Infra 任务。',
    'Initial token team prompt.',
    'agent-control-plane',
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-000000000503',
    'project',
    '00000000-0000-4000-8000-000000000101',
    'Token Project Routing',
    1,
    'active',
    'token project 下每张任务必须明确 repo。repo 可为 crs-src、sub3、traffic。',
    'Initial token project prompt.',
    'agent-control-plane',
    now(),
    now()
  )
on conflict (id) do update set
  scope_type = excluded.scope_type,
  scope_id = excluded.scope_id,
  name = excluded.name,
  version = excluded.version,
  status = excluded.status,
  content = excluded.content,
  changelog = excluded.changelog,
  updated_at = now();

insert into prompt_bindings (
  id,
  scope_type,
  scope_id,
  prompt_component_id,
  order_index,
  environment,
  status,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-4000-8000-000000000601',
    'team',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000501',
    0,
    'dev',
    'active',
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-000000000602',
    'team',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000502',
    1,
    'dev',
    'active',
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-000000000603',
    'project',
    '00000000-0000-4000-8000-000000000101',
    '00000000-0000-4000-8000-000000000503',
    2,
    'dev',
    'active',
    now(),
    now()
  )
on conflict (id) do update set
  prompt_component_id = excluded.prompt_component_id,
  order_index = excluded.order_index,
  environment = excluded.environment,
  status = excluded.status,
  updated_at = now();

insert into tasks (
  id,
  project_id,
  repository_id,
  external_task_id,
  identifier,
  title,
  state,
  priority,
  labels,
  assignee,
  url,
  last_synced_at,
  sync_cursor,
  created_at,
  updated_at
)
values (
  '00000000-0000-4000-8000-000000000701',
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000201',
  'demo-task-1',
  'TOK-1',
  'Demo: repo-aware agent run',
  'Development',
  1,
  '["repo:crs-src", "symphony"]'::jsonb,
  null,
  null,
  now(),
  null,
  now(),
  now()
)
on conflict (project_id, identifier) do update set
  repository_id = excluded.repository_id,
  title = excluded.title,
  state = excluded.state,
  priority = excluded.priority,
  labels = excluded.labels,
  last_synced_at = now(),
  updated_at = now();
