-- Users batch-only flow: staging, batch projection, functions override
begin;

-- 1) STAGING USERS (éphémère par import)
create table if not exists public.staging_user_imports (
  import_id uuid not null,
  workspace_id uuid not null,
  dataset_name text not null,
  -- colonnes CSV 1:1 (texte)
  "ID" text,
  "Nom" text,
  "Nom_en" text,
  "Description" text,
  "Description_en" text,
  "FE" text,
  "Unité donnée d'activité" text,
  "Unite_en" text,
  "Source" text,
  "Secteur" text,
  "Secteur_en" text,
  "Sous-secteur" text,
  "Sous-secteur_en" text,
  "Localisation" text,
  "Localisation_en" text,
  "Date" text,
  "Incertitude" text,
  "Périmètre" text,
  "Périmètre_en" text,
  "Contributeur" text,
  "Commentaires" text,
  "Commentaires_en" text,
  created_at timestamptz not null default now()
);
create index if not exists idx_staging_user_imports_ws_ds on public.staging_user_imports(workspace_id, dataset_name);
create index if not exists idx_staging_user_imports_import on public.staging_user_imports(import_id);

-- 2) PROJECTION BATCH POUR ALGOLIA (records du batch uniquement)
create table if not exists public.user_batch_algolia (
  workspace_id uuid not null,
  dataset_name text not null,
  object_id uuid not null default gen_random_uuid(),
  record_id uuid not null default gen_random_uuid(),
  scope text not null default 'private',
  access_level text default 'standard',
  languages text[],
  "Nom_fr" text,
  "Description_fr" text,
  "Commentaires_fr" text,
  "Secteur_fr" text,
  "Sous-secteur_fr" text,
  "Périmètre_fr" text,
  "Localisation_fr" text,
  "Unite_fr" text,
  "Nom_en" text,
  "Description_en" text,
  "Commentaires_en" text,
  "Secteur_en" text,
  "Sous-secteur_en" text,
  "Périmètre_en" text,
  "Localisation_en" text,
  "Unite_en" text,
  "FE" numeric,
  "Date" integer,
  "Incertitude" text,
  "Source" text not null,
  updated_at timestamptz not null default now()
);
create index if not exists idx_user_batch_algolia_ws_ds on public.user_batch_algolia(workspace_id, dataset_name);

-- 3) PREPARE BATCH PROJECTION
create or replace function public.prepare_user_batch_projection(
  p_workspace_id uuid,
  p_dataset_name text
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
begin
  if p_workspace_id is null or coalesce(trim(p_dataset_name),'') = '' then
    raise exception 'workspace_id et dataset_name requis';
  end if;

  -- Purge préalable éventuelle du batch cible
  delete from public.user_batch_algolia where workspace_id = p_workspace_id and dataset_name = p_dataset_name;

  insert into public.user_batch_algolia (
    workspace_id, dataset_name, scope, access_level, languages,
    "Nom_fr","Description_fr","Commentaires_fr","Secteur_fr","Sous-secteur_fr","Périmètre_fr","Localisation_fr","Unite_fr",
    "Nom_en","Description_en","Commentaires_en","Secteur_en","Sous-secteur_en","Périmètre_en","Localisation_en","Unite_en",
    "FE","Date","Incertitude","Source"
  )
  select
    sui.workspace_id,
    sui.dataset_name,
    'private' as scope,
    coalesce(fs.access_level, 'standard') as access_level,
    array_remove(array[
      case when (sui."Nom" is not null or sui."Description" is not null or sui."Unité donnée d'activité" is not null or sui."Secteur" is not null or sui."Localisation" is not null) then 'fr' end,
      case when (sui."Nom_en" is not null or sui."Description_en" is not null or sui."Unite_en" is not null or sui."Secteur_en" is not null or sui."Localisation_en" is not null) then 'en' end
    ], null)::text[] as languages,
    sui."Nom" as "Nom_fr",
    sui."Description" as "Description_fr",
    sui."Commentaires" as "Commentaires_fr",
    sui."Secteur" as "Secteur_fr",
    sui."Sous-secteur" as "Sous-secteur_fr",
    sui."Périmètre" as "Périmètre_fr",
    sui."Localisation" as "Localisation_fr",
    sui."Unité donnée d'activité" as "Unite_fr",
    sui."Nom_en",
    sui."Description_en",
    sui."Commentaires_en",
    sui."Secteur_en",
    sui."Sous-secteur_en",
    sui."Périmètre_en",
    sui."Localisation_en",
    sui."Unite_en",
    public.safe_to_numeric(nullif(sui."FE",'')) as "FE",
    case when trim(coalesce(sui."Date",'')) ~ '^\d+$' then trim(sui."Date")::int else null end as "Date",
    sui."Incertitude",
    coalesce(nullif(sui."Source",''), sui.dataset_name) as "Source"
  from public.staging_user_imports sui
  left join public.fe_sources fs on fs.source_name = coalesce(nullif(sui."Source",''), sui.dataset_name)
  where sui.workspace_id = p_workspace_id and sui.dataset_name = p_dataset_name;

  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- 4) RUN TASK OVERRIDE (batch-only)
