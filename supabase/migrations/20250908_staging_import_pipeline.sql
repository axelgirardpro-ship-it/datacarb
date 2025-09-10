-- Staging import pipeline (Dataiku -> staging -> DB gère tout)
-- 1) Table de staging fixe (colonnes TEXT 1:1 avec le CSV)
-- 2) Fonction unique d'import run_import_from_staging()
-- 3) Alias de vue pour Algolia
-- 4) Triggers d'auto-assignation des sources 'standard'
-- 5) Unicité sur factor_key + déduplication préalable

-- 1) STAGING FIXE (colonnes texte strictement basées sur le CSV fourni)
create table if not exists public.staging_emission_factors (
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
  "Commentaires_en" text
);

-- 5) DEDUP + UNICITÉ SUR factor_key (SCD1)
do $$
begin
  -- Supprimer les doublons éventuels avant contrainte unique (garde une ligne arbitraire)
  if exists (
    select 1 from (
      select factor_key, count(*) c from public.emission_factors group by factor_key having count(*) > 1
    ) t
  ) then
    delete from public.emission_factors a
    using public.emission_factors b
    where a.ctid < b.ctid and a.factor_key = b.factor_key;
  end if;
  -- Créer contrainte unique si absente
  if not exists (
    select 1 from pg_indexes where schemaname='public' and indexname='uniq_emission_factors_factor_key'
  ) then
    create unique index uniq_emission_factors_factor_key on public.emission_factors(factor_key);
  end if;
end $$;

-- 2) Fonction unique d'import depuis la staging
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

  -- Préparation
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

  -- Upsert des sources détectées (par défaut 'standard')
  insert into public.fe_sources (source_name, access_level, is_global)
  select distinct "Source", 'standard', true from temp_dedup where "Source" is not null
  on conflict (source_name) do nothing;

  -- Auto-assignation des sources standard à tous les workspaces
  insert into public.fe_source_workspace_assignments (source_name, workspace_id, assigned_by)
  select fs.source_name, w.id, null
  from public.fe_sources fs
  join public.workspaces w on true
  where fs.access_level = 'standard'
  on conflict do nothing;

  -- Upsert SCD1 dans emission_factors (factor_key unique)
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

  -- Rafraîchir la projection par Source impactée
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

  return json_build_object(
    'inserted_or_updated', v_inserted,
    'invalid', v_invalid,
    'sources', v_sources,
    'duration_ms', extract(epoch from (now() - v_start))*1000
  );
end $$;

-- 3) Alias de vue pour Algolia (compat)
create or replace view public.emission_factors_algolia as
select * from public.emission_factors_all_search;

-- 4) TRIGGERS d'auto-assignation STANDARD
create or replace function public.auto_assign_sources_on_fe_sources()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT' and new.access_level = 'standard')
     or (tg_op = 'UPDATE' and new.access_level = 'standard' and (old.access_level is distinct from new.access_level)) then
    insert into public.fe_source_workspace_assignments (source_name, workspace_id, assigned_by)
    select new.source_name, w.id, null from public.workspaces w
    on conflict do nothing;
  end if;
  return new;
end $$;

drop trigger if exists trg_auto_assign_fe_sources on public.fe_sources;
create trigger trg_auto_assign_fe_sources
after insert or update of access_level on public.fe_sources
for each row execute function public.auto_assign_sources_on_fe_sources();

create or replace function public.auto_assign_sources_on_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.fe_source_workspace_assignments (source_name, workspace_id, assigned_by)
  select fs.source_name, new.id, null from public.fe_sources fs where fs.access_level='standard'
  on conflict do nothing;
  return new;
end $$;

drop trigger if exists trg_auto_assign_on_workspace on public.workspaces;
create trigger trg_auto_assign_on_workspace
after insert on public.workspaces
for each row execute function public.auto_assign_sources_on_workspace();

-- Backfill assignations standard (sécurité)
insert into public.fe_source_workspace_assignments (source_name, workspace_id, assigned_by)
select fs.source_name, w.id, null
from public.fe_sources fs
cross join public.workspaces w
where fs.access_level='standard'
on conflict do nothing;


