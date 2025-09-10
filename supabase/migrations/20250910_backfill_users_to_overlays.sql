-- Backfill des données users existantes (si des imports utilisateurs résident encore dans emission_factors)
begin;

-- Insérer dans overlays les lignes privées existantes (si elles existaient)
insert into public.user_factor_overlays (
  workspace_id, dataset_name, factor_key,
  "ID","Nom","Nom_en","Description","Description_en","FE","Unité donnée d'activité","Unite_en","Source",
  "Secteur","Secteur_en","Sous-secteur","Sous-secteur_en","Localisation","Localisation_en","Date","Incertitude",
  "Périmètre","Périmètre_en","Contributeur","Commentaires","Commentaires_en"
)
select 
  (ef.workspace_id)::uuid,
  coalesce(ef."Source", 'import_utilisateur') as dataset_name,
  ef.factor_key,
  null::text as "ID",ef."Nom",ef."Nom_en",ef."Description",ef."Description_en",ef."FE",ef."Unité donnée d'activité",ef."Unite_en",ef."Source",
  ef."Secteur",ef."Secteur_en",ef."Sous-secteur",ef."Sous-secteur_en",ef."Localisation",ef."Localisation_en",ef."Date",ef."Incertitude",
  ef."Périmètre",ef."Périmètre_en",ef."Contributeur",ef."Commentaires",ef."Commentaires_en"
from public.emission_factors ef
where ef.is_latest = true and ef.workspace_id is not null
on conflict (workspace_id, factor_key) do nothing;

commit;

