-- Désactivation/suppression logique des Edge Functions et objets liés au pipeline admin chunké
-- On supprime les artefacts DB (queues PGMQ, cron jobs) sans affecter import-users.

-- 1) Supprimer files/queues PGMQ si présentes
DO $$
BEGIN
  -- file d'import chunks (si existait)
  PERFORM public.pgmq_drop_queue('import_jobs');
EXCEPTION WHEN undefined_function THEN
  -- extension pgmq absente: ignorer
  NULL;
END $$;

-- 2) Supprimer entrées pg_cron liées (si extension présente)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Permissions limitées sur cron.job en environnement managé: ignorer silencieusement
    BEGIN
      PERFORM 1 FROM cron.job LIMIT 1;
      DELETE FROM cron.job WHERE jobname IN (
        'import_worker_cron',
        'db_webhooks_optimized',
        'create_chunks_scheduler'
      );
    EXCEPTION WHEN OTHERS THEN
      -- sans droits: no-op
      NULL;
    END;
  END IF;
END $$;

-- 3) Annexe: les tables/funcs legacy déjà supprimées dans 20250908_cleanup_legacy_import.sql


