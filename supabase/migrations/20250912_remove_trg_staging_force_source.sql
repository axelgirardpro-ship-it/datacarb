-- Supprimer le trigger qui forçait Source=dataset_name dans staging_user_imports
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'staging_user_imports' AND t.tgname = 'trg_staging_force_source'
  ) THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_staging_force_source ON public.staging_user_imports';
  END IF;
EXCEPTION WHEN undefined_table THEN
  -- Environnements de preview sans table
  NULL;
END $$;

-- Supprimer la fonction associée si elle existe
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='tr_staging_force_source'
  ) THEN
    EXECUTE 'DROP FUNCTION IF EXISTS public.tr_staging_force_source()';
  END IF;
END $$;


