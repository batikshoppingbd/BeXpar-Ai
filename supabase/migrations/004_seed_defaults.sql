-- BeXpar Ai Default Seed Configuration (004)

INSERT INTO application_settings (
  id, app_name, default_theme, primary_color, secondary_color,
  default_language, maintenance_mode, registration_enabled, meta_api_version, meta_mode
) VALUES (
  1, 'BeXpar Ai', 'light', '#4F46E5', '#7C3AED',
  'bn', FALSE, TRUE, 'v21.0', 'development'
) ON CONFLICT (id) DO NOTHING;

-- Default Subscription Plans
INSERT INTO subscription_plans (slug, name, description, monthly_price, yearly_price, coin_allocation, max_products, max_staff, max_channels, ai_usage_limit, allowed_features, duration_days, display_order)
VALUES
  ('free', 'Free', 'For testing and micro-shops starting with AI automation.', 0, 0, 100, 25, 1, 1, 500, '["ai_chat","products","orders","crm"]'::jsonb, 30, 1),
  ('starter', 'Starter', 'For growing Facebook & WhatsApp sellers.', 990, 9900, 2500, 150, 3, 2, 10000, '["ai_chat","products","orders","crm","facebook_integration","whatsapp_integration","courier","analytics"]'::jsonb, 30, 2),
  ('growth', 'Growth', 'Omnichannel automation with Instagram, Meta CAPI & risk scoring.', 2490, 24900, 8000, 1000, 10, 5, 50000, '["ai_chat","products","orders","crm","facebook_integration","instagram_integration","whatsapp_integration","courier","analytics","meta_capi","staff_accounts","export_reports"]'::jsonb, 30, 3),
  ('business', 'Business', 'High-volume commerce teams with advanced AI models.', 4990, 49900, 20000, 5000, 25, 15, 200000, '["ai_chat","products","orders","crm","facebook_integration","instagram_integration","whatsapp_integration","courier","analytics","meta_capi","staff_accounts","export_reports"]'::jsonb, 30, 4),
  ('enterprise', 'Enterprise', 'Unlimited scale, priority routing & custom integrations.', 12000, 120000, 60000, 50000, 100, 100, 1000000, '["ai_chat","products","orders","crm","facebook_integration","instagram_integration","whatsapp_integration","courier","analytics","meta_capi","staff_accounts","export_reports"]'::jsonb, 30, 5)
ON CONFLICT (slug) DO NOTHING;

-- Default Coin Packages
INSERT INTO coin_packages (name, coin_amount, bonus_coins, price, currency, validity_days, description, status, display_order)
SELECT v.name, v.coin_amount, v.bonus_coins, v.price, 'BDT', v.validity_days, v.description, 'active', v.display_order
FROM (VALUES
  ('Starter Pack', 1000, 100, 350, 180, 'Best for small businesses getting started with AI replies.', 1),
  ('Business Pack', 5000, 750, 1500, 365, 'Popular pack with 15% bonus AI coins for active stores.', 2),
  ('Scale Pack', 15000, 3000, 4000, 365, 'High-volume AI automation pack with 20% bonus coins.', 3)
) AS v(name, coin_amount, bonus_coins, price, validity_days, description, display_order)
WHERE NOT EXISTS (SELECT 1 FROM coin_packages);

