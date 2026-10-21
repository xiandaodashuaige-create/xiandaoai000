-- All supported website workflows run in the cloud, including ordinary remix
-- jobs and revisions inherited from historical local jobs.
create or replace function public.video_agent_route_new_job()
returns trigger language plpgsql set search_path = pg_catalog, public
as $$
begin
  if new.workflow_mode in ('image_poster','ai_hybrid','remix') then
    new.execution_target := 'cloud';
  end if;
  return new;
end
$$;

create or replace function public.video_agent_submit_job(p_access text,p_job_id uuid,p_input_files jsonb)
returns public.video_agent_jobs
language plpgsql security definer set search_path = pg_catalog, public, private
as $$
declare v public.video_agent_jobs;
begin
  if not public.video_agent_check_access(p_access) then raise exception 'unauthorized' using errcode='28000'; end if;
  select * into v from public.video_agent_jobs where id=p_job_id for update;
  if v.id is null then raise exception 'job_not_found'; end if;
  -- A second submission must never requeue a running/completed job or replace
  -- its checkpointed inputs. Failed jobs use the existing revision retry API.
  if v.status in ('queued','processing','completed') then return v; end if;
  if v.status not in ('draft','uploading') then raise exception 'job_not_uploading'; end if;
  if p_input_files is null or jsonb_typeof(p_input_files)<>'array' then raise exception 'invalid_input_files'; end if;
  if exists(
    select 1 from jsonb_array_elements(p_input_files) f
    where coalesce(f->>'path','') not like 'jobs/'||p_job_id::text||'/%'
      or not exists(select 1 from storage.objects o where o.bucket_id='video-agent-inputs' and o.name=f->>'path')
  ) then raise exception 'input_asset_not_owned_by_job'; end if;
  if v.workflow_mode='remix' and not exists(
    select 1 from jsonb_array_elements(p_input_files) f
    where coalesce(f->>'type','') ~ '^(video|image)/'
      and coalesce(f->>'path','')<>''
      and coalesce(f->>'role','') not in ('reference','character_reference')
  ) then raise exception 'remix_visual_input_required'; end if;
  update public.video_agent_jobs
    set input_files=p_input_files,status='queued',progress=5,stage='已提交，等待云端视频工厂',
        execution_target=case when workflow_mode in ('image_poster','ai_hybrid','remix') then 'cloud' else execution_target end,
        updated_at=now()
    where id=p_job_id returning * into v;
  return v;
end
$$;
revoke all on function public.video_agent_submit_job(text,uuid,jsonb) from public;
grant execute on function public.video_agent_submit_job(text,uuid,jsonb) to anon, authenticated;

-- Stop invalid historical jobs from waiting indefinitely for an offline PC.
update public.video_agent_jobs set status='failed',progress=0,
  stage='缺少视频或图片素材，请上传素材后重新提交',error_message='remix_visual_input_required',updated_at=now()
where workflow_mode='remix' and status='queued' and not exists(
  select 1 from jsonb_array_elements(coalesce(input_files,'[]'::jsonb)) f
  where coalesce(f->>'type','') ~ '^(video|image)/' and coalesce(f->>'path','')<>''
    and coalesce(f->>'role','') not in ('reference','character_reference')
);
update public.video_agent_jobs set execution_target='cloud',updated_at=now()
where workflow_mode in ('image_poster','ai_hybrid','remix') and status in ('draft','uploading','queued') and execution_target<>'cloud';
