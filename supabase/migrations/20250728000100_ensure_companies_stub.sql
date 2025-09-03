-- Guard: ensure legacy companies table exists to satisfy subsequent DROP POLICY statements
-- This stub will be safely dropped by later cleanup migrations if present
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema='public' AND table_name='companies'
  ) THEN
    CREATE TABLE public.companies (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text,
      owner_id uuid,
      plan_type text DEFAULT 'freemium'
    );
    ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;
