#!/usr/bin/env bash
set -euo pipefail

# Constantes figées
TARGET_TABLE="public.emission_factors"
CONFLICT_COLUMNS="factor_key"

# Prérequis (exporter depuis l'environnement local; stockés côté Supabase Secrets) [[memory:7197186]]
# export DATABASE_URL="postgres://USER:PASS@HOST:6543/postgres"
# export ALGOLIA_APPLICATION_ID="..."
# export ALGOLIA_ADMIN_API_KEY="..."

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 /chemin/absolu/fichier.csv"
  exit 1
fi
CSV_PATH="$1"
if [[ ! -f "$CSV_PATH" ]]; then
  echo "Fichier introuvable: $CSV_PATH"
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js est requis (>= 18). Installez-le puis relancez." >&2
  exit 1
fi

# Staging (nouvelle ou reprise)
if [[ -n "${STAGING_OVERRIDE:-}" ]]; then
  STAGING="$STAGING_OVERRIDE"
  SKIP_CREATE_COPY=1
  echo "→ Reprise avec staging existante: $STAGING"
else
  STAGING="public.staging_import_$(date +%s)"
  SKIP_CREATE_COPY=0
  echo "→ Création staging: $STAGING (dépend de l'en-tête du CSV)"
fi

if [[ "$SKIP_CREATE_COPY" -eq 0 ]]; then
  node scripts/csv-header-to-sql.js "$STAGING" "$CSV_PATH" > /tmp/create_staging.sql
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<SQL
SET statement_timeout = 0;
\i /tmp/create_staging.sql
ALTER TABLE $STAGING ADD COLUMN IF NOT EXISTS language text, ADD COLUMN IF NOT EXISTS workspace_id uuid, ADD COLUMN IF NOT EXISTS dataset_id uuid, ADD COLUMN IF NOT EXISTS import_type text;
\copy $STAGING($(node scripts/csv-header-columns.js "$CSV_PATH")) FROM '$CSV_PATH' WITH (FORMAT csv, HEADER true)
SQL
else
  echo "→ Skip création/COPY (staging existante)"
fi

echo "→ UPSERT (session unique READ WRITE + triggers off/on)"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v staging="$STAGING" <<'SQL'
SET statement_timeout = 0;
SET SESSION CHARACTERISTICS AS TRANSACTION READ WRITE;
BEGIN;
ALTER TABLE public.emission_factors DISABLE TRIGGER USER;
-- Préparation
DROP TABLE IF EXISTS temp_full_prepared;
CREATE TEMP TABLE temp_full_prepared AS
SELECT
  public.calculate_factor_key(
    p_language => COALESCE(NULLIF(language, ''), 'fr'),
    p_localisation => COALESCE(NULLIF("Localisation", ''), NULLIF("Localisation_en", '')),
    p_nom => COALESCE(NULLIF("Nom", ''), NULLIF("Nom_en", '')),
    p_perimetre => COALESCE(NULLIF("Périmètre", ''), NULLIF("Périmètre_en", '')),
    p_source => NULLIF("Source", ''),
    p_unite => COALESCE(NULLIF("Unité donnée d'activité", ''), NULLIF("Unite_en", '')),
    p_workspace_id => workspace_id
  ) AS factor_key,
  COALESCE(NULLIF(language, ''), 'fr') AS language,
  COALESCE(NULLIF("Nom", ''), NULLIF("Nom_en", '')) AS "Nom",
  NULLIF("Nom_en", '') AS "Nom_en",
  COALESCE(NULLIF("Description", ''), NULLIF("Description_en", '')) AS "Description",
  NULLIF("Description_en", '') AS "Description_en",
  public.safe_to_numeric(NULLIF("FE", '')) AS "FE",
  COALESCE(NULLIF("Unité donnée d'activité", ''), NULLIF("Unite_en", '')) AS "Unité donnée d'activité",
  NULLIF("Unite_en", '') AS "Unite_en",
  NULLIF("Source", '') AS "Source",
  COALESCE(NULLIF("Secteur", ''), NULLIF("Secteur_en", '')) AS "Secteur",
  NULLIF("Secteur_en", '') AS "Secteur_en",
  COALESCE(NULLIF("Sous-secteur", ''), NULLIF("Sous-secteur_en", '')) AS "Sous-secteur",
  NULLIF("Sous-secteur_en", '') AS "Sous-secteur_en",
  COALESCE(NULLIF("Localisation", ''), NULLIF("Localisation_en", '')) AS "Localisation",
  NULLIF("Localisation_en", '') AS "Localisation_en",
  COALESCE(NULLIF("Périmètre", ''), NULLIF("Périmètre_en", '')) AS "Périmètre",
  NULLIF("Périmètre_en", '') AS "Périmètre_en",
  public.safe_to_int(NULLIF("Date", '')) AS "Date",
  NULLIF("Incertitude", '') AS "Incertitude",
  NULLIF("Commentaires", '') AS "Commentaires",
  NULLIF("Commentaires_en", '') AS "Commentaires_en",
  workspace_id, dataset_id,
  NULLIF(import_type, '') AS import_type
