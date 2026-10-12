create table if not exists public.video_agent_projects (
  id uuid primary key default gen_random_uuid(),
  project_name text not null,
  client_name text,
  business_type text not null,
  business_summary text,
  target_audience text,
  offer_facts text,
  cta text,
  default_language text not null default '普通话',
  must_include text,
  must_exclude text,
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.video_agent_projects enable row level security;
revoke all on table public.video_agent_projects from public, anon, authenticated;

alter table public.video_agent_jobs
  add column if not exists video_project_id uuid references public.video_agent_projects(id) on delete restrict,
  add column if not exists workflow_mode text not null default 'remix';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'video_agent_jobs_workflow_mode_check'
  ) then
    alter table public.video_agent_jobs
      add constraint video_agent_jobs_workflow_mode_check
      check (workflow_mode in ('remix','ai_hybrid'));
  end if;
end $$;

create index if not exists video_agent_jobs_project_created_idx
  on public.video_agent_jobs(video_project_id, created_at desc);

create or replace function public.video_agent_list_projects(p_access text)
returns setof public.video_agent_projects
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if not public.video_agent_check_access(p_access) then
    raise exception 'unauthorized' using errcode='28000';
  end if;
  return query
    select * from public.video_agent_projects
    where status='active'
    order by updated_at desc, created_at desc;
end
$$;

create or replace function public.video_agent_get_project(
  p_access text,
  p_project_id uuid
)
returns public.video_agent_projects
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare v public.video_agent_projects;
begin
  if not public.video_agent_check_access(p_access) then
    raise exception 'unauthorized' using errcode='28000';
  end if;
  select * into v from public.video_agent_projects where id=p_project_id;
  if v.id is null then raise exception 'project_not_found'; end if;
  return v;
end
$$;

