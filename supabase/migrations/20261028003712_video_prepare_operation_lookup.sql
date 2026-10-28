-- Exact, read-only recovery of an existing v1 operation; no new ledger.
-- Provider access is its existing server-only credential, not a browser JWT.
create or replace function public.video_agent_provider_find_operation(
  p_access text, p_tenant_id text, p_external_project_id text,
  p_conversation_session_id text, p_correlation_id text, p_idempotency_key text
)
returns public.video_agent_jobs
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v public.video_agent_jobs;
begin
  if public.video_agent_check_access(p_access) is not true then
    raise exception 'unauthorized' using errcode = '28000';
  end if;
  if p_tenant_id is null or p_external_project_id is null or
     p_conversation_session_id is null or p_correlation_id is null or p_idempotency_key is null or
     p_tenant_id !~ '^[^[:space:][:cntrl:]]{1,128}$' or
     p_external_project_id !~ '^[^[:space:][:cntrl:]]{1,128}$' or
     p_conversation_session_id !~ '^[^[:space:][:cntrl:]]{1,128}$' or
     p_correlation_id !~ '^[^[:space:][:cntrl:]]{1,128}$' or
     p_idempotency_key !~ '^vpr1_[0-9a-f]{64}$' then
    raise exception 'invalid_operation_scope' using errcode = '22023';
  end if;
  select j.* into v from public.video_agent_jobs j
  where j.external_tenant_id = p_tenant_id
    and j.external_project_id = p_external_project_id
    and j.conversation_session_id = p_conversation_session_id
    and j.correlation_id = p_correlation_id
    and j.idempotency_key = p_idempotency_key;
  if not found then return null; end if;
  return v;
end
$$;
revoke all on function public.video_agent_provider_find_operation(text,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.video_agent_provider_find_operation(text,text,text,text,text,text) to anon, authenticated;
comment on function public.video_agent_provider_find_operation(text,text,text,text,text,text) is
'Read only: exact actor-bound v1 operation; null is UNKNOWN and never permission to create another job.';