FROM :staging;

-- Filtrer les lignes invalides (champs requis manquants)
DROP TABLE IF EXISTS temp_invalid;
CREATE TEMP TABLE temp_invalid AS
SELECT * FROM temp_full_prepared
WHERE factor_key IS NULL
   OR "Nom" IS NULL
   OR "FE" IS NULL
   OR "Unité donnée d'activité" IS NULL
   OR "Source" IS NULL
   OR "Secteur" IS NULL
   OR language IS NULL;

SELECT 'invalid_rows' AS label, count(*) AS value FROM temp_invalid;

DROP TABLE IF EXISTS temp_valid;
CREATE TEMP TABLE temp_valid AS
SELECT * FROM temp_full_prepared
WHERE factor_key IS NOT NULL
  AND "Nom" IS NOT NULL
  AND "FE" IS NOT NULL
  AND "Unité donnée d'activité" IS NOT NULL
  AND "Source" IS NOT NULL
  AND "Secteur" IS NOT NULL
  AND language IS NOT NULL;

SELECT 'valid_rows' AS label, count(*) AS value FROM temp_valid;

-- Déduplication matérialisée sur les lignes valides
DROP TABLE IF EXISTS temp_dedup;
CREATE TEMP TABLE temp_dedup AS
SELECT DISTINCT ON (factor_key)
  factor_key,
  language, "Nom", "Nom_en", "Description", "Description_en",
  "FE", "Unité donnée d'activité", "Source", "Secteur", "Secteur_en",
  "Sous-secteur", "Sous-secteur_en", "Localisation", "Localisation_en",
  "Périmètre", "Périmètre_en", "Date", "Incertitude",
  "Commentaires", "Commentaires_en",
  workspace_id, dataset_id, import_type
FROM temp_valid
ORDER BY factor_key;

SELECT 'dedup_rows' AS label, count(*) AS value FROM temp_dedup;

-- 1) Demote latest
UPDATE public.emission_factors ef
SET is_latest = false, valid_to = now()
FROM (SELECT DISTINCT factor_key FROM temp_dedup) k
WHERE ef.is_latest = true AND ef.factor_key = k.factor_key;

-- 2) Insert new latest par lots (25k)
DROP TABLE IF EXISTS temp_dedup_seq;
CREATE TEMP TABLE temp_dedup_seq AS
SELECT *, row_number() over (order by factor_key) AS rn FROM temp_dedup;

DO $$
DECLARE batch_size int := 25000; max_rn int; start_rn int := 1; done int := 0; ins int;
BEGIN
  SELECT max(rn) INTO max_rn FROM temp_dedup_seq;
  IF max_rn IS NULL THEN RETURN; END IF;
  WHILE start_rn <= max_rn LOOP
    WITH chunk AS (
      SELECT * FROM temp_dedup_seq WHERE rn >= start_rn AND rn < start_rn + batch_size
    )
    INSERT INTO public.emission_factors (
      factor_key, version_id, is_latest, valid_from,
      language, "Nom", "Nom_en", "Description", "Description_en", "FE", "Unité donnée d'activité",
      "Source", "Secteur", "Secteur_en", "Sous-secteur", "Sous-secteur_en", "Localisation", "Localisation_en", "Périmètre", "Périmètre_en",
      "Date", "Incertitude", "Commentaires", "Commentaires_en",
      workspace_id, dataset_id, import_type, updated_at
    )
    SELECT
      c.factor_key,
      gen_random_uuid() AS version_id,
      true AS is_latest,
      now() AS valid_from,
      c.language,
      c."Nom",
      c."Nom_en",
      c."Description",
      c."Description_en",
      c."FE",
      c."Unité donnée d'activité",
      c."Source",
      c."Secteur",
      c."Secteur_en",
      c."Sous-secteur",
      c."Sous-secteur_en",
      c."Localisation",
      c."Localisation_en",
      c."Périmètre",
      c."Périmètre_en",
      c."Date",
      c."Incertitude",
      c."Commentaires",
      c."Commentaires_en",
      c.workspace_id,
      c.dataset_id,
      c.import_type,
      now() AS updated_at
    FROM chunk c;

    GET DIAGNOSTICS ins = ROW_COUNT;
    done := done + ins;
    RAISE NOTICE 'inserted so far: %', done;
    start_rn := start_rn + batch_size;
  END LOOP;
END $$;

ALTER TABLE public.emission_factors ENABLE TRIGGER USER;
COMMIT;
ANALYZE public.emission_factors;
SQL

echo "→ Refresh projection ef_all par source (depuis emission_factors)"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
SET statement_timeout = 0;
DO $$
DECLARE s text;
BEGIN
  FOR s IN (
    SELECT DISTINCT "Source"
    FROM public.emission_factors
    WHERE is_latest = true AND "Source" IS NOT NULL
  ) LOOP
    PERFORM public.refresh_ef_all_for_source(p_source => s);
  END LOOP;
END $$;
ANALYZE public.emission_factors_all_search;
SQL

echo "✓ Import terminé: staging → emission_factors → projection ef_all (ok)"
