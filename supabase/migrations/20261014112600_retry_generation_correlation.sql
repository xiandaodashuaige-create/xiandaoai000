create or replace function public.video_agent_create_revision(
  p_access text,
  p_parent_job_id uuid,
  p_revision_prompt text,
  p_revision_scope text default 'auto'
)
returns public.video_agent_jobs
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  p public.video_agent_jobs;
  v public.video_agent_jobs;
  next_ver integer;
  next_idempotency_key text;
  next_execution_target text;
  is_failed_retry boolean;
begin
  if not public.video_agent_check_access(p_access) then raise exception 'unauthorized' using errcode='28000'; end if;
  select * into p from public.video_agent_jobs where id=p_parent_job_id for update;
  if p.id is null then raise exception 'parent_job_not_found'; end if;

  is_failed_retry := p.status = 'failed' and coalesce(nullif(trim(p_revision_scope),''),'auto') = 'retry_failed';
  if p.status <> 'completed' and not is_failed_retry then raise exception 'parent_job_not_completed'; end if;
  if length(trim(coalesce(p_revision_prompt,'')))=0 then raise exception 'missing_revision_prompt'; end if;
  if is_failed_retry and jsonb_array_length(coalesce(p.input_files,'[]'::jsonb))=0 then
    raise exception 'failed_job_has_no_inputs';
  end if;

  select * into v from public.video_agent_jobs where parent_job_id=p_parent_job_id order by created_at desc limit 1;
  if v.id is not null then return v; end if;

  next_ver := greatest(2,coalesce(p.version_number,1)+1);
  next_idempotency_key := case
    when p.external_tenant_id is null then null
    else coalesce(nullif(p.idempotency_key,''),p.id::text) ||
      case when is_failed_retry then ':retry:' else ':revision:' end || next_ver::text
  end;
  next_execution_target := case when p.workflow_mode in ('ai_hybrid','image_poster') then 'cloud' else p.execution_target end;

  insert into public.video_agent_jobs(
    video_project_id,workflow_mode,project_name,brief,output_count,status,progress,stage,
    input_files,parent_job_id,version_number,revision_prompt,revision_scope,
    external_tenant_id,external_project_id,conversation_session_id,correlation_id,
    idempotency_key,provider,model,estimated_cost,execution_target
  ) values (
    p.video_project_id,p.workflow_mode,
    regexp_replace(p.project_name,' · (V|Retry )[0-9]+$','') ||
      case when is_failed_retry then ' · Retry ' else ' · V' end || next_ver,
    case when is_failed_retry then p.brief else p.brief || E'\n\n【基于上一版继续优化】\n' || trim(p_revision_prompt) end,
    p.output_count,'queued',5,
    case when is_failed_retry then '已复用原素材，等待云端重新生成' else '优化任务已提交，等待工厂' end,
    p.input_files,p.id,next_ver,trim(p_revision_prompt),coalesce(nullif(trim(p_revision_scope),''),'auto'),
    p.external_tenant_id,p.external_project_id,p.conversation_session_id,
    case when is_failed_retry then coalesce(p.correlation_id,p.id) else p.correlation_id end,
    next_idempotency_key,p.provider,p.model,p.estimated_cost,next_execution_target
  ) returning * into v;

  if p.video_project_id is not null then
    perform public.video_agent_record_feedback(
      p_access,p.video_project_id,p_parent_job_id,'employee','revision',trim(p_revision_prompt),
      jsonb_build_object('scope',coalesce(p_revision_scope,'auto'),'next_job_id',v.id)
    );
  end if;
  return v;
end
$$;

revoke all on function public.video_agent_create_revision(text,uuid,text,text) from public;
grant execute on function public.video_agent_create_revision(text,uuid,text,text) to anon, authenticated;
