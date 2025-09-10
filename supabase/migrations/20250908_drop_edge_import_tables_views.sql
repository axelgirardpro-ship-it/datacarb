-- Supprime vues legacy liées aux imports/monitoring qui ne sont plus utilisées
DROP VIEW IF EXISTS public.import_status;
DROP VIEW IF EXISTS public.user_import_status;

-- Supprime tables temporaires de cache reliées aux Edge Functions legacy
DROP TABLE IF EXISTS public.import_file_cache CASCADE;


