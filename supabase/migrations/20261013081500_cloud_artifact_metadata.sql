create or replace function public.video_agent_worker_set_artifact_metadata(
  p_access text,
  p_job_id uuid,
  p_worker_id text,
  p_output_sha256 text
)
returns public.video_agent_jobs
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare v public.video_agent_jobs;
begin
  if not public.video_agent_check_access(p_access) then raise exception 'unauthorized' using errcode='28000'; end if;
  if coalesce(p_output_sha256,'') !~ '^[0-9a-f]{64}$' then raise exception 'invalid_sha256'; end if;
  update public.video_agent_jobs
    set output_sha256=p_output_sha256,updated_at=now()
    where id=p_job_id and status='processing' and worker_id=p_worker_id
    returning * into v;
  if v.id is null then raise exception 'job_not_claimed_by_worker'; end if;
  return v;
end
$$;

revoke all on function public.video_agent_worker_set_artifact_metadata(text,uuid,text,text) from public;
grant execute on function public.video_agent_worker_set_artifact_metadata(text,uuid,text,text) to anon, authenticated;
