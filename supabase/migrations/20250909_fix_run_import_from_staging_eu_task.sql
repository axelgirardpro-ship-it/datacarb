-- Corrige run_import_from_staging pour préserver le corps d'import
-- et déclencher la task d'ingestion Algolia (EU) après succès

create or replace function public.run_import_from_staging()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start timestamptz := now();
  v_inserted int := 0;
  v_updated int := 0;
  v_invalid int := 0;
  v_sources text[] := '{}';
begin
  perform set_config('statement_timeout','0', true);

  drop table if exists temp_prepared;
  create temporary table temp_prepared as
  select
    public.calculate_factor_key(
      p_nom          => coalesce(nullif(btrim("Nom"), ''), nullif(btrim("Nom_en"), '')),
      p_unite        => coalesce(nullif(btrim("Unité donnée d'activité"), ''), nullif(btrim("Unite_en"), '')),
      p_source       => nullif(btrim("Source"), ''),
      p_perimetre    => coalesce(nullif(btrim("Périmètre"), ''), nullif(btrim("Périmètre_en"), '')),
      p_localisation => coalesce(nullif(btrim("Localisation"), ''), nullif(btrim("Localisation_en"), '')),
      p_workspace_id => null,
      p_language     => null,
      p_fe           => public.safe_to_numeric(nullif(btrim("FE"), '')),
      p_date         => public.safe_to_int(nullif(btrim("Date"), ''))
    ) as factor_key,
    coalesce(nullif(btrim("Nom"), ''), nullif(btrim("Nom_en"), '')) as "Nom",
    nullif(btrim("Nom_en"), '') as "Nom_en",
    coalesce(nullif(btrim("Description"), ''), nullif(btrim("Description_en"), '')) as "Description",
    nullif(btrim("Description_en"), '') as "Description_en",
    public.safe_to_numeric(nullif(btrim("FE"), ''))::double precision as "FE",
    coalesce(nullif(btrim("Unité donnée d'activité"), ''), nullif(btrim("Unite_en"), '')) as "Unité donnée d'activité",
    nullif(btrim("Unite_en"), '') as "Unite_en",
    nullif(btrim("Source"), '') as "Source",
    coalesce(nullif(btrim("Secteur"), ''), nullif(btrim("Secteur_en"), '')) as "Secteur",
    nullif(btrim("Secteur_en"), '') as "Secteur_en",
    coalesce(nullif(btrim("Sous-secteur"), ''), nullif(btrim("Sous-secteur_en"), '')) as "Sous-secteur",
    nullif(btrim("Sous-secteur_en"), '') as "Sous-secteur_en",
    coalesce(nullif(btrim("Localisation"), ''), nullif(btrim("Localisation_en"), '')) as "Localisation",
    nullif(btrim("Localisation_en"), '') as "Localisation_en",
    public.safe_to_int(nullif(btrim("Date"), ''))::double precision as "Date",
    nullif(btrim("Incertitude"), '') as "Incertitude",
    coalesce(nullif(btrim("Périmètre"), ''), nullif(btrim("Périmètre_en"), '')) as "Périmètre",
    nullif(btrim("Périmètre_en"), '') as "Périmètre_en",
    nullif(btrim("Contributeur"), '') as "Contributeur",
    nullif(btrim("Commentaires"), '') as "Commentaires",
    nullif(btrim("Commentaires_en"), '') as "Commentaires_en"
  from public.staging_emission_factors;

  drop table if exists temp_invalid;
  create temporary table temp_invalid as
  select * from temp_prepared
  where "FE" is null
     or "Unité donnée d'activité" is null;
  get diagnostics v_invalid = row_count;

  drop table if exists temp_valid;
  create temporary table temp_valid as
  select * from temp_prepared
  where "FE" is not null
    and "Unité donnée d'activité" is not null;

  drop table if exists temp_dedup;
  create temporary table temp_dedup as
  select distinct on (factor_key) *
  from temp_valid
  order by factor_key;

  insert into public.fe_sources (source_name, access_level, is_global)
  select distinct "Source", 'standard', true from temp_dedup where "Source" is not null
  on conflict (source_name) do nothing;

  insert into public.fe_source_workspace_assignments (source_name, workspace_id, assigned_by)
  select fs.source_name, w.id, null
  from public.fe_sources fs
  join public.workspaces w on true
  where fs.access_level = 'standard'
  on conflict do nothing;

  insert into public.emission_factors (
    factor_key,
    "Nom","Nom_en","Description","Description_en",
    "FE","Unité donnée d'activité","Unite_en",
    "Source","Secteur","Secteur_en",
    "Sous-secteur","Sous-secteur_en",
    "Localisation","Localisation_en",
    "Périmètre","Périmètre_en",
    "Date","Incertitude","Contributeur",
    "Commentaires","Commentaires_en",
    is_latest,
    updated_at
  )
  select 
    d.factor_key,
    d."Nom", d."Nom_en", d."Description", d."Description_en",
    d."FE", d."Unité donnée d'activité", d."Unite_en",
    d."Source", d."Secteur", d."Secteur_en",
    d."Sous-secteur", d."Sous-secteur_en",
    d."Localisation", d."Localisation_en",
    d."Périmètre", d."Périmètre_en",
    d."Date", d."Incertitude", d."Contributeur",
    d."Commentaires", d."Commentaires_en",
    true,
    now()
  from temp_dedup d
  on conflict (factor_key) do update set
    "Nom"=excluded."Nom",
    "Nom_en"=excluded."Nom_en",
    "Description"=excluded."Description",
    "Description_en"=excluded."Description_en",
    "FE"=excluded."FE",
    "Unité donnée d'activité"=excluded."Unité donnée d'activité",
    "Unite_en"=excluded."Unite_en",
    "Source"=excluded."Source",
    "Secteur"=excluded."Secteur",
    "Secteur_en"=excluded."Secteur_en",
    "Sous-secteur"=excluded."Sous-secteur",
    "Sous-secteur_en"=excluded."Sous-secteur_en",
    "Localisation"=excluded."Localisation",
    "Localisation_en"=excluded."Localisation_en",
    "Périmètre"=excluded."Périmètre",
    "Périmètre_en"=excluded."Périmètre_en",
    "Date"=excluded."Date",
    "Incertitude"=excluded."Incertitude",
    "Contributeur"=excluded."Contributeur",
    "Commentaires"=excluded."Commentaires",
    "Commentaires_en"=excluded."Commentaires_en",
    is_latest = true,
    updated_at = now();
  get diagnostics v_inserted = row_count;

  select coalesce(array_agg(distinct "Source"), '{}') into v_sources from temp_dedup where "Source" is not null;
  if v_sources is not null then
    perform set_config('statement_timeout','0', true);
    declare s text; begin
      foreach s in array v_sources loop
        perform public.refresh_ef_all_for_source(s);
      end loop;
    end;
  end if;

  analyze public.emission_factors_all_search;

  -- Déclencher ingestion Algolia (EU) après succès
  perform public.run_algolia_data_task('419f86b4-4c35-4608-8a88-b8343a457a3a'::uuid, 'eu');

  return json_build_object(
    'inserted_or_updated', v_inserted,
    'invalid', v_invalid,
    'sources', v_sources,
    'duration_ms', extract(epoch from (now() - v_start))*1000
  );
end $$;


