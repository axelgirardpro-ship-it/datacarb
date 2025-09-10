-- Cleanup legacy import pipeline (admin) now replaced by Dataiku -> staging -> run_import_from_staging()
-- Supprime tables techniques, RPC/funcs liées au chunking, et désactive triggers obsolètes.

-- 1) Drop tables legacy si présentes
DROP TABLE IF EXISTS public.import_chunks CASCADE;
DROP TABLE IF EXISTS public.import_jobs CASCADE;
DROP TABLE IF EXISTS public.import_settings CASCADE;
-- Ancien nom éventuel de staging
DROP TABLE IF EXISTS public.emission_factors_staging CASCADE;

-- 2) Drop fonctions RPC legacy (toutes signatures) par nom
DO $$
DECLARE r record;
BEGIN
  FOR r IN (
    SELECT n.nspname, p.proname, p.oid AS poid, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'claim_chunk_for_processing',
        'release_chunk_lock',
        'enqueue_chunk_creation',
        'enqueue_csv_chunk',
        'update_job_progress',
        'disable_emission_factors_triggers',
        'enable_emission_factors_triggers',
        'scd2_upsert_emission_factors'
      )
  ) LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %I.%I(%s) CASCADE', r.nspname, r.proname, r.args);
  END LOOP;
END $$;

-- 3) Désactivation de triggers obsolètes si encore présents (sécurité)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public' AND c.relname='emission_factors' AND t.tgname LIKE 'import_%'
  ) THEN
    ALTER TABLE public.emission_factors DISABLE TRIGGER ALL;
    ALTER TABLE public.emission_factors ENABLE TRIGGER ALL; -- reset propre
  END IF;
END $$;

-- 4) Remarques:
-- - Les Edge Functions legacy doivent être supprimées/désactivées côté déploiement.
-- - Le connecteur Algolia lit emission_factors_all_search directement.


