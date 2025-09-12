-- RPC pour ajouter les overlays importés aux favoris, en utilisant object_id
create or replace function public.add_import_overlays_to_favorites(
  p_user_id uuid,
  p_workspace_id uuid,
  p_dataset_name text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted int := 0;
  v_updated int := 0;
begin
  if p_user_id is null or p_workspace_id is null or coalesce(trim(p_dataset_name),'') = '' then
    raise exception 'user_id, workspace_id et dataset_name requis';
  end if;

  with ins as (
    insert into public.favorites (user_id, item_type, item_id, item_data)
    select p_user_id,
           'emission_factor',
           uba.object_id::text,
           jsonb_build_object(
             'Nom', uba."Nom_fr",
             'Nom_en', uba."Nom_en",
             'Description', uba."Description_fr",
             'Description_en', uba."Description_en",
             'FE', uba."FE",
             'Unité donnée d''activité', uba."Unite_fr",
             'Unite_en', uba."Unite_en",
             'Source', uba."Source",
             'Secteur', uba."Secteur_fr",
             'Secteur_en', uba."Secteur_en",
             'Sous-secteur', uba."Sous-secteur_fr",
             'Sous-secteur_en', uba."Sous-secteur_en",
             'Localisation', uba."Localisation_fr",
             'Localisation_en', uba."Localisation_en",
             'Date', uba."Date",
             'Incertitude', uba."Incertitude",
             'workspace_id', uba.workspace_id,
             'dataset_name', uba.dataset_name
           )
    from public.user_batch_algolia uba
    where uba.workspace_id = p_workspace_id
      and uba.dataset_name = p_dataset_name
    on conflict (user_id, item_id) do nothing
    returning 1
  ) select count(*) into v_inserted from ins;

  -- Remap des favoris legacy avec item_id composite -> object_id
  with legacy as (
    select f.id as fav_pk,
           f.item_id as legacy_id,
           split_part(f.item_id, '|', 2) as legacy_key
    from public.favorites f
    where f.user_id = p_user_id
      and f.item_type = 'emission_factor'
      and f.item_id like '%|%'
      and (f.item_data->>'dataset_name') = p_dataset_name
  ), candidates as (
    select l.fav_pk, l.legacy_id, uba.object_id::text as new_item_id,
           jsonb_build_object(
             'Nom', uba."Nom_fr",
             'Nom_en', uba."Nom_en",
             'Description', uba."Description_fr",
             'Description_en', uba."Description_en",
             'FE', uba."FE",
             'Unité donnée d''activité', uba."Unite_fr",
             'Unite_en', uba."Unite_en",
             'Source', uba."Source",
             'Secteur', uba."Secteur_fr",
             'Secteur_en', uba."Secteur_en",
             'Sous-secteur', uba."Sous-secteur_fr",
             'Sous-secteur_en', uba."Sous-secteur_en",
             'Localisation', uba."Localisation_fr",
             'Localisation_en', uba."Localisation_en",
             'Date', uba."Date",
             'Incertitude', uba."Incertitude",
             'workspace_id', uba.workspace_id,
             'dataset_name', uba.dataset_name
           ) as new_item_data
    from legacy l
    join public.user_batch_algolia uba
      on uba.workspace_id = p_workspace_id
     and uba.dataset_name = p_dataset_name
     and l.legacy_key = public.calculate_factor_key(
           p_nom := coalesce(nullif(uba."Nom_fr", ''), nullif(uba."Nom_en", '')),
           p_unite := coalesce(nullif(uba."Unite_fr", ''), null),
           p_source := uba."Source",
           p_perimetre := coalesce(nullif(uba."Périmètre_fr", ''), nullif(uba."Périmètre_en", '')),
           p_localisation := coalesce(nullif(uba."Localisation_fr", ''), nullif(uba."Localisation_en", '')),
           p_workspace_id := null,
           p_language := null,
           p_fe := uba."FE",
           p_date := uba."Date"
         )
  ), upd as (
    update public.favorites f
       set item_id = c.new_item_id,
           item_data = c.new_item_data
      from candidates c
     where f.id = c.fav_pk
    returning 1
  ) select count(*) into v_updated from upd;

  return jsonb_build_object('inserted', v_inserted, 'updated_legacy', v_updated);
end $$;


