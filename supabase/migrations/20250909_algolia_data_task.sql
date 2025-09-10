-- Algolia Data Ingestion RunTask depuis Postgres (pg_net), région EU par défaut

create extension if not exists pg_net;

-- Variables d'environnement DB (placeholder). Remplacer par Vault si disponible
-- Ces GUC peuvent être mises à jour via: ALTER DATABASE ... SET app.algolia_app_id = '...'
do $$ begin
  perform current_setting('app.algolia_app_id', true);
exception when others then
  perform set_config('app.algolia_app_id', '', true);
end $$;

do $$ begin
  perform current_setting('app.algolia_admin_key', true);
exception when others then
  perform set_config('app.algolia_admin_key', '', true);
end $$;

create or replace function public.run_algolia_data_task(
  p_task_id uuid,
  p_region text default 'eu'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app_id text := nullif(current_setting('app.algolia_app_id', true), '');
  v_admin_key text := nullif(current_setting('app.algolia_admin_key', true), '');
  v_region text := coalesce(lower(p_region), 'eu');
  v_host text := case v_region when 'eu' then 'https://data.eu.algolia.com' else 'https://data.us.algolia.com' end;
  v_url text := v_host || '/2/tasks/' || p_task_id || '/run';
  v_resp jsonb;
begin
  if v_app_id is null or v_admin_key is null then
    raise exception 'Algolia credentials missing in DB settings';
  end if;

  select content::jsonb into v_resp
  from net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'x-algolia-application-id', v_app_id,
      'x-algolia-api-key', v_admin_key,
      'accept', 'application/json',
      'content-type', 'application/json'
    ),
    body := jsonb_build_object('runMetadata', jsonb_build_object()),
    timeout_milliseconds := 60000
  );

  insert into audit_logs(user_id, action, details)
  values (null, 'algolia_run_data_task', jsonb_build_object('task_id', p_task_id, 'region', v_region, 'response', v_resp));

  return v_resp;
end $$;


