-- WA888 test-only structural bootstrap, recovered 2026-10-29 from pg_catalog.
-- No customer rows, access digest, storage secret, or production credential was read/copied.
-- Approved destination: ugqqaixpligbancucwdd only. NOT a production migration.
-- Abort if any owned table exists. This never overwrites an existing installation.
DO $guard$ BEGIN
 IF to_regclass('public.video_agent_jobs') IS NOT NULL
 OR to_regclass('public.video_agent_projects') IS NOT NULL
 OR to_regclass('public.video_agent_feedback') IS NOT NULL
 OR to_regclass('private.video_agent_config') IS NOT NULL
 OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname IN ('public','private') AND left(p.proname,12)='video_agent_') THEN
  RAISE EXCEPTION 'WA888 bootstrap requires absent video-agent tables and functions';
 END IF;
END $guard$;
CREATE SCHEMA IF NOT EXISTS private;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE TABLE private.video_agent_config (
  "key" text NOT NULL,
  "value" text NOT NULL
);
CREATE TABLE public.video_agent_feedback (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "video_project_id" uuid NOT NULL,
  "job_id" uuid,
  "actor_id" text DEFAULT 'employee'::text NOT NULL,
  "event_type" text NOT NULL,
  "content" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.video_agent_jobs (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "project_name" text NOT NULL,
  "brief" text NOT NULL,
  "output_count" integer DEFAULT 1 NOT NULL,
  "status" text DEFAULT 'draft'::text NOT NULL,
  "input_files" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "output_files" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "progress" integer DEFAULT 0 NOT NULL,
  "stage" text DEFAULT '等待素材'::text NOT NULL,
  "error_message" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "worker_id" text,
  "claimed_at" timestamp with time zone,
  "heartbeat_at" timestamp with time zone,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "parent_job_id" uuid,
  "version_number" integer DEFAULT 1 NOT NULL,
  "revision_prompt" text,
  "revision_scope" text,
  "accepted_at" timestamp with time zone,
  "video_project_id" uuid,
  "workflow_mode" text DEFAULT 'remix'::text NOT NULL,
  "execution_target" text DEFAULT 'auto'::text NOT NULL,
  "external_tenant_id" text,
  "external_project_id" text,
  "conversation_session_id" text,
  "correlation_id" text,
  "idempotency_key" text,
  "provider" text,
  "model" text,
  "estimated_cost" numeric(12,4),
  "output_sha256" text
);
CREATE TABLE public.video_agent_projects (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "project_name" text NOT NULL,
  "client_name" text,
  "business_type" text NOT NULL,
  "business_summary" text,
  "target_audience" text,
  "offer_facts" text,
  "cta" text,
  "default_language" text DEFAULT '普通话'::text NOT NULL,
  "must_include" text,
  "must_exclude" text,
  "status" text DEFAULT 'active'::text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "learned_preferences" text DEFAULT ''::text NOT NULL,
  "external_tenant_id" text,
  "external_project_id" text
);
ALTER TABLE private.video_agent_config ADD CONSTRAINT "video_agent_config_pkey" PRIMARY KEY (key);
ALTER TABLE public.video_agent_feedback ADD CONSTRAINT "video_agent_feedback_pkey" PRIMARY KEY (id);
ALTER TABLE public.video_agent_jobs ADD CONSTRAINT "video_agent_jobs_pkey" PRIMARY KEY (id);
ALTER TABLE public.video_agent_projects ADD CONSTRAINT "video_agent_projects_pkey" PRIMARY KEY (id);
ALTER TABLE public.video_agent_jobs ADD CONSTRAINT "video_agent_jobs_execution_target_check" CHECK ((execution_target = ANY (ARRAY['auto'::text, 'local'::text, 'cloud'::text])));
ALTER TABLE public.video_agent_jobs ADD CONSTRAINT "video_agent_jobs_output_count_check" CHECK (((output_count >= 1) AND (output_count <= 3)));
ALTER TABLE public.video_agent_jobs ADD CONSTRAINT "video_agent_jobs_progress_check" CHECK (((progress >= 0) AND (progress <= 100)));
ALTER TABLE public.video_agent_jobs ADD CONSTRAINT "video_agent_jobs_status_check" CHECK ((status = ANY (ARRAY['draft'::text, 'uploading'::text, 'queued'::text, 'processing'::text, 'review'::text, 'completed'::text, 'failed'::text])));
ALTER TABLE public.video_agent_jobs ADD CONSTRAINT "video_agent_jobs_workflow_mode_check" CHECK ((workflow_mode = ANY (ARRAY['remix'::text, 'ai_hybrid'::text, 'image_poster'::text])));
ALTER TABLE public.video_agent_projects ADD CONSTRAINT "video_agent_projects_status_check" CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text])));
ALTER TABLE public.video_agent_feedback ADD CONSTRAINT "video_agent_feedback_job_id_fkey" FOREIGN KEY (job_id) REFERENCES video_agent_jobs(id) ON DELETE SET NULL;
ALTER TABLE public.video_agent_feedback ADD CONSTRAINT "video_agent_feedback_video_project_id_fkey" FOREIGN KEY (video_project_id) REFERENCES video_agent_projects(id) ON DELETE CASCADE;
ALTER TABLE public.video_agent_jobs ADD CONSTRAINT "video_agent_jobs_parent_job_id_fkey" FOREIGN KEY (parent_job_id) REFERENCES video_agent_jobs(id);
ALTER TABLE public.video_agent_jobs ADD CONSTRAINT "video_agent_jobs_video_project_id_fkey" FOREIGN KEY (video_project_id) REFERENCES video_agent_projects(id) ON DELETE RESTRICT;
CREATE INDEX video_agent_feedback_project_created_idx ON public.video_agent_feedback USING btree (video_project_id, created_at DESC);
CREATE INDEX video_agent_jobs_created_at_idx ON public.video_agent_jobs USING btree (created_at DESC);
CREATE INDEX video_agent_jobs_external_scope_created_idx ON public.video_agent_jobs USING btree (external_tenant_id, external_project_id, created_at DESC);
CREATE INDEX video_agent_jobs_parent_idx ON public.video_agent_jobs USING btree (parent_job_id);
CREATE INDEX video_agent_jobs_project_created_idx ON public.video_agent_jobs USING btree (video_project_id, created_at DESC);
CREATE INDEX video_agent_jobs_target_queue_idx ON public.video_agent_jobs USING btree (execution_target, status, created_at);
CREATE UNIQUE INDEX video_agent_jobs_tenant_idempotency_uidx ON public.video_agent_jobs USING btree (external_tenant_id, idempotency_key) WHERE ((external_tenant_id IS NOT NULL) AND (idempotency_key IS NOT NULL));
CREATE UNIQUE INDEX video_agent_one_child_per_version_idx ON public.video_agent_jobs USING btree (parent_job_id) WHERE (parent_job_id IS NOT NULL);
CREATE UNIQUE INDEX video_agent_projects_external_scope_uidx ON public.video_agent_projects USING btree (external_tenant_id, external_project_id) WHERE ((external_tenant_id IS NOT NULL) AND (external_project_id IS NOT NULL));
ALTER TABLE public.video_agent_projects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.video_agent_projects FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE private.video_agent_config FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE public.video_agent_feedback ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.video_agent_feedback FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE public.video_agent_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.video_agent_jobs FROM PUBLIC, anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION public.video_agent_accept_job(p_access text, p_job_id uuid)
 RETURNS video_agent_jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.video_agent_check_access(p_access text)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'extensions'
