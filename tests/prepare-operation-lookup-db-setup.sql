-- Synthetic disposable PostgreSQL fixture only, never run on a hosted database.
create role anon;
create role authenticated;
create role operation_unprivileged;
create table public.video_agent_jobs (
  id uuid primary key, external_tenant_id text, external_project_id text,
  conversation_session_id text, correlation_id text, idempotency_key text,
  status text, version_number integer, input_files jsonb, output_files jsonb,
  private_fact text
);
create unique index operation_fixture_tenant_key on public.video_agent_jobs(external_tenant_id,idempotency_key)
where external_tenant_id is not null and idempotency_key is not null;
alter table public.video_agent_jobs enable row level security;
revoke all on public.video_agent_jobs from public,anon,authenticated,operation_unprivileged;
create function public.video_agent_check_access(p_access text) returns boolean
language sql stable as $$ select p_access = 'fixture-access' $$;
insert into public.video_agent_jobs values
('10000000-0000-0000-0000-000000000001','tenant-a','project-a','session-a','correlation-a','vpr1_'||repeat('a',64),'uploading',1,'[]','[]','SYNTHETIC-PRIVATE-A'),
('20000000-0000-0000-0000-000000000002','tenant-b','project-b','session-b','correlation-b','vpr1_'||repeat('b',64),'queued',1,'[]','[]','SYNTHETIC-PRIVATE-B');
