-- Paginate confirmed customer images independently of recent generation jobs.
-- This provider uses its existing access-secret boundary (not end-user JWTs).
-- Definer is needed because anon/authenticated cannot read the private job tables.
create or replace function public.video_agent_provider_list_accepted_images(
  p_access text,
  p_tenant_id text,
  p_external_project_id text,
  p_before_at timestamptz default null,
  p_before_id uuid default null
)
returns setof public.video_agent_jobs
language plpgsql security definer set search_path = ''
as $$
begin
  if public.video_agent_check_access(p_access) is distinct from true then
    raise exception 'unauthorized' using errcode = '28000';
  end if;
  if nullif(btrim(p_tenant_id), '') is null
     or nullif(btrim(p_external_project_id), '') is null
     or ((p_before_at is null) <> (p_before_id is null)) then
    raise exception 'invalid_library_scope' using errcode = '22023';
  end if;
  return query
    select j.*
    from public.video_agent_jobs j
    join public.video_agent_projects p on p.id = j.video_project_id
      and p.external_tenant_id = j.external_tenant_id
      and p.external_project_id = j.external_project_id and p.status = 'active'
    where j.external_tenant_id = p_tenant_id
      and j.external_project_id = p_external_project_id
      and j.status = 'completed' and j.accepted_at is not null
      and j.output_sha256 ~* '^[a-f0-9]{64}$'
      and jsonb_typeof(j.output_files) = 'array'
      and (j.output_files->0->>'path') ~* '\.(png|jpe?g|webp)$'
      and (nullif(j.output_files->0->>'type', '') is null
        or (j.output_files->0->>'type') ~* '^image/(png|jpeg|webp)$')
      and (p_before_at is null or (j.accepted_at, j.id) < (p_before_at, p_before_id))
    order by j.accepted_at desc, j.id desc
    limit 31;
end
$$;
revoke all on function public.video_agent_provider_list_accepted_images(text,text,text,timestamptz,uuid) from public;
grant execute on function public.video_agent_provider_list_accepted_images(text,text,text,timestamptz,uuid) to anon, authenticated;