AS $function$
  select coalesce(
    encode(extensions.digest(convert_to(coalesce(p_access,''),'UTF8'),'sha256'),'hex')
      = (select value from private.video_agent_config where key='access_hash'),
    false
  );
$function$;

CREATE OR REPLACE FUNCTION public.video_agent_claim_cloud_job(p_access text, p_worker_id text)
 RETURNS video_agent_jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.video_agent_claim_next_job(p_access text, p_worker_id text)
 RETURNS video_agent_jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.video_agent_cloud_fallback(p_access text, p_job_id uuid, p_worker_id text, p_error_message text DEFAULT NULL::text)
 RETURNS video_agent_jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$ declare v public.video_agent_jobs; begin if not public.video_agent_check_access(p_access) then raise exception 'unauthorized' using errcode='28000'; end if; update public.video_agent_jobs set execution_target='local',status='queued',progress=5,stage='云端处理未完成，已自动转交本地工厂',error_message=right(coalesce(p_error_message,'cloud_worker_failed'),900),worker_id=null,claimed_at=null,heartbeat_at=null,updated_at=now() where id=p_job_id and status='processing' and worker_id=p_worker_id returning * into v; if v.id is null then raise exception 'job_not_claimed_by_worker'; end if; return v; end $function$;

CREATE OR REPLACE FUNCTION public.video_agent_create_job(p_access text, p_project_name text, p_brief text, p_output_count integer DEFAULT 1)
 RETURNS video_agent_jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare v public.video_agent_jobs;
