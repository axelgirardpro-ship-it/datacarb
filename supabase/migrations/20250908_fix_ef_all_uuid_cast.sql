-- Corrige le type de object_id/record_id (uuid) et retire stable_id
-- Renforce le typage de FE/Date et le calcul du tableau languages

CREATE OR REPLACE FUNCTION public.rebuild_emission_factors_all_search()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('statement_timeout', '0', true);

  TRUNCATE TABLE public.emission_factors_all_search;

  INSERT INTO public.emission_factors_all_search (
    object_id, record_id, scope, workspace_id, access_level, assigned_workspace_ids, languages,
    "Nom_fr","Description_fr","Commentaires_fr","Secteur_fr","Sous-secteur_fr","Périmètre_fr","Localisation_fr","Unite_fr",
    "Nom_en","Description_en","Commentaires_en","Secteur_en","Sous-secteur_en","Périmètre_en","Localisation_en","Unite_en",
    "FE","Date","Incertitude","Source"
  )
  SELECT
    (ef.id)::uuid AS object_id,
    (ef.id)::uuid AS record_id,
    CASE WHEN ef.workspace_id IS NULL THEN 'public' ELSE 'private' END AS scope,
    ef.workspace_id,
    fs.access_level,
    (
      SELECT array_agg(ws.workspace_id)
      FROM public.fe_source_workspace_assignments ws
      WHERE ws.source_name = ef."Source"
    ) AS assigned_workspace_ids,
    ARRAY_REMOVE(ARRAY[
      CASE WHEN (ef."Nom" IS NOT NULL OR ef."Description" IS NOT NULL OR ef."Unité donnée d'activité" IS NOT NULL OR ef."Secteur" IS NOT NULL OR ef."Localisation" IS NOT NULL) THEN 'fr' END,
      CASE WHEN (ef."Nom_en" IS NOT NULL OR ef."Description_en" IS NOT NULL OR ef."Unite_en" IS NOT NULL OR ef."Secteur_en" IS NOT NULL OR ef."Localisation_en" IS NOT NULL) THEN 'en' END
    ], NULL)::text[] AS languages,
    ef."Nom"                AS "Nom_fr",
    ef."Description"        AS "Description_fr",
    ef."Commentaires"       AS "Commentaires_fr",
    ef."Secteur"            AS "Secteur_fr",
    ef."Sous-secteur"       AS "Sous-secteur_fr",
    ef."Périmètre"          AS "Périmètre_fr",
    ef."Localisation"       AS "Localisation_fr",
    ef."Unité donnée d'activité" AS "Unite_fr",
    ef."Nom_en"             AS "Nom_en",
    ef."Description_en"     AS "Description_en",
    ef."Commentaires_en"    AS "Commentaires_en",
    ef."Secteur_en"         AS "Secteur_en",
    ef."Sous-secteur_en"    AS "Sous-secteur_en",
    ef."Périmètre_en"       AS "Périmètre_en",
    ef."Localisation_en"    AS "Localisation_en",
    ef."Unite_en"           AS "Unite_en",
    public.safe_to_numeric((ef."FE")::text) AS "FE",
    public.safe_to_int((ef."Date")::text) AS "Date",
    ef."Incertitude"        AS "Incertitude",
    ef."Source"             AS "Source"
  FROM public.emission_factors ef
  JOIN public.fe_sources fs ON fs.source_name = ef."Source"
  WHERE ef.is_latest = true;

  RAISE NOTICE 'ef_all projection rebuilt: % rows', (SELECT count(*) FROM public.emission_factors_all_search);
END;
$$;

-- Refresh par source
CREATE OR REPLACE FUNCTION public.refresh_ef_all_for_source(p_source text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_source IS NULL OR length(p_source) = 0 THEN
    RAISE NOTICE 'refresh_ef_all_for_source: source vide';
    RETURN;
  END IF;

  PERFORM set_config('statement_timeout', '0', true);

  DELETE FROM public.emission_factors_all_search WHERE "Source" = p_source;

  INSERT INTO public.emission_factors_all_search (
    object_id, record_id, scope, workspace_id, access_level, assigned_workspace_ids, languages,
    "Nom_fr","Description_fr","Commentaires_fr","Secteur_fr","Sous-secteur_fr","Périmètre_fr","Localisation_fr","Unite_fr",
    "Nom_en","Description_en","Commentaires_en","Secteur_en","Sous-secteur_en","Périmètre_en","Localisation_en","Unite_en",
    "FE","Date","Incertitude","Source"
  )
  SELECT
    (ef.id)::uuid AS object_id,
    (ef.id)::uuid AS record_id,
    CASE WHEN ef.workspace_id IS NULL THEN 'public' ELSE 'private' END AS scope,
    ef.workspace_id,
    fs.access_level,
    (
      SELECT array_agg(ws.workspace_id)
      FROM public.fe_source_workspace_assignments ws
      WHERE ws.source_name = ef."Source"
    ) AS assigned_workspace_ids,
    ARRAY_REMOVE(ARRAY[
      CASE WHEN (ef."Nom" IS NOT NULL OR ef."Description" IS NOT NULL OR ef."Unité donnée d'activité" IS NOT NULL OR ef."Secteur" IS NOT NULL OR ef."Localisation" IS NOT NULL) THEN 'fr' END,
      CASE WHEN (ef."Nom_en" IS NOT NULL OR ef."Description_en" IS NOT NULL OR ef."Unite_en" IS NOT NULL OR ef."Secteur_en" IS NOT NULL OR ef."Localisation_en" IS NOT NULL) THEN 'en' END
    ], NULL)::text[] AS languages,
    ef."Nom"                AS "Nom_fr",
    ef."Description"        AS "Description_fr",
    ef."Commentaires"       AS "Commentaires_fr",
    ef."Secteur"            AS "Secteur_fr",
    ef."Sous-secteur"       AS "Sous-secteur_fr",
    ef."Périmètre"          AS "Périmètre_fr",
    ef."Localisation"       AS "Localisation_fr",
    ef."Unité donnée d'activité" AS "Unite_fr",
    ef."Nom_en"             AS "Nom_en",
    ef."Description_en"     AS "Description_en",
    ef."Commentaires_en"    AS "Commentaires_en",
    ef."Secteur_en"         AS "Secteur_en",
    ef."Sous-secteur_en"    AS "Sous-secteur_en",
    ef."Périmètre_en"       AS "Périmètre_en",
    ef."Localisation_en"    AS "Localisation_en",
    ef."Unite_en"           AS "Unite_en",
    public.safe_to_numeric((ef."FE")::text) AS "FE",
    public.safe_to_int((ef."Date")::text) AS "Date",
    ef."Incertitude"        AS "Incertitude",
    ef."Source"             AS "Source"
  FROM public.emission_factors ef
  JOIN public.fe_sources fs ON fs.source_name = ef."Source"
  WHERE ef.is_latest = true AND ef."Source" = p_source;

  RAISE NOTICE 'ef_all refreshed for source: %', p_source;
END;
$$;


