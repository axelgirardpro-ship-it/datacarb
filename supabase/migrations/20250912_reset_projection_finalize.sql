-- Garantir l'existence/MAJ des RPCs d'import utilisateur

-- 1) Reset des tables d'import
create or replace function public.reset_user_import_tables()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Nettoyage demandé au démarrage du flux utilisateur
  begin
    execute 'TRUNCATE TABLE public.staging_user_imports';
  exception when undefined_table then null; end;

  begin
    execute 'TRUNCATE TABLE public.user_batch_algolia';
  exception when undefined_table then null; end;
end $$;

-- 2) Projection batch vers user_batch_algolia en respectant Source du CSV
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

  truncate table public.user_batch_algolia;

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
    case when trim(coalesce(sui."Date",'')) ~ '^\\d+$' then trim(sui."Date")::int else null end as "Date",
    sui."Incertitude",
    sui."Source" -- respecter la valeur du CSV
  from public.staging_user_imports sui
  left join public.fe_sources fs on fs.source_name = sui.dataset_name
  where sui.workspace_id = p_workspace_id and sui.dataset_name = p_dataset_name;

  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- 3) Finalisation sans cleanup de fin (append-only overlays)
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
  v_result jsonb := '{}'::jsonb;
begin
  v_result := public.batch_upsert_user_factor_overlays(
    p_workspace_id,
    p_dataset_name,
    (
      select jsonb_agg(to_jsonb(sui) - 'created_at')
      from public.staging_user_imports sui
      where sui.workspace_id = p_workspace_id and sui.dataset_name = p_dataset_name and sui.import_id = p_import_id
    )
  );

  update public.data_imports set status = 'completed', finished_at = now() where id = p_import_id;

  return jsonb_build_object('overlays', v_result);
end $$;


