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
begin
  if not public.video_agent_check_access(p_access) then raise exception 'unauthorized' using errcode='28000'; end if;
  select * into p from public.video_agent_jobs where id=p_parent_job_id for update;
  if p.id is null then raise exception 'parent_job_not_found'; end if;
  if p.status <> 'completed' then raise exception 'parent_job_not_completed'; end if;
  if length(trim(coalesce(p_revision_prompt,'')))=0 then raise exception 'missing_revision_prompt'; end if;

  select * into v from public.video_agent_jobs where parent_job_id=p_parent_job_id order by created_at desc limit 1;
  if v.id is not null then return v; end if;

  next_ver := greatest(2,coalesce(p.version_number,1)+1);
  next_idempotency_key := case
    when p.external_tenant_id is null then null
    else coalesce(nullif(p.idempotency_key,''),p.id::text) || ':revision:' || next_ver::text
  end;

  insert into public.video_agent_jobs(
    video_project_id,workflow_mode,project_name,brief,output_count,status,progress,stage,
    input_files,parent_job_id,version_number,revision_prompt,revision_scope,
    external_tenant_id,external_project_id,conversation_session_id,correlation_id,
    idempotency_key,provider,model,estimated_cost,execution_target
  ) values (
    p.video_project_id,p.workflow_mode,regexp_replace(p.project_name,' · V[0-9]+$','') || ' · V' || next_ver,
    p.brief || E'\n\n【基于上一版继续优化】\n' || trim(p_revision_prompt),
    p.output_count,'queued',5,'优化任务已提交，等待工厂',p.input_files,
    p.id,next_ver,trim(p_revision_prompt),coalesce(nullif(trim(p_revision_scope),''),'auto'),
    p.external_tenant_id,p.external_project_id,p.conversation_session_id,p.correlation_id,
    next_idempotency_key,p.provider,p.model,p.estimated_cost,p.execution_target
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
