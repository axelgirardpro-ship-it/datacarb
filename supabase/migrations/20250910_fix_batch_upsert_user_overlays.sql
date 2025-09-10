-- Corrige l'ambiguïté de colonne dans batch_upsert_user_factor_overlays
begin;

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
      incoming.workspace_id,
      incoming.dataset_name,
      incoming."ID",
      incoming."Nom",
      incoming."Nom_en",
      incoming."Description",
      incoming."Description_en",
      incoming."FE",
      incoming."Unité donnée d'activité",
      incoming."Unite_en",
      incoming."Source",
      incoming."Secteur",
      incoming."Secteur_en",
      incoming."Sous-secteur",
      incoming."Sous-secteur_en",
      incoming."Localisation",
      incoming."Localisation_en",
      incoming."Date",
      incoming."Incertitude",
      incoming."Périmètre",
      incoming."Périmètre_en",
      incoming."Contributeur",
      incoming."Commentaires",
      incoming."Commentaires_en",
      public.safe_to_numeric(nullif(incoming."FE", '')) as fe_num,
      case when trim(coalesce(incoming."Date",'')) ~ '^\d+$' then trim(incoming."Date")::int else null end as date_int,
      coalesce(nullif(incoming."Nom", ''), nullif(incoming."Nom_en", '')) as nom,
      coalesce(nullif(incoming."Unité donnée d'activité", ''), null) as unite,
      coalesce(nullif(incoming."Source", ''), null) as source,
      coalesce(nullif(incoming."Périmètre", ''), nullif(incoming."Périmètre_en", '')) as perimetre,
      coalesce(nullif(incoming."Localisation", ''), nullif(incoming."Localisation_en", '')) as localisation
    from incoming
  ), keyed as (
    select 
      prepared.workspace_id,
      prepared.dataset_name,
      prepared."ID",
      prepared."Nom",
      prepared."Nom_en",
      prepared."Description",
      prepared."Description_en",
      prepared."FE",
      prepared."Unité donnée d'activité",
      prepared."Unite_en",
      prepared."Source",
      prepared."Secteur",
      prepared."Secteur_en",
      prepared."Sous-secteur",
      prepared."Sous-secteur_en",
      prepared."Localisation",
      prepared."Localisation_en",
      prepared."Date",
      prepared."Incertitude",
      prepared."Périmètre",
      prepared."Périmètre_en",
      prepared."Contributeur",
      prepared."Commentaires",
      prepared."Commentaires_en",
      public.calculate_factor_key(
        p_nom := prepared.nom,
        p_unite := prepared.unite,
        p_source := prepared.source,
        p_perimetre := prepared.perimetre,
        p_localisation := prepared.localisation,
        p_workspace_id := null,
        p_language := null,
        p_fe := prepared.fe_num,
        p_date := prepared.date_int
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
      keyed.workspace_id, keyed.dataset_name, keyed.factor_key,
      keyed."ID",keyed."Nom",keyed."Nom_en",keyed."Description",keyed."Description_en",keyed."FE",keyed."Unité donnée d'activité",keyed."Unite_en",keyed."Source",
      keyed."Secteur",keyed."Secteur_en",keyed."Sous-secteur",keyed."Sous-secteur_en",keyed."Localisation",keyed."Localisation_en",keyed."Date",keyed."Incertitude",
      keyed."Périmètre",keyed."Périmètre_en",keyed."Contributeur",keyed."Commentaires",keyed."Commentaires_en", now()
    from keyed
    where keyed.factor_key is not null
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
  select count(*) filter (where inserted), count(*) filter (where not inserted) into v_inserted, v_updated from upsert;

  return jsonb_build_object('inserted', v_inserted, 'updated', v_updated);
end $$;

commit;


