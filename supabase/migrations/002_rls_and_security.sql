-- BeXpar Ai Row Level Security & Atomic Functions (002)

-- Helper: Check if current authenticated user is Super Admin
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'super_admin' AND status = 'active'
  );
$$;

-- Helper: Return all business_ids the current user belongs to
CREATE OR REPLACE FUNCTION public.user_business_ids()
RETURNS SETOF UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
  SELECT id FROM public.businesses WHERE owner_id = auth.uid()
  UNION
  SELECT business_id FROM public.business_members WHERE user_id = auth.uid() AND status = 'active';
$$;

-- Atomic Coin Deduction (Prevents negative balance & race conditions)
CREATE OR REPLACE FUNCTION public.deduct_ai_coins_atomic(
  p_business_id UUID,
  p_amount NUMERIC,
  p_description TEXT,
  p_reference_id TEXT DEFAULT '',
  p_user_id UUID DEFAULT NULL
)
RETURNS TABLE(success BOOLEAN, new_balance NUMERIC, message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_wallet_id UUID;
  v_balance NUMERIC;
BEGIN
  IF p_amount < 0 THEN
    RETURN QUERY SELECT FALSE, 0::NUMERIC, 'Deduction amount must be non-negative';
    RETURN;
  END IF;

  SELECT id, balance INTO v_wallet_id, v_balance
  FROM public.coin_wallets
  WHERE business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 0::NUMERIC, 'Coin wallet not found';
    RETURN;
  END IF;

  IF v_balance < p_amount THEN
    RETURN QUERY SELECT FALSE, v_balance, 'Insufficient AI coins';
    RETURN;
  END IF;

  UPDATE public.coin_wallets
  SET balance = balance - p_amount,
      total_used = total_used + p_amount,
      updated_at = NOW()
  WHERE id = v_wallet_id
  RETURNING balance INTO v_balance;

  INSERT INTO public.coin_transactions (business_id, wallet_id, type, amount, balance_after, description, reference_id, created_by)
  VALUES (p_business_id, v_wallet_id, 'usage', -p_amount, v_balance, p_description, p_reference_id, p_user_id);

  RETURN QUERY SELECT TRUE, v_balance, 'Coins deducted';
END;
$$;

-- Atomic Coin Credit (Purchases, Bonuses, Admin Credits)
CREATE OR REPLACE FUNCTION public.credit_ai_coins_atomic(
  p_business_id UUID,
  p_amount NUMERIC,
  p_type TEXT,
  p_description TEXT,
  p_reference_id TEXT DEFAULT '',
  p_user_id UUID DEFAULT NULL
)
RETURNS TABLE(success BOOLEAN, new_balance NUMERIC, message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_wallet_id UUID;
  v_balance NUMERIC;
BEGIN
  IF p_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, 0::NUMERIC, 'Credit amount must be positive';
    RETURN;
  END IF;

  INSERT INTO public.coin_wallets (business_id, balance, total_purchased, total_used, total_bonus)
  VALUES (p_business_id, 0, 0, 0, 0)
  ON CONFLICT (business_id) DO NOTHING;

  SELECT id, balance INTO v_wallet_id, v_balance
  FROM public.coin_wallets
  WHERE business_id = p_business_id
  FOR UPDATE;

  UPDATE public.coin_wallets
  SET balance = balance + p_amount,
      total_purchased = total_purchased + CASE WHEN p_type = 'purchase' THEN p_amount ELSE 0 END,
      total_bonus = total_bonus + CASE WHEN p_type IN ('bonus', 'subscription_grant', 'admin_credit') THEN p_amount ELSE 0 END,
      updated_at = NOW()
  WHERE id = v_wallet_id
  RETURNING balance INTO v_balance;

  INSERT INTO public.coin_transactions (business_id, wallet_id, type, amount, balance_after, description, reference_id, created_by)
  VALUES (p_business_id, v_wallet_id, p_type, p_amount, v_balance, p_description, p_reference_id, p_user_id);

  RETURN QUERY SELECT TRUE, v_balance, 'Coins credited';
END;
$$;

-- Enable Row Level Security on ALL tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_feature_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE coin_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE coin_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE coin_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE package_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_knowledge_base ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE facebook_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE instagram_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_connection_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE courier_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE courier_shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE courier_tracking_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_gateways ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_capi_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_capi_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE application_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;

-- Profiles policies
DROP POLICY IF EXISTS "profiles_self_or_admin" ON profiles;
CREATE POLICY "profiles_self_or_admin" ON profiles
  FOR ALL USING (id = auth.uid() OR public.is_super_admin());

-- Businesses policies
DROP POLICY IF EXISTS "businesses_member_or_admin" ON businesses;
CREATE POLICY "businesses_member_or_admin" ON businesses
  FOR ALL USING (id IN (SELECT public.user_business_ids()) OR public.is_super_admin());

-- Tenant-scoped policies for all business_id tables
DO $$
DECLARE
  t TEXT;
  tenant_tables TEXT[] := ARRAY[
    'business_members', 'staff_invitations', 'subscriptions', 'user_feature_overrides',
    'coin_wallets', 'coin_transactions', 'package_purchases', 'ai_usage_logs',
    'ai_settings', 'ai_knowledge_base', 'social_connection_logs',
    'customers', 'conversations', 'messages', 'conversation_assignments',
    'message_attachments', 'product_categories', 'products', 'product_images',
    'product_variants', 'orders', 'order_items', 'order_status_history',
    'courier_shipments', 'courier_tracking_events', 'payments', 'meta_capi_events',
    'notifications'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS "tenant_isolation_%I" ON %I', t, t);
    EXECUTE format(
      'CREATE POLICY "tenant_isolation_%I" ON %I FOR ALL USING (business_id IN (SELECT public.user_business_ids()) OR public.is_super_admin())',
      t, t
    );
  END LOOP;
END $$;

-- Sensitive credential tables: strictly super_admin or server-side service_role only (no direct client token reads)
DROP POLICY IF EXISTS "admin_only_ai_providers" ON ai_providers;
CREATE POLICY "admin_only_ai_providers" ON ai_providers FOR ALL USING (public.is_super_admin());

DROP POLICY IF EXISTS "public_read_ai_models" ON ai_models;
CREATE POLICY "public_read_ai_models" ON ai_models FOR SELECT USING (is_active = TRUE OR public.is_super_admin());

DROP POLICY IF EXISTS "admin_only_social_tokens" ON social_connections;
CREATE POLICY "admin_only_social_tokens" ON social_connections FOR ALL USING (public.is_super_admin());

DROP POLICY IF EXISTS "admin_only_fb_tokens" ON facebook_pages;
CREATE POLICY "admin_only_fb_tokens" ON facebook_pages FOR ALL USING (public.is_super_admin());

DROP POLICY IF EXISTS "admin_only_ig_tokens" ON instagram_accounts;
CREATE POLICY "admin_only_ig_tokens" ON instagram_accounts FOR ALL USING (public.is_super_admin());

DROP POLICY IF EXISTS "admin_only_wa_tokens" ON whatsapp_accounts;
CREATE POLICY "admin_only_wa_tokens" ON whatsapp_accounts FOR ALL USING (public.is_super_admin());

DROP POLICY IF EXISTS "admin_only_courier_creds" ON courier_accounts;
CREATE POLICY "admin_only_courier_creds" ON courier_accounts FOR ALL USING (public.is_super_admin());

DROP POLICY IF EXISTS "admin_only_capi_creds" ON meta_capi_configs;
CREATE POLICY "admin_only_capi_creds" ON meta_capi_configs FOR ALL USING (public.is_super_admin());

DROP POLICY IF EXISTS "admin_only_payment_gateways" ON payment_gateways;
CREATE POLICY "admin_only_payment_gateways" ON payment_gateways FOR ALL USING (public.is_super_admin());

-- Public catalog / config read policies (non-sensitive fields only)
DROP POLICY IF EXISTS "read_active_plans" ON subscription_plans;
CREATE POLICY "read_active_plans" ON subscription_plans FOR SELECT USING (is_active = TRUE OR public.is_super_admin());

DROP POLICY IF EXISTS "read_active_packages" ON coin_packages;
CREATE POLICY "read_active_packages" ON coin_packages FOR SELECT USING (status = 'active' OR public.is_super_admin());

DROP POLICY IF EXISTS "read_feature_flags" ON feature_flags;
CREATE POLICY "read_feature_flags" ON feature_flags FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "notification_settings_self" ON notification_settings;
CREATE POLICY "notification_settings_self" ON notification_settings FOR ALL USING (user_id = auth.uid() OR public.is_super_admin());

DROP POLICY IF EXISTS "audit_logs_admin_read" ON audit_logs;
CREATE POLICY "audit_logs_admin_read" ON audit_logs FOR SELECT USING (public.is_super_admin());

DROP POLICY IF EXISTS "admin_only_app_settings" ON application_settings;
CREATE POLICY "admin_only_app_settings" ON application_settings FOR ALL USING (public.is_super_admin());

GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
