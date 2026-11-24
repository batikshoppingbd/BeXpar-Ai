-- BeXpar Ai Schema & Role Grants (005)
-- Ensures service_role, authenticated, and anon have proper Postgres privileges
-- alongside strict Row Level Security (RLS) policies on all tables.

GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;

-- Backend service_role requires full table/sequence/routine privileges (bypasses RLS)
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- Authenticated users rely on RLS policies for strict tenant isolation
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_business_ids() TO authenticated;

-- Anonymous role can only read non-sensitive public catalogs (protected by RLS)
GRANT SELECT ON TABLE public.subscription_plans, public.coin_packages, public.feature_flags TO anon;

-- Ensure application_settings has an explicit Super Admin RLS policy
DROP POLICY IF EXISTS "admin_only_app_settings" ON application_settings;
CREATE POLICY "admin_only_app_settings" ON application_settings FOR ALL USING (public.is_super_admin());

-- Ensure default privileges for any future migrations
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL PRIVILEGES ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL PRIVILEGES ON FUNCTIONS TO service_role;