-- Default Global Feature Flags
INSERT INTO feature_flags (key, name, description, is_globally_enabled, min_plan_slug)
VALUES
  ('facebook_integration', 'Facebook Page Integration', 'Automatic Meta OAuth connection & Messenger inbox', TRUE, 'free'),
  ('instagram_integration', 'Instagram DM Integration', 'Automatic Instagram Professional DM & comment automation', TRUE, 'free'),
  ('whatsapp_integration', 'WhatsApp Business Integration', 'Meta Embedded Signup & WhatsApp Cloud API inbox', TRUE, 'free'),
  ('ai_chat', 'AI Customer Service Agent', 'Bangla, Banglish & English automated replies and order collection', TRUE, 'free'),
  ('products', 'Product & Inventory Management', 'Catalog, variants, SKU, images, and stock tracking', TRUE, 'free'),
  ('orders', 'Order & Risk Management', 'Order lifecycle, invoice printing, and duplicate/risk scoring', TRUE, 'free'),
  ('crm', 'Customer CRM', 'Unified customer profiles, purchase history, tags, and segments', TRUE, 'free'),
  ('courier', 'Courier Integration', 'Steadfast & Pathao parcel booking and live tracking', TRUE, 'free'),
  ('analytics', 'Business Analytics & Reports', 'Revenue, estimated profit, and CSV exports', TRUE, 'free'),
  ('meta_capi', 'Meta Conversions API', 'Server-side Purchase, Lead & InitiateCheckout events', TRUE, 'free'),
  ('staff_accounts', 'Staff & Role Permissions', 'Invite team members with configurable module permissions', TRUE, 'free'),
  ('export_reports', 'Export Reports (CSV)', 'Download orders, customers, and analytics CSV reports', TRUE, 'free')
ON CONFLICT (key) DO NOTHING;

-- Default AI Providers & Models (Configurable from Super Admin without hardcoding)
INSERT INTO ai_providers (slug, name, provider_type, base_url, is_active, priority)
VALUES
  ('gemini', 'Google Gemini', 'gemini', '', TRUE, 1),
  ('openai', 'OpenAI GPT', 'openai', 'https://api.openai.com/v1', FALSE, 2),
  ('deepseek', 'DeepSeek AI', 'deepseek', 'https://api.deepseek.com/v1', FALSE, 3)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO ai_models (provider_id, model_id, display_name, is_active, is_default, is_fallback, priority, input_cost_per_1m, output_cost_per_1m, coins_per_usd, max_tokens, min_plan_slug)
SELECT p.id, m.model_id, m.display_name, m.is_active, m.is_default, m.is_fallback, m.priority, m.in_cost, m.out_cost, 1000, m.max_tok, 'free'
FROM ai_providers p
JOIN (VALUES
  ('gemini', 'gemini-2.5-flash', 'Gemini 2.5 Flash (Fast & Bilingual)', TRUE, TRUE, FALSE, 1, 0.15, 0.60, 2048),
  ('gemini', 'gemini-2.5-pro', 'Gemini 2.5 Pro (Advanced Reasoning)', TRUE, FALSE, TRUE, 2, 1.25, 5.00, 4096),
  ('openai', 'gpt-4o-mini', 'GPT-4o Mini', TRUE, FALSE, FALSE, 3, 0.15, 0.60, 2048),
  ('deepseek', 'deepseek-chat', 'DeepSeek V3 Chat', TRUE, FALSE, FALSE, 4, 0.27, 1.10, 2048)
) AS m(pslug, model_id, display_name, is_active, is_default, is_fallback, priority, in_cost, out_cost, max_tok)
ON p.slug = m.pslug
ON CONFLICT (provider_id, model_id) DO NOTHING;

-- Default Payment Gateways
INSERT INTO payment_gateways (slug, name, gateway_type, is_active, is_sandbox, instructions)
VALUES
  ('manual', 'Manual Bank / MFS Transfer', 'manual', TRUE, FALSE, 'Send payment to our merchant number and submit Transaction ID & screenshot for Admin verification.'),
  ('bkash', 'bKash Merchant API', 'bkash', FALSE, TRUE, 'Pay directly via bKash Tokenized Checkout.'),
  ('nagad', 'Nagad Payment Gateway', 'nagad', FALSE, TRUE, 'Pay directly via Nagad Merchant API.'),
  ('sslcommerz', 'SSLCommerz Checkout', 'sslcommerz', FALSE, TRUE, 'Cards, bKash, Nagad, and NetBanking via SSLCommerz.')
ON CONFLICT (slug) DO NOTHING;
