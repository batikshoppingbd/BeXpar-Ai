-- BeXpar Ai Courier Defaults & Manual Payment Methods Migration (006)

-- 1. Support Default Courier per Business
ALTER TABLE courier_accounts
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_courier_accounts_default_per_biz
  ON courier_accounts(business_id)
  WHERE is_default = TRUE;

CREATE INDEX IF NOT EXISTS idx_courier_accounts_biz_active
  ON courier_accounts(business_id, is_active);

-- Backfill: ensure businesses with active courier accounts have a default selected (Steadfast preferred if both active)
WITH ranked AS (
  SELECT
    id,
    business_id,
    ROW_NUMBER() OVER (
      PARTITION BY business_id
      ORDER BY CASE WHEN provider = 'steadfast' THEN 0 ELSE 1 END, updated_at DESC
    ) AS rn
  FROM courier_accounts
  WHERE is_active = TRUE
    AND business_id NOT IN (
      SELECT DISTINCT business_id FROM courier_accounts WHERE is_default = TRUE
    )
)
UPDATE courier_accounts ca
SET is_default = TRUE
FROM ranked r
WHERE ca.id = r.id AND r.rn = 1;

-- 2. Extend payment_gateways to support 'rocket' alongside 'bkash', 'nagad', 'manual', 'sslcommerz', 'custom'
DO $$
DECLARE
  c_name TEXT;
BEGIN
  FOR c_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'payment_gateways'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%gateway_type%'
  LOOP
    EXECUTE format('ALTER TABLE payment_gateways DROP CONSTRAINT IF EXISTS %I', c_name);
  END LOOP;
END $$;

ALTER TABLE payment_gateways
  ADD CONSTRAINT payment_gateways_gateway_type_check
  CHECK (gateway_type IN ('manual', 'bkash', 'nagad', 'rocket', 'sslcommerz', 'custom'));

-- Seed Rocket manual payment method cleanly if not present
INSERT INTO payment_gateways (slug, name, gateway_type, is_active, is_sandbox, config_public, instructions)
VALUES (
  'rocket',
  'Rocket Manual MFS',
  'rocket',
  FALSE,
  FALSE,
  '{"accounts": []}'::jsonb,
  'Send Money to an active Rocket number below and submit your Transaction ID (TrxID).'
)
ON CONFLICT (slug) DO NOTHING;

-- 3. Payment uniqueness & query performance indexes
DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_unique_normalized_trx
    ON payments (LOWER(TRIM(transaction_id)))
    WHERE TRIM(transaction_id) <> '';
EXCEPTION WHEN unique_violation THEN
  -- Existing legacy duplicate TrxIDs remain untouched; backend enforces uniqueness on all new submissions.
  NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_payments_status_created ON payments(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_biz_created ON payments(business_id, created_at DESC);
