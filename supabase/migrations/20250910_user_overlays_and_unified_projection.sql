-- Create overlays table for user imports and unify projection
begin;

-- Extensions nécessaires
create extension if not exists pgcrypto;

-- 1) Table overlays: stocke à vie les imports users (SCD1 par (workspace_id, factor_key))
create table if not exists public.user_factor_overlays (
  overlay_id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  dataset_name text,
  factor_key text not null,
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
  scope text not null default 'private',
  access_level text default 'standard',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Unicité côté users: un état courant par (workspace, factor_key)
create unique index if not exists user_factor_overlays_workspace_factor_key_idx
  on public.user_factor_overlays (workspace_id, factor_key);

-- 2) RPC: batch_upsert_user_factor_overlays
create or replace function public.batch_upsert_user_factor_overlays(
  p_workspace_id uuid,
  p_dataset_name text,
  p_records jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted int := 0;
  v_updated int := 0;
begin
  if p_records is null or jsonb_typeof(p_records) <> 'array' then
    raise exception 'p_records doit être un tableau JSON';
  end if;

  with incoming as (
    select 
      p_workspace_id as workspace_id,
      p_dataset_name as dataset_name,
      (rec->>'ID') as "ID",
      (rec->>'Nom') as "Nom",
      (rec->>'Nom_en') as "Nom_en",
      (rec->>'Description') as "Description",
      (rec->>'Description_en') as "Description_en",
      (rec->>'FE') as "FE",
      (rec->>'Unité donnée d''activité') as "Unité donnée d'activité",
      (rec->>'Unite_en') as "Unite_en",
      (rec->>'Source') as "Source",
      (rec->>'Secteur') as "Secteur",
      (rec->>'Secteur_en') as "Secteur_en",
      (rec->>'Sous-secteur') as "Sous-secteur",
      (rec->>'Sous-secteur_en') as "Sous-secteur_en",
      (rec->>'Localisation') as "Localisation",
      (rec->>'Localisation_en') as "Localisation_en",
      (rec->>'Date') as "Date",
      (rec->>'Incertitude') as "Incertitude",
      (rec->>'Périmètre') as "Périmètre",
      (rec->>'Périmètre_en') as "Périmètre_en",
      (rec->>'Contributeur') as "Contributeur",
      (rec->>'Commentaires') as "Commentaires",
      (rec->>'Commentaires_en') as "Commentaires_en"
    from jsonb_array_elements(p_records) as rec
  ), prepared as (
    select
      workspace_id,
      dataset_name,
      -- FE/Date typage sécurisé pour la factor_key
      public.safe_to_numeric(nullif("FE", '')) as fe_num,
      case when trim(coalesce("Date",'')) ~ '^\d+$' then trim("Date")::int else null end as date_int,
      coalesce(nullif("Nom", ''), nullif("Nom_en", '')) as nom,
      coalesce(nullif("Unité donnée d'activité", ''), null) as unite,
      coalesce(nullif("Source", ''), null) as source,
      coalesce(nullif("Périmètre", ''), nullif("Périmètre_en", '')) as perimetre,
      coalesce(nullif("Localisation", ''), nullif("Localisation_en", '')) as localisation,
      *
    from incoming
  ), keyed as (
    select *, public.calculate_factor_key(
      p_nom := nom,
      p_unite := unite,
      p_source := source,
      p_perimetre := perimetre,
      p_localisation := localisation,
      p_workspace_id := null,
      p_language := null,
      p_fe := fe_num,
      p_date := date_int
    ) as factor_key
    from prepared
  ), upsert as (
    insert into public.user_factor_overlays as ufo (
      workspace_id, dataset_name, factor_key,
      "ID","Nom","Nom_en","Description","Description_en","FE","Unité donnée d'activité","Unite_en","Source",
      "Secteur","Secteur_en","Sous-secteur","Sous-secteur_en","Localisation","Localisation_en","Date","Incertitude",
      "Périmètre","Périmètre_en","Contributeur","Commentaires","Commentaires_en", updated_at
    )
    select
      workspace_id, dataset_name, factor_key,
      "ID","Nom","Nom_en","Description","Description_en","FE","Unité donnée d'activité","Unite_en","Source",
      "Secteur","Secteur_en","Sous-secteur","Sous-secteur_en","Localisation","Localisation_en","Date","Incertitude",
      "Périmètre","Périmètre_en","Contributeur","Commentaires","Commentaires_en", now()
    from keyed
    where factor_key is not null
    on conflict (workspace_id, factor_key) do update
      set 
        dataset_name = excluded.dataset_name,
        "ID" = excluded."ID",
        "Nom" = excluded."Nom",
        "Nom_en" = excluded."Nom_en",
        "Description" = excluded."Description",
        "Description_en" = excluded."Description_en",
        "FE" = excluded."FE",
        "Unité donnée d'activité" = excluded."Unité donnée d'activité",
        "Unite_en" = excluded."Unite_en",
        "Source" = excluded."Source",
        "Secteur" = excluded."Secteur",
        "Secteur_en" = excluded."Secteur_en",
        "Sous-secteur" = excluded."Sous-secteur",
        "Sous-secteur_en" = excluded."Sous-secteur_en",
        "Localisation" = excluded."Localisation",
        "Localisation_en" = excluded."Localisation_en",
        "Date" = excluded."Date",
        "Incertitude" = excluded."Incertitude",
        "Périmètre" = excluded."Périmètre",
        "Périmètre_en" = excluded."Périmètre_en",
        "Contributeur" = excluded."Contributeur",
        "Commentaires" = excluded."Commentaires",
        "Commentaires_en" = excluded."Commentaires_en",
        updated_at = now()
    returning (xmax = 0) as inserted
  )
  select
    count(*) filter (where inserted),
    count(*) filter (where not inserted)
  into v_inserted, v_updated
  from upsert;

  return jsonb_build_object('inserted', v_inserted, 'updated', v_updated);
end $$;

-- 3) Projection unifiée: rebuild/refresh (extrait minimal – suppose fonctions existantes)
-- Exemple: remplacer les sélections sources dans rebuild_emission_factors_all_search()
-- admin: from public.emission_factors where is_latest=true
-- users: from public.user_factor_overlays
-- ATTENTION: l’implémentation exacte dépend de la fonction existante; à adapter en place.

commit;

