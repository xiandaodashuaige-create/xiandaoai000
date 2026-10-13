alter table public.video_agent_projects
  add column if not exists external_tenant_id text,
  add column if not exists external_project_id text;

alter table public.video_agent_jobs
  add column if not exists external_tenant_id text,
  add column if not exists external_project_id text,
  add column if not exists conversation_session_id text,
  add column if not exists correlation_id text,
  add column if not exists idempotency_key text,
  add column if not exists provider text,
  add column if not exists model text,
  add column if not exists estimated_cost numeric(12,4),
  add column if not exists output_sha256 text;

create unique index if not exists video_agent_projects_external_scope_uidx
  on public.video_agent_projects(external_tenant_id, external_project_id)
  where external_tenant_id is not null and external_project_id is not null;

create unique index if not exists video_agent_jobs_tenant_idempotency_uidx
  on public.video_agent_jobs(external_tenant_id, idempotency_key)
  where external_tenant_id is not null and idempotency_key is not null;

create index if not exists video_agent_jobs_external_scope_created_idx
  on public.video_agent_jobs(external_tenant_id, external_project_id, created_at desc);

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
  where status='queued' and execution_target='cloud'
    and workflow_mode in ('image_poster','remix','ai_hybrid')
  order by created_at asc
  for update skip locked
  limit 1;

  if v.id is null then return null; end if;

  update public.video_agent_jobs
     set status='processing', progress=8, stage='云端创意工厂已自动领取',
         worker_id=p_worker_id, claimed_at=now(), heartbeat_at=now(),
         attempt_count=attempt_count+1, updated_at=now()
   where id=v.id
   returning * into v;
  return v;
end
$$;

create or replace function public.video_agent_provider_upsert_project(
  p_access text,
  p_tenant_id text,
  p_external_project_id text,
  p_project_name text,
  p_client_name text default null,
  p_business_type text default null,
  p_business_summary text default null,
  p_target_audience text default null,
  p_offer_facts text default null,
  p_cta text default null,
  p_default_language text default '普通话',
  p_must_include text default null,
  p_must_exclude text default null
)
returns public.video_agent_projects
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare v public.video_agent_projects;
begin
  if not public.video_agent_check_access(p_access) then raise exception 'unauthorized' using errcode='28000'; end if;
  if length(trim(coalesce(p_tenant_id,'')))=0 or length(trim(coalesce(p_external_project_id,'')))=0 then
    raise exception 'missing_tenant_or_project';
  end if;
  if length(trim(coalesce(p_project_name,'')))=0 or length(trim(coalesce(p_business_type,'')))=0 then
    raise exception 'missing_project_name_or_business_type';
  end if;

  insert into public.video_agent_projects(
    external_tenant_id,external_project_id,project_name,client_name,business_type,
    business_summary,target_audience,offer_facts,cta,default_language,must_include,must_exclude
  ) values (
    trim(p_tenant_id),trim(p_external_project_id),trim(p_project_name),nullif(trim(coalesce(p_client_name,'')),''),trim(p_business_type),
    nullif(trim(coalesce(p_business_summary,'')),''),nullif(trim(coalesce(p_target_audience,'')),''),
    nullif(trim(coalesce(p_offer_facts,'')),''),nullif(trim(coalesce(p_cta,'')),''),
    coalesce(nullif(trim(coalesce(p_default_language,'')),''),'普通话'),
    nullif(trim(coalesce(p_must_include,'')),''),nullif(trim(coalesce(p_must_exclude,'')),'')
  )
  on conflict (external_tenant_id,external_project_id) where external_tenant_id is not null and external_project_id is not null
  do update set
    project_name=excluded.project_name,client_name=excluded.client_name,business_type=excluded.business_type,
    business_summary=excluded.business_summary,target_audience=excluded.target_audience,offer_facts=excluded.offer_facts,
    cta=excluded.cta,default_language=excluded.default_language,must_include=excluded.must_include,
    must_exclude=excluded.must_exclude,updated_at=now()
  returning * into v;
  return v;
end
$$;

