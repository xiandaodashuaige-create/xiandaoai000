alter table public.video_agent_projects
  add column if not exists learned_preferences text not null default '';

alter table public.video_agent_jobs
  drop constraint if exists video_agent_jobs_workflow_mode_check;

alter table public.video_agent_jobs
  add constraint video_agent_jobs_workflow_mode_check
  check (workflow_mode in ('remix','ai_hybrid','image_poster'));

create table if not exists public.video_agent_feedback (
  id uuid primary key default gen_random_uuid(),
  video_project_id uuid not null references public.video_agent_projects(id) on delete cascade,
  job_id uuid references public.video_agent_jobs(id) on delete set null,
  actor_id text not null default 'employee',
  event_type text not null,
  content text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists video_agent_feedback_project_created_idx
  on public.video_agent_feedback(video_project_id, created_at desc);

alter table public.video_agent_feedback enable row level security;
revoke all on table public.video_agent_feedback from public, anon, authenticated;

create or replace function public.video_agent_record_feedback(
  p_access text,
  p_video_project_id uuid,
  p_job_id uuid default null,
  p_actor_id text default 'employee',
  p_event_type text default 'operation',
  p_content text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.video_agent_feedback
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v public.video_agent_feedback;
  learning_line text;
begin
  if not public.video_agent_check_access(p_access) then
    raise exception 'unauthorized' using errcode='28000';
  end if;
  if not exists(select 1 from public.video_agent_projects where id=p_video_project_id and status='active') then
    raise exception 'project_not_found';
  end if;
  if p_job_id is not null and not exists(
    select 1 from public.video_agent_jobs where id=p_job_id and video_project_id=p_video_project_id
  ) then
    raise exception 'job_project_mismatch';
  end if;

  insert into public.video_agent_feedback(video_project_id,job_id,actor_id,event_type,content,metadata)
  values (
    p_video_project_id,p_job_id,
    left(coalesce(nullif(trim(p_actor_id),''),'employee'),120),
    left(coalesce(nullif(trim(p_event_type),''),'operation'),60),
    nullif(trim(coalesce(p_content,'')),''),coalesce(p_metadata,'{}'::jsonb)
  ) returning * into v;

  if p_event_type in ('revision','accept','project_note') and length(trim(coalesce(p_content,''))) > 0 then
    learning_line := to_char(now() at time zone 'UTC','YYYY-MM-DD') || ' · ' ||
      case p_event_type when 'revision' then '修改偏好' when 'accept' then '确认偏好' else '长期规则' end ||
      '：' || trim(p_content);
    update public.video_agent_projects
      set learned_preferences=right(concat_ws(E'\n',nullif(learned_preferences,''),learning_line),6000),
          updated_at=now()
      where id=p_video_project_id;
  end if;
  return v;
end
$$;

create or replace function public.video_agent_list_project_feedback(
  p_access text,
  p_video_project_id uuid,
  p_limit integer default 30
)
returns setof public.video_agent_feedback
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if not public.video_agent_check_access(p_access) then
    raise exception 'unauthorized' using errcode='28000';
  end if;
  return query select * from public.video_agent_feedback
    where video_project_id=p_video_project_id
    order by created_at desc limit greatest(1,least(100,coalesce(p_limit,30)));
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
  if p_workflow_mode not in ('remix','ai_hybrid','image_poster') then raise exception 'invalid_workflow_mode'; end if;
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
    '项目已学习偏好：' || coalesce(nullif(project_row.learned_preferences,''),'暂无，以本次反馈开始学习'),
    '制作模式：' || case p_workflow_mode when 'ai_hybrid' then 'AI生成＋客户真实素材' when 'image_poster' then '广告图片/海报' else '真实素材混剪' end,
    '硬规则：不得调用、推断或混入其他项目的素材、价格、联系方式、品牌、人物或业务内容。',
    E'\n【本次制作需求】',trim(p_brief)
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
  if not public.video_agent_check_access(p_access) then raise exception 'unauthorized' using errcode='28000'; end if;
  select * into p from public.video_agent_jobs where id=p_parent_job_id for update;
  if p.id is null then raise exception 'parent_job_not_found'; end if;
  if p.status <> 'completed' then raise exception 'parent_job_not_completed'; end if;
  if length(trim(coalesce(p_revision_prompt,'')))=0 then raise exception 'missing_revision_prompt'; end if;
  select * into v from public.video_agent_jobs where parent_job_id=p_parent_job_id order by created_at desc limit 1;
  if v.id is not null then return v; end if;
  next_ver := greatest(2,coalesce(p.version_number,1)+1);
  insert into public.video_agent_jobs(
    video_project_id,workflow_mode,project_name,brief,output_count,status,progress,stage,
    input_files,parent_job_id,version_number,revision_prompt,revision_scope
  ) values (
    p.video_project_id,p.workflow_mode,regexp_replace(p.project_name,' · V[0-9]+$','') || ' · V' || next_ver,
    p.brief || E'\n\n【基于上一版继续优化】\n' || trim(p_revision_prompt),
    p.output_count,'queued',5,'优化任务已提交，等待工厂',p.input_files,
    p.id,next_ver,trim(p_revision_prompt),coalesce(nullif(trim(p_revision_scope),''),'auto')
  ) returning * into v;
  if p.video_project_id is not null then
    perform public.video_agent_record_feedback(p_access,p.video_project_id,p_parent_job_id,'employee','revision',trim(p_revision_prompt),jsonb_build_object('scope',coalesce(p_revision_scope,'auto'),'next_job_id',v.id));
  end if;
  return v;
end
$$;

create or replace function public.video_agent_accept_job(p_access text, p_job_id uuid)
returns public.video_agent_jobs
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare v public.video_agent_jobs;
begin
  if not public.video_agent_check_access(p_access) then raise exception 'unauthorized' using errcode='28000'; end if;
  update public.video_agent_jobs set accepted_at=now(),updated_at=now()
    where id=p_job_id and status='completed' returning * into v;
  if v.id is null then raise exception 'job_not_completed_or_missing'; end if;
  if v.video_project_id is not null then
    perform public.video_agent_record_feedback(p_access,v.video_project_id,v.id,'employee','accept',
      '员工确认该版本可用。延续本版的结构、节奏、画面选择、声音和字幕风格。',
      jsonb_build_object('workflow_mode',v.workflow_mode,'version',v.version_number));
  end if;
  return v;
end
$$;

revoke all on function public.video_agent_record_feedback(text,uuid,uuid,text,text,text,jsonb) from public;
revoke all on function public.video_agent_list_project_feedback(text,uuid,integer) from public;
grant execute on function public.video_agent_record_feedback(text,uuid,uuid,text,text,text,jsonb) to anon, authenticated;
grant execute on function public.video_agent_list_project_feedback(text,uuid,integer) to anon, authenticated;
