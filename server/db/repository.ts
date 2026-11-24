import { getSupabaseAdmin } from '../config/supabaseConfig.ts';

export async function writeAuditLog(params: {
  actorId?: string | null;
  actorEmail?: string;
  actorRole?: string;
  businessId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
}) {
  try {
    const admin = getSupabaseAdmin();
    await admin.from('audit_logs').insert({
      actor_id: params.actorId || null,
      actor_email: params.actorEmail || '',
      actor_role: params.actorRole || '',
      business_id: params.businessId || null,
      action: params.action,
      target_type: params.targetType || '',
      target_id: params.targetId || '',
      details: params.details || {},
      ip_address: params.ipAddress || '',
    });
  } catch (err) {
    console.error('[AuditLog Error]', err);
  }
}

export async function isFeatureEnabledForBusiness(businessId: string, featureKey: string): Promise<boolean> {
  const admin = getSupabaseAdmin();

  const { data: flag } = await admin
    .from('feature_flags')
    .select('is_globally_enabled, min_plan_slug')
    .eq('key', featureKey)
    .maybeSingle();

  if (flag && !flag.is_globally_enabled) {
    return false;
  }

  const { data: override } = await admin
    .from('user_feature_overrides')
    .select('is_enabled')
    .eq('business_id', businessId)
    .eq('feature_key', featureKey)
    .maybeSingle();

  if (override !== null && override !== undefined) {
    return override.is_enabled;
  }

  if (flag?.min_plan_slug === 'free') {
    return true;
  }

  const { data: biz } = await admin
    .from('businesses')
    .select('subscription_plan_id, subscription_plans(allowed_features)')
    .eq('id', businessId)
    .maybeSingle();

  const plan = biz?.subscription_plans as unknown as { allowed_features?: string[] } | null;
  if (plan?.allowed_features && Array.isArray(plan.allowed_features)) {
    return plan.allowed_features.includes(featureKey);
  }

  return true;
}

export async function createNotification(params: {
  businessId?: string | null;
  userId?: string | null;
  title: string;
  body: string;
  type?: string;
  link?: string;
}) {
  try {
    const admin = getSupabaseAdmin();
    await admin.from('notifications').insert({
      business_id: params.businessId || null,
      user_id: params.userId || null,
      title: params.title,
      body: params.body,
      type: params.type || 'info',
      link: params.link || '',
    });
  } catch (err) {
    console.error('[Notification Error]', err);
  }
}
