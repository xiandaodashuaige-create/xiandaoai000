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
         error_message=right(coalesce(p_error_message,'cloud_worker_failed'),900),
         worker_id=null, claimed_at=null, heartbeat_at=null, updated_at=now()
   where id=p_job_id and status='processing' and worker_id=p_worker_id
   returning * into v;
  if v.id is null then raise exception 'job_not_claimed_by_worker'; end if;
  return v;
end
$$;
