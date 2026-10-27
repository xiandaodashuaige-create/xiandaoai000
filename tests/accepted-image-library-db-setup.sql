-- Disposable PostgreSQL fixture only; never run against customer data.
create role anon;
create role authenticated;
create role library_unprivileged;
create table public.video_agent_projects (
  id uuid primary key, external_tenant_id text, external_project_id text, status text
);
create table public.video_agent_jobs (
  id uuid primary key, video_project_id uuid, external_tenant_id text, external_project_id text,
  conversation_session_id text, version_number integer, status text, accepted_at timestamptz,
  output_sha256 text, output_files jsonb
);
create function public.video_agent_check_access(p_access text) returns boolean language sql as $$
  select p_access = 'fixture-access';
$$;
insert into public.video_agent_projects values
 ('00000000-0000-0000-0000-000000000001', 'tenant-a', 'project-a', 'active'),
 ('00000000-0000-0000-0000-000000000002', 'tenant-b', 'project-b', 'active');
insert into public.video_agent_jobs
select ('10000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
 '00000000-0000-0000-0000-000000000001'::uuid, 'tenant-a', 'project-a', 'original-session', 1,
 'completed', '2026-10-27T01:00:00Z'::timestamptz - make_interval(days => i),
 repeat('a',64), jsonb_build_array(jsonb_build_object('path', 'poster.jpg','type','image/jpeg'))
from generate_series(1,75) i;
insert into public.video_agent_jobs values
 ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','tenant-b','project-b','other-session',1,'completed',now(),repeat('b',64),'[{"path":"private.jpg"}]'),
 ('20000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','tenant-a','project-a','original-session',1,'completed',null,repeat('a',64),'[{"path":"unconfirmed.jpg"}]'),
 ('20000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','tenant-a','project-a','original-session',1,'failed',now(),repeat('a',64),'[{"path":"failed.jpg"}]'),
 ('20000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000001','tenant-a','project-a','original-session',1,'completed',now(),repeat('a',64),'[{"path":"video.mp4","type":"video/mp4"}]');
