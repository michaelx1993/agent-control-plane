-- Retire the static seed demo task from automatic dispatch queues in deployed databases.
-- Production task-source smoke must audit Plane-routed work items, not the local seed fixture.
update tasks
set
  state = 'Human Review',
  updated_at = now()
where id = '00000000-0000-4000-8000-000000000701'
  and external_task_id = 'demo-task-1'
  and nullif(url, '') is null
  and state in ('Todo', 'Development', 'Code Review', 'In Merge', 'Release Version', 'Deployment');