begin
  if not public.video_agent_check_access(p_access) then raise exception 'unauthorized' using errcode='28000'; end if;
  if length(trim(coalesce(p_project_name,'')))=0 or length(trim(coalesce(p_brief,'')))=0 then
    raise exception 'missing_project_or_brief';
  end if;
  insert into public.video_agent_jobs(project_name,brief,output_count,status,progress,stage)
  values(trim(p_project_name),trim(p_brief),greatest(1,least(3,coalesce(p_output_count,1))),'uploading',2,'等待素材上传')
  returning * into v;
  return v;
end $function$;

CREATE OR REPLACE FUNCTION public.video_agent_create_project(p_access text, p_project_name text, p_client_name text DEFAULT NULL::text, p_business_type text DEFAULT NULL::text, p_business_summary text DEFAULT NULL::text, p_target_audience text DEFAULT NULL::text, p_offer_facts text DEFAULT NULL::text, p_cta text DEFAULT NULL::text, p_default_language text DEFAULT '普通话'::text, p_must_include text DEFAULT NULL::text, p_must_exclude text DEFAULT NULL::text)
 RETURNS video_agent_projects
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.video_agent_create_project_job(p_access text, p_video_project_id uuid, p_project_name text, p_brief text, p_output_count integer DEFAULT 1, p_workflow_mode text DEFAULT 'remix'::text)
 RETURNS video_agent_jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.video_agent_create_revision(p_access text, p_parent_job_id uuid, p_revision_prompt text, p_revision_scope text DEFAULT 'auto'::text)
 RETURNS video_agent_jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
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
    case when is_failed_retry then coalesce(p.correlation_id,p.id::text) else p.correlation_id end,
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
$function$;

CREATE OR REPLACE FUNCTION public.video_agent_get_job(p_access text, p_job_id uuid)
 RETURNS video_agent_jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare v public.video_agent_jobs;
begin
  if not public.video_agent_check_access(p_access) then raise exception 'unauthorized' using errcode='28000'; end if;
  select * into v from public.video_agent_jobs where id=p_job_id;
  if v.id is null then raise exception 'job_not_found'; end if;
  return v;
end $function$;

CREATE OR REPLACE FUNCTION public.video_agent_get_project(p_access text, p_project_id uuid)
 RETURNS video_agent_projects
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare v public.video_agent_projects;
begin
  if not public.video_agent_check_access(p_access) then
    raise exception 'unauthorized' using errcode='28000';
  end if;
  select * into v from public.video_agent_projects where id=p_project_id;
  if v.id is null then raise exception 'project_not_found'; end if;
  return v;
end
$function$;