create or replace function public.video_agent_create_project(
  p_access text,
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
  if not public.video_agent_check_access(p_access) then
    raise exception 'unauthorized' using errcode='28000';
  end if;
  if length(trim(coalesce(p_project_name,'')))=0 or length(trim(coalesce(p_business_type,'')))=0 then
    raise exception 'missing_project_name_or_business_type';
  end if;
  insert into public.video_agent_projects(
    project_name,client_name,business_type,business_summary,target_audience,
    offer_facts,cta,default_language,must_include,must_exclude
  ) values (
    trim(p_project_name),nullif(trim(coalesce(p_client_name,'')),''),trim(p_business_type),
    nullif(trim(coalesce(p_business_summary,'')),''),nullif(trim(coalesce(p_target_audience,'')),''),
    nullif(trim(coalesce(p_offer_facts,'')),''),nullif(trim(coalesce(p_cta,'')),''),
    coalesce(nullif(trim(coalesce(p_default_language,'')),''),'普通话'),
    nullif(trim(coalesce(p_must_include,'')),''),nullif(trim(coalesce(p_must_exclude,'')),'')
  ) returning * into v;
  return v;
end
$$;

create or replace function public.video_agent_update_project(
  p_access text,
  p_project_id uuid,
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
  if not public.video_agent_check_access(p_access) then
    raise exception 'unauthorized' using errcode='28000';
  end if;
  if length(trim(coalesce(p_project_name,'')))=0 or length(trim(coalesce(p_business_type,'')))=0 then
    raise exception 'missing_project_name_or_business_type';
  end if;
  update public.video_agent_projects set
    project_name=trim(p_project_name),
    client_name=nullif(trim(coalesce(p_client_name,'')),''),
    business_type=trim(p_business_type),
    business_summary=nullif(trim(coalesce(p_business_summary,'')),''),
    target_audience=nullif(trim(coalesce(p_target_audience,'')),''),
    offer_facts=nullif(trim(coalesce(p_offer_facts,'')),''),
    cta=nullif(trim(coalesce(p_cta,'')),''),
    default_language=coalesce(nullif(trim(coalesce(p_default_language,'')),''),'普通话'),
    must_include=nullif(trim(coalesce(p_must_include,'')),''),
    must_exclude=nullif(trim(coalesce(p_must_exclude,'')),''),
    updated_at=now()
  where id=p_project_id and status='active'
  returning * into v;
  if v.id is null then raise exception 'project_not_found'; end if;
  return v;
end
$$;

create or replace function public.video_agent_create_project_job(
  p_access text,
  p_video_project_id uuid,
  p_project_name text,
  p_brief text,
  p_output_count integer default 1,
  p_workflow_mode text default 'remix'
)
returns public.video_agent_jobs
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  project_row public.video_agent_projects;
  v public.video_agent_jobs;
  locked_brief text;
begin
  if not public.video_agent_check_access(p_access) then
    raise exception 'unauthorized' using errcode='28000';
  end if;
  if p_workflow_mode not in ('remix','ai_hybrid') then raise exception 'invalid_workflow_mode'; end if;
  select * into project_row from public.video_agent_projects
    where id=p_video_project_id and status='active';
  if project_row.id is null then raise exception 'project_not_found'; end if;
  if length(trim(coalesce(p_project_name,'')))=0 or length(trim(coalesce(p_brief,'')))=0 then
    raise exception 'missing_project_or_brief';
  end if;

  locked_brief := concat_ws(E'\n',
    '【项目隔离信息｜只能使用本项目资料】',
    '项目：' || project_row.project_name,
    '客户：' || coalesce(project_row.client_name,'未填写'),
    '业务类型：' || project_row.business_type,
    '业务说明：' || coalesce(project_row.business_summary,'未填写'),
    '目标客户：' || coalesce(project_row.target_audience,'未填写'),
    '准确价格/优惠/事实：' || coalesce(project_row.offer_facts,'未填写'),
    '行动引导：' || coalesce(project_row.cta,'未填写'),
    '语言：' || project_row.default_language,
    '必须出现：' || coalesce(project_row.must_include,'无'),
    '禁止出现：' || coalesce(project_row.must_exclude,'无'),
    '制作模式：' || case when p_workflow_mode='ai_hybrid' then 'AI生成＋客户真实素材' else '真实素材混剪' end,
    '硬规则：不得调用、推断或混入其他项目的素材、价格、联系方式、品牌、人物或业务内容。',
    E'\n【本次视频需求】',
    trim(p_brief)
  );

  insert into public.video_agent_jobs(
    video_project_id,workflow_mode,project_name,brief,output_count,status,progress,stage
  ) values (
    project_row.id,p_workflow_mode,trim(p_project_name),locked_brief,
    greatest(1,least(3,coalesce(p_output_count,1))),'uploading',2,'等待素材上传'
  ) returning * into v;
  return v;
end
$$;

create or replace function public.video_agent_list_project_jobs(
  p_access text,
  p_video_project_id uuid
)
returns setof public.video_agent_jobs
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if not public.video_agent_check_access(p_access) then
    raise exception 'unauthorized' using errcode='28000';
  end if;
  return query
    select * from public.video_agent_jobs
    where video_project_id=p_video_project_id
    order by created_at desc limit 30;
end
$$;

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
begin
  if not public.video_agent_check_access(p_access) then
    raise exception 'unauthorized' using errcode='28000';
  end if;
  select * into p from public.video_agent_jobs where id=p_parent_job_id for update;
  if p.id is null then raise exception 'parent_job_not_found'; end if;
  if p.status <> 'completed' then raise exception 'parent_job_not_completed'; end if;
  if length(trim(coalesce(p_revision_prompt,'')))=0 then raise exception 'missing_revision_prompt'; end if;
  select * into v from public.video_agent_jobs
    where parent_job_id=p_parent_job_id order by created_at desc limit 1;
  if v.id is not null then return v; end if;
  next_ver := greatest(2,coalesce(p.version_number,1)+1);
  insert into public.video_agent_jobs(
    video_project_id,workflow_mode,project_name,brief,output_count,status,progress,stage,
    input_files,parent_job_id,version_number,revision_prompt,revision_scope
  ) values (
    p.video_project_id,p.workflow_mode,
    regexp_replace(p.project_name,' · V[0-9]+$','') || ' · V' || next_ver,
    p.brief || E'\n\n【基于上一版继续优化】\n' || trim(p_revision_prompt),
    p.output_count,'queued',5,'优化任务已提交，等待视频工厂',p.input_files,
    p.id,next_ver,trim(p_revision_prompt),coalesce(nullif(trim(p_revision_scope),''),'auto')
  ) returning * into v;
  return v;
end
$$;

revoke all on function public.video_agent_list_projects(text) from public;
revoke all on function public.video_agent_get_project(text,uuid) from public;
revoke all on function public.video_agent_create_project(text,text,text,text,text,text,text,text,text,text,text) from public;
revoke all on function public.video_agent_update_project(text,uuid,text,text,text,text,text,text,text,text,text,text) from public;
revoke all on function public.video_agent_create_project_job(text,uuid,text,text,integer,text) from public;
revoke all on function public.video_agent_list_project_jobs(text,uuid) from public;

grant execute on function public.video_agent_list_projects(text) to anon, authenticated;
grant execute on function public.video_agent_get_project(text,uuid) to anon, authenticated;
grant execute on function public.video_agent_create_project(text,text,text,text,text,text,text,text,text,text,text) to anon, authenticated;
grant execute on function public.video_agent_update_project(text,uuid,text,text,text,text,text,text,text,text,text,text) to anon, authenticated;
grant execute on function public.video_agent_create_project_job(text,uuid,text,text,integer,text) to anon, authenticated;
grant execute on function public.video_agent_list_project_jobs(text,uuid) to anon, authenticated;

insert into public.video_agent_projects(
  project_name,client_name,business_type,business_summary,target_audience,default_language,must_exclude
)
select 'SMP纹髮','SMP纹髮客户','SMP头皮纹髮','SMP头皮纹髮客户营销视频','关注发际线与头皮形象改善的客户','中文','其他美容项目、AI培训、鹿联广告代投'
where not exists (select 1 from public.video_agent_projects where project_name='SMP纹髮');

update public.video_agent_jobs j
set video_project_id=p.id, workflow_mode='remix'
from public.video_agent_projects p
where j.video_project_id is null
  and j.project_name like 'SMP紋髮%'
  and p.project_name='SMP纹髮';