create or replace function public.video_agent_provider_create_job(
  p_access text,
  p_tenant_id text,
  p_external_project_id text,
  p_conversation_session_id text,
  p_correlation_id text,
  p_idempotency_key text,
  p_brief text,
  p_workflow_mode text default 'ai_hybrid',
  p_output_count integer default 1,
  p_provider text default null,
  p_model text default null,
  p_estimated_cost numeric default null
)
returns public.video_agent_jobs
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare project_row public.video_agent_projects;
declare existing public.video_agent_jobs;
declare v public.video_agent_jobs;
declare locked_brief text;
begin
  if not public.video_agent_check_access(p_access) then raise exception 'unauthorized' using errcode='28000'; end if;
  if p_workflow_mode not in ('remix','ai_hybrid','image_poster') then raise exception 'invalid_workflow_mode'; end if;
  if length(trim(coalesce(p_tenant_id,'')))=0 or length(trim(coalesce(p_external_project_id,'')))=0 or length(trim(coalesce(p_idempotency_key,'')))=0 then
    raise exception 'missing_scope_or_idempotency_key';
  end if;
  select * into existing from public.video_agent_jobs
    where external_tenant_id=trim(p_tenant_id) and idempotency_key=trim(p_idempotency_key);
  if existing.id is not null then return existing; end if;
  select * into project_row from public.video_agent_projects
    where external_tenant_id=trim(p_tenant_id) and external_project_id=trim(p_external_project_id) and status='active';
  if project_row.id is null then raise exception 'project_not_found_in_tenant'; end if;

  locked_brief := concat_ws(E'\n',
    '【A3客户资料墙｜严格租户隔离】',
    '租户：' || project_row.external_tenant_id,
    '项目：' || project_row.external_project_id || ' / ' || project_row.project_name,
    '客户：' || coalesce(project_row.client_name,'未填写'),
    '业务类型：' || project_row.business_type,
    '业务说明：' || coalesce(project_row.business_summary,'未填写'),
    '目标客户：' || coalesce(project_row.target_audience,'未填写'),
    '准确价格/优惠/事实：' || coalesce(project_row.offer_facts,'未填写'),
    '行动引导：' || coalesce(project_row.cta,'未填写'),
    '语言：' || project_row.default_language,
    '必须出现：' || coalesce(project_row.must_include,'无'),
    '禁止出现：' || coalesce(project_row.must_exclude,'无'),
    '已学习偏好：' || coalesce(nullif(project_row.learned_preferences,''),'暂无'),
    '硬规则：只能读取当前 tenantId + projectId 的素材、事实、反馈和版本；不得跨项目推断或复用。',
    E'\n【本次制作需求】',trim(coalesce(p_brief,''))
  );

  insert into public.video_agent_jobs(
    video_project_id,external_tenant_id,external_project_id,conversation_session_id,correlation_id,idempotency_key,
    provider,model,estimated_cost,workflow_mode,project_name,brief,output_count,status,progress,stage,execution_target
  ) values (
    project_row.id,trim(p_tenant_id),trim(p_external_project_id),nullif(trim(coalesce(p_conversation_session_id,'')),''),
    nullif(trim(coalesce(p_correlation_id,'')),''),trim(p_idempotency_key),nullif(trim(coalesce(p_provider,'')),''),
    nullif(trim(coalesce(p_model,'')),''),p_estimated_cost,p_workflow_mode,project_row.project_name,locked_brief,
    greatest(1,least(3,coalesce(p_output_count,1))),'uploading',2,'等待A3上传当前项目素材','cloud'
  ) returning * into v;
  return v;
end
$$;

create or replace function public.video_agent_provider_get_job(
  p_access text,p_tenant_id text,p_external_project_id text,p_job_id uuid
)
returns public.video_agent_jobs
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare v public.video_agent_jobs;
begin
  if not public.video_agent_check_access(p_access) then raise exception 'unauthorized' using errcode='28000'; end if;
  select * into v from public.video_agent_jobs
    where id=p_job_id and external_tenant_id=trim(p_tenant_id) and external_project_id=trim(p_external_project_id);
  if v.id is null then raise exception 'job_not_found_in_tenant'; end if;
  return v;
end
$$;

revoke all on function public.video_agent_provider_upsert_project(text,text,text,text,text,text,text,text,text,text,text,text,text) from public;
revoke all on function public.video_agent_provider_create_job(text,text,text,text,text,text,text,text,integer,text,text,numeric) from public;
revoke all on function public.video_agent_provider_get_job(text,text,text,uuid) from public;
grant execute on function public.video_agent_provider_upsert_project(text,text,text,text,text,text,text,text,text,text,text,text,text) to anon, authenticated;
grant execute on function public.video_agent_provider_create_job(text,text,text,text,text,text,text,text,integer,text,text,numeric) to anon, authenticated;
grant execute on function public.video_agent_provider_get_job(text,text,text,uuid) to anon, authenticated;
