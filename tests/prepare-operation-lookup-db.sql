begin read only;
set local role anon;
do $$
declare j public.video_agent_jobs;
declare args text[];
begin
  j := public.video_agent_provider_find_operation('fixture-access','tenant-a','project-a','session-a','correlation-a','vpr1_'||repeat('a',64));
  if j.id is distinct from '10000000-0000-0000-0000-000000000001'::uuid or j.status <> 'uploading' then raise exception 'original job not found'; end if;
  foreach args slice 1 in array array[
    array['tenant-b','project-a','session-a','correlation-a','vpr1_'||repeat('a',64)],
    array['tenant-a','project-b','session-a','correlation-a','vpr1_'||repeat('a',64)],
    array['tenant-a','project-a','session-b','correlation-a','vpr1_'||repeat('a',64)],
    array['tenant-a','project-a','session-a','correlation-b','vpr1_'||repeat('a',64)],
    array['tenant-a','project-a','session-a','correlation-a','vpr1_'||repeat('b',64)]
  ] loop
    j := public.video_agent_provider_find_operation('fixture-access',args[1],args[2],args[3],args[4],args[5]);
    if j.id is not null then raise exception 'foreign operation exposed'; end if;
  end loop;
  begin
    perform public.video_agent_provider_find_operation('wrong','tenant-a','project-a','session-a','correlation-a','vpr1_'||repeat('a',64));
    raise exception 'bad access accepted';
  exception when invalid_authorization_specification then null;
  end;
  begin
    perform public.video_agent_provider_find_operation(null,'tenant-a','project-a','session-a','correlation-a','vpr1_'||repeat('a',64));
    raise exception 'null access accepted';
  exception when invalid_authorization_specification then null;
  end;
  begin
    perform public.video_agent_provider_find_operation('fixture-access',' tenant-a ','project-a','session-a','correlation-a','vpr1_'||repeat('a',64));
    raise exception 'scope was silently trimmed';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.video_agent_provider_find_operation('fixture-access','tenant-a','project-a','session-a','correlation-a','legacy-key');
    raise exception 'unbound legacy key accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform count(*) from public.video_agent_jobs;
    raise exception 'anon can read the table directly';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set local role authenticated;
select (public.video_agent_provider_find_operation('fixture-access','tenant-b','project-b','session-b','correlation-b','vpr1_'||repeat('b',64))).id as authenticated_original;
reset role;
set local role operation_unprivileged;
do $$ begin
  begin
    perform public.video_agent_provider_find_operation('fixture-access','tenant-a','project-a','session-a','correlation-a','vpr1_'||repeat('a',64));
    raise exception 'unprivileged role has execute';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$
declare p record;
begin
  select * into p from pg_proc where oid='public.video_agent_provider_find_operation(text,text,text,text,text,text)'::regprocedure;
  if p.provolatile <> 's' or not p.prosecdef or p.proconfig <> array['search_path=""'] then raise exception 'unsafe function configuration'; end if;
  if exists (select 1 from aclexplode(p.proacl) where grantee=0 and privilege_type='EXECUTE') then raise exception 'PUBLIC execute leaked'; end if;
  if (select count(*) from public.video_agent_jobs) <> 2 then raise exception 'lookup mutated jobs'; end if;
end $$;
select 'PASS exact/null/access/scope/role/read-only/replay' as acceptance;
rollback;
