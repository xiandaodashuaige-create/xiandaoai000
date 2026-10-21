-- Additive: cache only generated assets in the currently claimed job. Existing
-- revision/retry RPCs already preserve input_files and therefore reuse them.
create or replace function public.video_agent_worker_checkpoint_asset(
  p_access text, p_job_id uuid, p_worker_id text, p_asset jsonb
)
returns public.video_agent_jobs
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v public.video_agent_jobs;
  asset_role text := p_asset->>'role';
  asset_path text := p_asset->>'path';
  existing jsonb;
begin
  if not public.video_agent_check_access(p_access) then raise exception 'unauthorized' using errcode='28000'; end if;
  select * into v from public.video_agent_jobs where id=p_job_id for update;
  if v.id is null or v.status <> 'processing' or v.worker_id is distinct from p_worker_id then
    raise exception 'job_not_claimed_by_worker';
  end if;
  if v.workflow_mode <> 'ai_hybrid' or asset_role is null or asset_role not in ('character_reference','ai_hook','ai_cta') then
    raise exception 'invalid_checkpoint_role';
  end if;
  if jsonb_typeof(p_asset) <> 'object' or octet_length(p_asset::text)>16000
     or coalesce(asset_path,'') not like 'jobs/'||p_job_id::text||'/%'
     or not exists(select 1 from storage.objects where bucket_id='video-agent-inputs' and name=asset_path)
     or coalesce(p_asset->'generation'->>'sha256','') !~ '^[0-9a-f]{64}$'
     or (asset_role='character_reference' and coalesce(p_asset->>'type','') <> 'image/jpeg')
     or (asset_role in ('ai_hook','ai_cta') and coalesce(p_asset->>'type','') not in ('video/mp4','video/webm')) then
    raise exception 'invalid_checkpoint_asset';
  end if;
  select item into existing from jsonb_array_elements(coalesce(v.input_files,'[]'::jsonb)) as item where item->>'role'=asset_role limit 1;
  if existing is not null then
    if existing->>'path'=asset_path then return v; end if;
    raise exception 'checkpoint_role_already_exists';
  end if;
  update public.video_agent_jobs set input_files=coalesce(input_files,'[]'::jsonb)||jsonb_build_array(p_asset), updated_at=now()
    where id=p_job_id returning * into v;
  return v;
end
$$;
revoke all on function public.video_agent_worker_checkpoint_asset(text,uuid,text,jsonb) from public;
grant execute on function public.video_agent_worker_checkpoint_asset(text,uuid,text,jsonb) to anon, authenticated;