create or replace function public.run_algolia_data_task_override(
  p_task_id uuid,
  p_region text,
  p_workspace_id uuid,
  p_dataset_name text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app_id text := current_setting('app.algolia_app_id', true);
  v_admin_key text := current_setting('app.algolia_admin_key', true);
  v_host text := case lower(coalesce(p_region,'eu')) when 'us' then 'https://data.us.algolia.com' else 'https://data.eu.algolia.com' end;
  v_url text := v_host || '/2/tasks/'||p_task_id||'/run';
  v_query text := format('SELECT * FROM public.user_batch_algolia WHERE workspace_id = ''%s'' AND dataset_name = %L', p_workspace_id, p_dataset_name);
  v_payload jsonb := jsonb_build_object('runMetadata', jsonb_build_object('parametersOverride', jsonb_build_object('source', jsonb_build_object('type','postgresql','options', jsonb_build_object('query', v_query)))));
  v_resp jsonb;
begin
  if v_app_id is null or v_admin_key is null then
    raise exception 'Algolia credentials are missing';
  end if;
  select content::jsonb into v_resp
  from net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'X-Algolia-Application-Id', v_app_id,
      'X-Algolia-API-Key', v_admin_key,
      'Content-Type','application/json',
      'Accept','application/json'
    ),
    body := v_payload,
    timeout_milliseconds := 60000
  );
  insert into audit_logs(user_id, action, details)
  values (null, 'algolia_run_data_task_override', jsonb_build_object('task_id', p_task_id, 'region', p_region, 'workspace_id', p_workspace_id, 'dataset_name', p_dataset_name, 'response', v_resp));
  return v_resp;
end $$;

-- 5) FINALIZE USER IMPORT (upsert overlays + cleanup)
create or replace function public.finalize_user_import(
  p_workspace_id uuid,
  p_dataset_name text,
  p_import_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows int := 0;
  v_result jsonb := '{}'::jsonb;
begin
  -- Historiser dans overlays via RPC existante
  v_result := public.batch_upsert_user_factor_overlays(
    p_workspace_id,
    p_dataset_name,
    (
      select jsonb_agg(to_jsonb(sui) - 'created_at')
      from public.staging_user_imports sui
      where sui.workspace_id = p_workspace_id and sui.dataset_name = p_dataset_name and sui.import_id = p_import_id
    )
  );

  -- Cleanup staging et batch
  delete from public.staging_user_imports where workspace_id = p_workspace_id and dataset_name = p_dataset_name and import_id = p_import_id;
  delete from public.user_batch_algolia where workspace_id = p_workspace_id and dataset_name = p_dataset_name;

  -- MAJ data_imports si présent
  update public.data_imports set status = 'completed', finished_at = now() where id = p_import_id;

  return jsonb_build_object('overlays', v_result);
end $$;

commit;

