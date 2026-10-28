do $$
declare rows_seen integer := 0; n integer; cursor_at timestamptz; cursor_id uuid; r record;
begin
  if has_function_privilege('library_unprivileged','public.video_agent_provider_list_accepted_images(text,text,text,timestamptz,uuid)','execute') then
    raise exception 'PUBLIC_EXECUTE_LEAK';
  end if;
  begin
    perform * from public.video_agent_provider_list_accepted_images(null,'tenant-a','project-a');
    raise exception 'NULL_ACCESS_ALLOWED';
  exception when sqlstate '28000' then null; end;
  begin
    perform * from public.video_agent_provider_list_accepted_images('wrong','tenant-a','project-a');
    raise exception 'WRONG_ACCESS_ALLOWED';
  exception when sqlstate '28000' then null; end;
  begin
    perform * from public.video_agent_provider_list_accepted_images('fixture-access','tenant-a','project-a',now(),null);
    raise exception 'HALF_CURSOR_ALLOWED';
  exception when sqlstate '22023' then null; end;
  select count(*) into n from public.video_agent_provider_list_accepted_images('fixture-access','tenant-b','project-a');
  if n <> 0 then raise exception 'CROSS_TENANT_LEAK'; end if;
  select count(*) into n from public.video_agent_provider_list_accepted_images('fixture-access','tenant-a','project-b');
  if n <> 0 then raise exception 'CROSS_PROJECT_LEAK'; end if;
  loop
    n := 0;
    for r in select * from public.video_agent_provider_list_accepted_images('fixture-access','tenant-a','project-a',cursor_at,cursor_id) limit 30 loop
      if r.status <> 'completed' or r.accepted_at is null or r.output_files->0->>'path' <> 'poster.jpg' then raise exception 'UNCONFIRMED_OR_VIDEO'; end if;
      if cursor_at is not null and (r.accepted_at,r.id) >= (cursor_at,cursor_id) then raise exception 'PAGE_ORDER_OR_DUPLICATE'; end if;
      cursor_at := r.accepted_at; cursor_id := r.id; n := n + 1; rows_seen := rows_seen + 1;
    end loop;
    exit when n < 30;
    if rows_seen > 100 then raise exception 'INFINITE_PAGINATION'; end if;
  end loop;
  if rows_seen <> 75 then raise exception 'OLDER_IMAGES_MISSING: %',rows_seen; end if;
  select count(*) into n from public.video_agent_jobs;
  if n <> 79 then raise exception 'READ_CHANGED_DATA'; end if;
end $$;
-- Actual anonymous role can only call the secret-guarded function, not read tables.
set role anon;
select count(*) = 31 as anon_scoped_read_pass
from public.video_agent_provider_list_accepted_images('fixture-access','tenant-a','project-a');
reset role;
-- A disabled provider project is excluded even if its accepted rows remain.
update public.video_agent_projects set status='disabled' where external_tenant_id='tenant-a';
do $$ begin
 if exists(select 1 from public.video_agent_provider_list_accepted_images('fixture-access','tenant-a','project-a')) then raise exception 'DISABLED_PROJECT_LEAK'; end if;
end $$;
