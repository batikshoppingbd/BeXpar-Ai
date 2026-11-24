-- BeXpar Ai Indexes & Updated-At Triggers (003)

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  t TEXT;
  ts_tables TEXT[] := ARRAY[
    'profiles', 'subscription_plans', 'businesses', 'subscriptions',
    'coin_wallets', 'coin_packages', 'ai_providers', 'ai_models',
    'ai_settings', 'ai_knowledge_base', 'social_connections',
    'customers', 'conversations', 'products', 'orders',
    'courier_accounts', 'courier_shipments', 'payments'
  ];
BEGIN
  FOREACH t IN ARRAY ts_tables LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_touch_%I ON %I', t, t);
    EXECUTE format('CREATE TRIGGER trg_touch_%I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()', t, t);
  END LOOP;
END $$;

-- Performance & Lookup Indexes
CREATE INDEX IF NOT EXISTS idx_businesses_owner ON businesses(owner_id);
CREATE INDEX IF NOT EXISTS idx_business_members_user ON business_members(user_id);
CREATE INDEX IF NOT EXISTS idx_business_members_biz ON business_members(business_id);
CREATE INDEX IF NOT EXISTS idx_coin_tx_biz_created ON coin_transactions(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_biz_created ON ai_usage_logs(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_kb_biz_enabled ON ai_knowledge_base(business_id, is_enabled);
CREATE INDEX IF NOT EXISTS idx_customers_biz_phone ON customers(business_id, phone);
CREATE INDEX IF NOT EXISTS idx_conversations_biz_last ON conversations(business_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON messages(conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_products_biz_status ON products(business_id, status);
CREATE INDEX IF NOT EXISTS idx_products_biz_sku ON products(business_id, sku);
CREATE INDEX IF NOT EXISTS idx_orders_biz_created ON orders(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_biz_phone ON orders(business_id, customer_phone);
CREATE INDEX IF NOT EXISTS idx_orders_biz_status ON orders(business_id, order_status);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, is_read, created_at DESC);
