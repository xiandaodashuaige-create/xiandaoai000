alter table public.video_agent_jobs
  add column if not exists execution_target text not null default 'auto';

alter table public.video_agent_jobs
  drop constraint if exists video_agent_jobs_execution_target_check;

alter table public.video_agent_jobs
  add constraint video_agent_jobs_execution_target_check
  check (execution_target in ('auto','local','cloud'));

create index if not exists video_agent_jobs_target_queue_idx
  on public.video_agent_jobs(execution_target, status, created_at);

create or replace function public.video_agent_route_new_job()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.execution_target is null or new.execution_target = 'auto' then
    new.execution_target := case when new.workflow_mode = 'image_poster' then 'cloud' else 'local' end;
  end if;
  return new;
end
$$;

drop trigger if exists video_agent_route_new_job_trigger on public.video_agent_jobs;
create trigger video_agent_route_new_job_trigger
before insert on public.video_agent_jobs
for each row execute function public.video_agent_route_new_job();

update public.video_agent_jobs
set execution_target = case when workflow_mode = 'image_poster' then 'cloud' else 'local' end
where execution_target = 'auto' and status in ('draft','uploading','queued');

create or replace function public.video_agent_claim_next_job(p_access text, p_worker_id text)
returns public.video_agent_jobs
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare v public.video_agent_jobs;
begin
  if not public.video_agent_check_access(p_access) then raise exception 'unauthorized' using errcode='28000'; end if;

  select * into v
  from public.video_agent_jobs
  where status='queued' and execution_target in ('auto','local')
  order by created_at asc
  for update skip locked
  limit 1;

  if v.id is null then return null; end if;

  update public.video_agent_jobs
     set status='processing', progress=8, stage='本地视频工厂已自动领取',
         worker_id=p_worker_id, claimed_at=now(), heartbeat_at=now(),
         attempt_count=attempt_count+1, updated_at=now()
   where id=v.id
   returning * into v;
  return v;
end
$$;

create or replace function public.video_agent_claim_cloud_job(p_access text, p_worker_id text)
returns public.video_agent_jobs
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare v public.video_agent_jobs;
begin
  if not public.video_agent_check_access(p_access) then raise exception 'unauthorized' using errcode='28000'; end if;

  select * into v
  from public.video_agent_jobs
  where status='queued' and execution_target='cloud' and workflow_mode='image_poster'
  order by created_at asc
  for update skip locked
  limit 1;

  if v.id is null then return null; end if;

  update public.video_agent_jobs
     set status='processing', progress=8, stage='云端工厂已自动领取',
         worker_id=p_worker_id, claimed_at=now(), heartbeat_at=now(),
         attempt_count=attempt_count+1, updated_at=now()
   where id=v.id
   returning * into v;
  return v;
end
$$;

create or replace function public.video_agent_cloud_fallback(
  p_access text,
  p_job_id uuid,
  p_worker_id text,
  p_error_message text default null
)
returns public.video_agent_jobs
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare v public.video_agent_jobs;
begin
  if not public.video_agent_check_access(p_access) then raise exception 'unauthorized' using errcode='28000'; end if;

  update public.video_agent_jobs
     set execution_target='local', status='queued', progress=5,
         stage='云端处理未完成，已自动转交本地工厂',
         error_message=left(coalesce(p_error_message,'cloud_worker_failed'),900),
         worker_id=null, claimed_at=null, heartbeat_at=null, updated_at=now()
   where id=p_job_id and status='processing' and worker_id=p_worker_id
   returning * into v;
  if v.id is null then raise exception 'job_not_claimed_by_worker'; end if;
  return v;
end
$$;

revoke all on function public.video_agent_claim_cloud_job(text,text) from public;
revoke all on function public.video_agent_cloud_fallback(text,uuid,text,text) from public;
grant execute on function public.video_agent_claim_cloud_job(text,text) to anon, authenticated;
grant execute on function public.video_agent_cloud_fallback(text,uuid,text,text) to anon, authenticated;

