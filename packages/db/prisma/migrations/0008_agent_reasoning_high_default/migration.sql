alter table "agent_definitions"
  alter column "reasoning_effort" set default 'high';

update "agent_definitions"
set "reasoning_effort" = 'high',
    "updated_at" = now()
where "model" = 'gpt-5.5'
  and "reasoning_effort" = 'medium';