CREATE OR REPLACE FUNCTION public.video_agent_issue_path(p_access text, p_job_id uuid, p_bucket text, p_file_name text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'extensions'
AS $function$
declare
  secret text;
  sig text;
  safe_name text;
begin
  if not public.video_agent_check_access(p_access) then raise exception 'unauthorized' using errcode='28000'; end if;
  if p_bucket not in ('video-agent-inputs','video-agent-results') then raise exception 'invalid_bucket'; end if;
  if not exists(select 1 from public.video_agent_jobs where id=p_job_id) then raise exception 'job_not_found'; end if;
  select value into secret from private.video_agent_config where key='storage_hmac_secret';
  sig := encode(extensions.hmac(convert_to(p_job_id::text || ':' || p_bucket,'UTF8'), convert_to(secret,'UTF8'),'sha256'),'hex');
  safe_name := left(regexp_replace(coalesce(p_file_name,'file'),'[^A-Za-z0-9._-]+','_','g'),120);
  if safe_name='' then safe_name:='file'; end if;
  return 'jobs/'||p_job_id::text||'/'||sig||'/'||gen_random_uuid()::text||'-'||safe_name;
end $function$;

CREATE OR REPLACE FUNCTION public.video_agent_list_jobs(p_access text)
 RETURNS SETOF video_agent_jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
begin
  if not public.video_agent_check_access(p_access) then raise exception 'unauthorized' using errcode='28000'; end if;
  return query select * from public.video_agent_jobs order by created_at desc limit 30;
end $function$;

CREATE OR REPLACE FUNCTION public.video_agent_list_project_feedback(p_access text, p_video_project_id uuid, p_limit integer DEFAULT 30)
 RETURNS SETOF video_agent_feedback
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
begin
  if not public.video_agent_check_access(p_access) then
    raise exception 'unauthorized' using errcode='28000';
  end if;
  return query select * from public.video_agent_feedback
    where video_project_id=p_video_project_id
    order by created_at desc limit greatest(1,least(100,coalesce(p_limit,30)));
end
$function$;

CREATE OR REPLACE FUNCTION public.video_agent_list_project_jobs(p_access text, p_video_project_id uuid)
 RETURNS SETOF video_agent_jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
begin
  if not public.video_agent_check_access(p_access) then
    raise exception 'unauthorized' using errcode='28000';
  end if;
  return query
    select * from public.video_agent_jobs
    where video_project_id=p_video_project_id
    order by created_at desc limit 30;
end
$function$;

CREATE OR REPLACE FUNCTION public.video_agent_list_projects(p_access text)
 RETURNS SETOF video_agent_projects
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
begin
  if not public.video_agent_check_access(p_access) then
    raise exception 'unauthorized' using errcode='28000';
  end if;
  return query
    select * from public.video_agent_projects
    where status='active'
    order by updated_at desc, created_at desc;
end
$function$;

CREATE OR REPLACE FUNCTION public.video_agent_provider_create_job(p_access text, p_tenant_id text, p_external_project_id text, p_conversation_session_id text, p_correlation_id text, p_idempotency_key text, p_brief text, p_workflow_mode text DEFAULT 'ai_hybrid'::text, p_output_count integer DEFAULT 1, p_provider text DEFAULT NULL::text, p_model text DEFAULT NULL::text, p_estimated_cost numeric DEFAULT NULL::numeric)
 RETURNS video_agent_jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.video_agent_provider_get_job(p_access text, p_tenant_id text, p_external_project_id text, p_job_id uuid)
 RETURNS video_agent_jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare v public.video_agent_jobs;
begin
  if not public.video_agent_check_access(p_access) then raise exception 'unauthorized' using errcode='28000'; end if;
  select * into v from public.video_agent_jobs
    where id=p_job_id and external_tenant_id=trim(p_tenant_id) and external_project_id=trim(p_external_project_id);
  if v.id is null then raise exception 'job_not_found_in_tenant'; end if;
  return v;
end
$function$;

CREATE OR REPLACE FUNCTION public.video_agent_provider_upsert_project(p_access text, p_tenant_id text, p_external_project_id text, p_project_name text, p_client_name text DEFAULT NULL::text, p_business_type text DEFAULT NULL::text, p_business_summary text DEFAULT NULL::text, p_target_audience text DEFAULT NULL::text, p_offer_facts text DEFAULT NULL::text, p_cta text DEFAULT NULL::text, p_default_language text DEFAULT '普通话'::text, p_must_include text DEFAULT NULL::text, p_must_exclude text DEFAULT NULL::text)
 RETURNS video_agent_projects
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.video_agent_record_feedback(p_access text, p_video_project_id uuid, p_job_id uuid DEFAULT NULL::uuid, p_actor_id text DEFAULT 'employee'::text, p_event_type text DEFAULT 'operation'::text, p_content text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS video_agent_feedback
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.video_agent_requeue_stale(p_access text, p_stale_minutes integer DEFAULT 30)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare n integer;
begin
  if not public.video_agent_check_access(p_access) then raise exception 'unauthorized' using errcode='28000'; end if;

  with stale as (
    update public.video_agent_jobs
       set status=case when attempt_count < 3 then 'queued' else 'failed' end,
           progress=case when attempt_count < 3 then 5 else progress end,
           stage=case when attempt_count < 3 then '执行端中断，已自动重新排队' else '执行端连续失败，请检查' end,
           error_message=case when attempt_count < 3 then null else coalesce(error_message,'worker stale timeout') end,
           worker_id=null,
           claimed_at=null,
           heartbeat_at=null,
           updated_at=now()
     where status='processing'
       and heartbeat_at is not null
       and heartbeat_at < now() - make_interval(mins=>greatest(1,p_stale_minutes))
     returning 1
  )
  select count(*) into n from stale;

  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.video_agent_route_new_job()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if new.workflow_mode in ('image_poster','ai_hybrid','remix') then
    new.execution_target := 'cloud';
  end if;
  return new;
end
$function$;

CREATE OR REPLACE FUNCTION public.video_agent_submit_job(p_access text, p_job_id uuid, p_input_files jsonb)
 RETURNS video_agent_jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.video_agent_update_project(p_access text, p_project_id uuid, p_project_name text, p_client_name text DEFAULT NULL::text, p_business_type text DEFAULT NULL::text, p_business_summary text DEFAULT NULL::text, p_target_audience text DEFAULT NULL::text, p_offer_facts text DEFAULT NULL::text, p_cta text DEFAULT NULL::text, p_default_language text DEFAULT '普通话'::text, p_must_include text DEFAULT NULL::text, p_must_exclude text DEFAULT NULL::text)
 RETURNS video_agent_projects
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.video_agent_valid_storage_path(p_bucket text, p_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'extensions'
AS $function$
declare
  parts text[];
  secret text;
  expected text;
  jid uuid;
begin
  if p_bucket not in ('video-agent-inputs','video-agent-results') then return false; end if;
  parts := string_to_array(p_name,'/');
  if array_length(parts,1) <> 4 or parts[1] <> 'jobs' then return false; end if;
  begin jid := parts[2]::uuid; exception when others then return false; end;
  if not exists(select 1 from public.video_agent_jobs where id=jid) then return false; end if;
  select value into secret from private.video_agent_config where key='storage_hmac_secret';
  expected := encode(extensions.hmac(convert_to(jid::text || ':' || p_bucket,'UTF8'), convert_to(secret,'UTF8'),'sha256'),'hex');
  return parts[3]=expected;
end $function$;

CREATE OR REPLACE FUNCTION public.video_agent_worker_checkpoint_asset(p_access text, p_job_id uuid, p_worker_id text, p_asset jsonb)
 RETURNS video_agent_jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
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
    -- A real revision inherits old generated shots. Replace an inherited shot
    -- only, never a checkpoint already written by this job or an uploaded asset.
    if existing->'generation' is null or existing->>'path' like 'jobs/'||p_job_id::text||'/%' then
      raise exception 'checkpoint_role_already_exists';
    end if;
  end if;
  update public.video_agent_jobs set input_files=coalesce((
      select jsonb_agg(item) from jsonb_array_elements(coalesce(input_files,'[]'::jsonb)) as item where item->>'role' is distinct from asset_role
    ),'[]'::jsonb)||jsonb_build_array(p_asset), updated_at=now()
    where id=p_job_id returning * into v;
  return v;
end
$function$;

CREATE OR REPLACE FUNCTION public.video_agent_worker_heartbeat(p_access text, p_job_id uuid, p_worker_id text, p_stage text DEFAULT NULL::text, p_progress integer DEFAULT NULL::integer)
 RETURNS video_agent_jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare v public.video_agent_jobs;
begin
  if not public.video_agent_check_access(p_access) then raise exception 'unauthorized' using errcode='28000'; end if;

  update public.video_agent_jobs
     set heartbeat_at=now(),
         stage=coalesce(p_stage,stage),
         progress=coalesce(p_progress,progress),
         updated_at=now()
   where id=p_job_id and worker_id=p_worker_id and status='processing'
   returning * into v;

  return v;
end $function$;

CREATE OR REPLACE FUNCTION public.video_agent_worker_set_artifact_metadata(p_access text, p_job_id uuid, p_worker_id text, p_output_sha256 text)
 RETURNS video_agent_jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.video_agent_worker_update(p_access text, p_job_id uuid, p_status text DEFAULT NULL::text, p_progress integer DEFAULT NULL::integer, p_stage text DEFAULT NULL::text, p_output_files jsonb DEFAULT NULL::jsonb, p_error_message text DEFAULT NULL::text)
 RETURNS video_agent_jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare v public.video_agent_jobs;
begin
  if not public.video_agent_check_access(p_access) then raise exception 'unauthorized' using errcode='28000'; end if;
  update public.video_agent_jobs
  set status=coalesce(p_status,status),
      progress=coalesce(p_progress,progress),
      stage=coalesce(p_stage,stage),
      output_files=coalesce(p_output_files,output_files),
      error_message=coalesce(p_error_message,error_message),
      updated_at=now()
  where id=p_job_id returning * into v;
  if v.id is null then raise exception 'job_not_found'; end if;
  return v;
end $function$;

CREATE TRIGGER video_agent_route_new_job_trigger BEFORE INSERT ON public.video_agent_jobs FOR EACH ROW EXECUTE FUNCTION video_agent_route_new_job();
REVOKE ALL ON FUNCTION public.video_agent_accept_job(p_access text, p_job_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_agent_accept_job(p_access text, p_job_id uuid) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.video_agent_check_access(p_access text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_agent_check_access(p_access text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.video_agent_claim_cloud_job(p_access text, p_worker_id text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_agent_claim_cloud_job(p_access text, p_worker_id text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.video_agent_claim_next_job(p_access text, p_worker_id text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_agent_claim_next_job(p_access text, p_worker_id text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.video_agent_cloud_fallback(p_access text, p_job_id uuid, p_worker_id text, p_error_message text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_agent_cloud_fallback(p_access text, p_job_id uuid, p_worker_id text, p_error_message text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.video_agent_create_job(p_access text, p_project_name text, p_brief text, p_output_count integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_agent_create_job(p_access text, p_project_name text, p_brief text, p_output_count integer) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.video_agent_create_project(p_access text, p_project_name text, p_client_name text, p_business_type text, p_business_summary text, p_target_audience text, p_offer_facts text, p_cta text, p_default_language text, p_must_include text, p_must_exclude text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_agent_create_project(p_access text, p_project_name text, p_client_name text, p_business_type text, p_business_summary text, p_target_audience text, p_offer_facts text, p_cta text, p_default_language text, p_must_include text, p_must_exclude text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.video_agent_create_project_job(p_access text, p_video_project_id uuid, p_project_name text, p_brief text, p_output_count integer, p_workflow_mode text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_agent_create_project_job(p_access text, p_video_project_id uuid, p_project_name text, p_brief text, p_output_count integer, p_workflow_mode text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.video_agent_create_revision(p_access text, p_parent_job_id uuid, p_revision_prompt text, p_revision_scope text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_agent_create_revision(p_access text, p_parent_job_id uuid, p_revision_prompt text, p_revision_scope text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.video_agent_get_job(p_access text, p_job_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_agent_get_job(p_access text, p_job_id uuid) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.video_agent_get_project(p_access text, p_project_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_agent_get_project(p_access text, p_project_id uuid) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.video_agent_issue_path(p_access text, p_job_id uuid, p_bucket text, p_file_name text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_agent_issue_path(p_access text, p_job_id uuid, p_bucket text, p_file_name text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.video_agent_list_jobs(p_access text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_agent_list_jobs(p_access text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.video_agent_list_project_feedback(p_access text, p_video_project_id uuid, p_limit integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_agent_list_project_feedback(p_access text, p_video_project_id uuid, p_limit integer) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.video_agent_list_project_jobs(p_access text, p_video_project_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_agent_list_project_jobs(p_access text, p_video_project_id uuid) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.video_agent_list_projects(p_access text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_agent_list_projects(p_access text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.video_agent_provider_create_job(p_access text, p_tenant_id text, p_external_project_id text, p_conversation_session_id text, p_correlation_id text, p_idempotency_key text, p_brief text, p_workflow_mode text, p_output_count integer, p_provider text, p_model text, p_estimated_cost numeric) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_agent_provider_create_job(p_access text, p_tenant_id text, p_external_project_id text, p_conversation_session_id text, p_correlation_id text, p_idempotency_key text, p_brief text, p_workflow_mode text, p_output_count integer, p_provider text, p_model text, p_estimated_cost numeric) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.video_agent_provider_get_job(p_access text, p_tenant_id text, p_external_project_id text, p_job_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_agent_provider_get_job(p_access text, p_tenant_id text, p_external_project_id text, p_job_id uuid) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.video_agent_provider_upsert_project(p_access text, p_tenant_id text, p_external_project_id text, p_project_name text, p_client_name text, p_business_type text, p_business_summary text, p_target_audience text, p_offer_facts text, p_cta text, p_default_language text, p_must_include text, p_must_exclude text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_agent_provider_upsert_project(p_access text, p_tenant_id text, p_external_project_id text, p_project_name text, p_client_name text, p_business_type text, p_business_summary text, p_target_audience text, p_offer_facts text, p_cta text, p_default_language text, p_must_include text, p_must_exclude text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.video_agent_record_feedback(p_access text, p_video_project_id uuid, p_job_id uuid, p_actor_id text, p_event_type text, p_content text, p_metadata jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_agent_record_feedback(p_access text, p_video_project_id uuid, p_job_id uuid, p_actor_id text, p_event_type text, p_content text, p_metadata jsonb) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.video_agent_requeue_stale(p_access text, p_stale_minutes integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_agent_requeue_stale(p_access text, p_stale_minutes integer) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.video_agent_route_new_job() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.video_agent_submit_job(p_access text, p_job_id uuid, p_input_files jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_agent_submit_job(p_access text, p_job_id uuid, p_input_files jsonb) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.video_agent_update_project(p_access text, p_project_id uuid, p_project_name text, p_client_name text, p_business_type text, p_business_summary text, p_target_audience text, p_offer_facts text, p_cta text, p_default_language text, p_must_include text, p_must_exclude text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_agent_update_project(p_access text, p_project_id uuid, p_project_name text, p_client_name text, p_business_type text, p_business_summary text, p_target_audience text, p_offer_facts text, p_cta text, p_default_language text, p_must_include text, p_must_exclude text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.video_agent_valid_storage_path(p_bucket text, p_name text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_agent_valid_storage_path(p_bucket text, p_name text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.video_agent_worker_checkpoint_asset(p_access text, p_job_id uuid, p_worker_id text, p_asset jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_agent_worker_checkpoint_asset(p_access text, p_job_id uuid, p_worker_id text, p_asset jsonb) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.video_agent_worker_heartbeat(p_access text, p_job_id uuid, p_worker_id text, p_stage text, p_progress integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_agent_worker_heartbeat(p_access text, p_job_id uuid, p_worker_id text, p_stage text, p_progress integer) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.video_agent_worker_set_artifact_metadata(p_access text, p_job_id uuid, p_worker_id text, p_output_sha256 text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_agent_worker_set_artifact_metadata(p_access text, p_job_id uuid, p_worker_id text, p_output_sha256 text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.video_agent_worker_update(p_access text, p_job_id uuid, p_status text, p_progress integer, p_stage text, p_output_files jsonb, p_error_message text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_agent_worker_update(p_access text, p_job_id uuid, p_status text, p_progress integer, p_stage text, p_output_files jsonb, p_error_message text) TO anon, authenticated;
-- private.video_agent_config intentionally has ZERO rows. Authentication fails closed.
