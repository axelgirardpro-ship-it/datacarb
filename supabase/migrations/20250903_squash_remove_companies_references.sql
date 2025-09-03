-- Squash cleanup: neutralize legacy references to public.companies
-- 1) Drop policies if table exists
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='companies') THEN
    -- Policies commonly seen across legacy files
    EXECUTE 'DROP POLICY IF EXISTS "Users can create companies" ON public.companies';
    EXECUTE 'DROP POLICY IF EXISTS "Owners can update their companies" ON public.companies';
    EXECUTE 'DROP POLICY IF EXISTS "Users can view their own companies" ON public.companies';
  END IF;
END $$;

-- 2) Guard: update legacy policies on user_roles/datasets that referenced companies without failing
DO $$ BEGIN
  -- user_roles
  BEGIN
    EXECUTE 'DROP POLICY IF EXISTS "Users can view roles in their companies" ON public.user_roles';
  EXCEPTION WHEN undefined_table THEN
    -- ignore
  END;
  -- datasets
  BEGIN
    EXECUTE 'DROP POLICY IF EXISTS "Users can create datasets in their companies" ON public.datasets';
    EXECUTE 'DROP POLICY IF EXISTS "Users can update datasets in their companies" ON public.datasets';
    EXECUTE 'DROP POLICY IF EXISTS "Users can view datasets in their companies" ON public.datasets';
  EXCEPTION WHEN undefined_table THEN
    -- ignore
  END;
END $$;

-- 3) Finally drop companies table if still present
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='companies') THEN
    DROP TABLE public.companies CASCADE;
  END IF;
END $$;
