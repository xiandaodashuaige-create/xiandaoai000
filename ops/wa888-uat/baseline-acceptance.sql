-- Execute only in a disposable local cluster; all synthetic rows roll back.
BEGIN;
DO $$ BEGIN
 IF public.video_agent_check_access('synthetic-local-only') THEN RAISE EXCEPTION 'empty config authenticated'; END IF;
END $$;
INSERT INTO private.video_agent_config(key,value)
VALUES ('access_hash',encode(extensions.digest('synthetic-local-only','sha256'),'hex'));
DO $test$
DECLARE
 p public.video_agent_projects;
 j public.video_agent_jobs;
 recovered public.video_agent_jobs;
 replayed public.video_agent_jobs;
 k text := 'vpr1_' || repeat('a',64);
 n bigint;
BEGIN
 p := public.video_agent_provider_upsert_project(
  p_access=>'synthetic-local-only',p_tenant_id=>'wa888-synthetic-tenant',p_external_project_id=>'wa888-synthetic-project',
  p_project_name=>'WA888 synthetic test only',p_client_name=>'TEST ONLY',p_business_type=>'UAT',
  p_business_summary=>'No customer facts or provider work',p_target_audience=>'synthetic',p_offer_facts=>'',
  p_cta=>'test only',p_default_language=>'English',p_must_include=>'',p_must_exclude=>'customer sends');
 j := public.video_agent_provider_create_job(
  p_access=>'synthetic-local-only',p_tenant_id=>'wa888-synthetic-tenant',p_external_project_id=>'wa888-synthetic-project',
  p_conversation_session_id=>'wa888-synthetic-session',p_correlation_id=>'wa888-synthetic-correlation',p_idempotency_key=>k,
  p_brief=>'Synthetic draft, never submit',p_workflow_mode=>'image_poster',p_output_count=>1,p_estimated_cost=>0);
 IF j.status <> 'uploading' THEN RAISE EXCEPTION 'test job not unsubmitted'; END IF;
 recovered := public.video_agent_provider_find_operation('synthetic-local-only','wa888-synthetic-tenant','wa888-synthetic-project','wa888-synthetic-session','wa888-synthetic-correlation',k);
 IF recovered.id IS DISTINCT FROM j.id THEN RAISE EXCEPTION 'original operation recovery failed'; END IF;
 recovered := public.video_agent_provider_find_operation('synthetic-local-only','foreign','wa888-synthetic-project','wa888-synthetic-session','wa888-synthetic-correlation',k);
 IF recovered.id IS NOT NULL THEN RAISE EXCEPTION 'cross-tenant disclosure'; END IF;
 recovered := public.video_agent_provider_find_operation('synthetic-local-only','wa888-synthetic-tenant','foreign','wa888-synthetic-session','wa888-synthetic-correlation',k);
 IF recovered.id IS NOT NULL THEN RAISE EXCEPTION 'cross-project disclosure'; END IF;
 recovered := public.video_agent_provider_find_operation('synthetic-local-only','wa888-synthetic-tenant','wa888-synthetic-project','foreign','wa888-synthetic-correlation',k);
 IF recovered.id IS NOT NULL THEN RAISE EXCEPTION 'cross-session disclosure'; END IF;
 recovered := public.video_agent_provider_find_operation('synthetic-local-only','wa888-synthetic-tenant','wa888-synthetic-project','wa888-synthetic-session','foreign',k);
 IF recovered.id IS NOT NULL THEN RAISE EXCEPTION 'cross-correlation disclosure'; END IF;
 recovered := public.video_agent_provider_find_operation('synthetic-local-only','wa888-synthetic-tenant','wa888-synthetic-project','wa888-synthetic-session','wa888-synthetic-correlation','vpr1_'||repeat('b',64));
 IF recovered.id IS NOT NULL THEN RAISE EXCEPTION 'unknown operation invented'; END IF;
 BEGIN
  PERFORM public.video_agent_provider_find_operation('wrong','wa888-synthetic-tenant','wa888-synthetic-project','wa888-synthetic-session','wa888-synthetic-correlation',k);
  RAISE EXCEPTION 'wrong access accepted';
 EXCEPTION WHEN invalid_authorization_specification THEN NULL; END;
 BEGIN
  PERFORM public.video_agent_provider_find_operation('synthetic-local-only','wa888-synthetic-tenant','wa888-synthetic-project','wa888-synthetic-session','wa888-synthetic-correlation','bad');
  RAISE EXCEPTION 'malformed key accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 SELECT count(*) INTO n FROM public.video_agent_jobs;
 replayed := public.video_agent_provider_create_job(
  p_access=>'synthetic-local-only',p_tenant_id=>'wa888-synthetic-tenant',p_external_project_id=>'wa888-synthetic-project',
  p_conversation_session_id=>'wa888-synthetic-session',p_correlation_id=>'wa888-synthetic-correlation',p_idempotency_key=>k,
  p_brief=>'Synthetic draft, never submit',p_workflow_mode=>'image_poster',p_output_count=>1,p_estimated_cost=>0);
 IF replayed.id IS DISTINCT FROM j.id OR (SELECT count(*) FROM public.video_agent_jobs) <> n THEN RAISE EXCEPTION 'duplicate job on replay'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.video_agent_provider_find_operation(text,text,text,text,text,text)'::regprocedure AND provolatile='s' AND prosecdef) THEN RAISE EXCEPTION 'lookup volatility/security changed'; END IF;
END $test$;
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN PERFORM 1 FROM public.video_agent_jobs; RAISE EXCEPTION 'anon table read allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'WA888 real-schema bootstrap + exact lookup boundary tests PASS' AS result;
