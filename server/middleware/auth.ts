import type { NextFunction, Request, Response } from 'express';
import { getSupabaseAdmin } from '../config/supabaseConfig.ts';
import { isFeatureEnabledForBusiness } from '../db/repository.ts';

export interface AuthenticatedProfile {
  id: string;
  email: string;
  full_name: string;
  role: string;
  status: string;
  language: string;
  timezone: string;
}

export interface AuthedRequest extends Request {
  user?: AuthenticatedProfile;
  businessId?: string;
  businessRole?: string;
  memberPermissions?: Record<string, boolean>;
}

export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid authorization header.' });
    }
    const token = authHeader.slice(7).trim();
    const admin = getSupabaseAdmin();
    const { data: userData, error } = await admin.auth.getUser(token);
    if (error || !userData?.user) {
      return res.status(401).json({ error: 'Invalid or expired session.' });
    }

    let { data: profile } = await admin
      .from('profiles')
      .select('*')
      .eq('id', userData.user.id)
      .maybeSingle();

    if (!profile) {
      const insertPayload = {
        id: userData.user.id,
        email: userData.user.email || '',
        full_name:
          (userData.user.user_metadata?.full_name as string) ||
          (userData.user.user_metadata?.name as string) ||
          userData.user.email?.split('@')[0] ||
          'User',
        avatar_url:
          (userData.user.user_metadata?.avatar_url as string) ||
          (userData.user.user_metadata?.picture as string) ||
          '',
        role: 'business_owner',
        status: 'active',
        language: 'bn',
      };
      const { data: created, error: createErr } = await admin
        .from('profiles')
        .insert(insertPayload)
        .select('*')
        .single();
      if (createErr) {
        return res.status(500).json({ error: `Failed to initialize profile: ${createErr.message}` });
      }
      profile = created;
    }

    if (profile.status === 'suspended' || profile.status === 'inactive') {
      return res.status(403).json({
        error: `Account is ${profile.status}. Please contact BeXpar Ai support.`,
        accountStatus: profile.status,
      });
    }

    req.user = profile as AuthenticatedProfile;
    next();
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Authentication error' });
  }
}

export function requireSuperAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Forbidden: Super Admin privileges required.' });
  }
  next();
}

export function requireBusinessAccess(permissionKey?: string) {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

      const businessId =
        (req.headers['x-business-id'] as string) ||
        (req.params.businessId as string) ||
        (req.query.businessId as string);

      if (!businessId) {
        return res.status(400).json({ error: 'Business ID is required (x-business-id header).' });
      }

      const admin = getSupabaseAdmin();

      if (req.user.role === 'super_admin') {
        req.businessId = businessId;
        req.businessRole = 'super_admin';
        req.memberPermissions = { inbox: true, orders: true, products: true, customers: true, analytics: true, settings: true };
        return next();
      }

      const { data: biz } = await admin
        .from('businesses')
        .select('id, owner_id, status')
        .eq('id', businessId)
        .maybeSingle();

      if (!biz) {
        return res.status(404).json({ error: 'Business not found.' });
      }

      if (biz.status !== 'active') {
        return res.status(403).json({ error: `Business account is ${biz.status}.` });
      }

      if (biz.owner_id === req.user.id) {
        req.businessId = businessId;
        req.businessRole = 'business_owner';
        req.memberPermissions = { inbox: true, orders: true, products: true, customers: true, analytics: true, settings: true };
        return next();
      }

      const { data: member } = await admin
        .from('business_members')
        .select('role, permissions, status')
        .eq('business_id', businessId)
        .eq('user_id', req.user.id)
        .maybeSingle();

      if (!member || member.status !== 'active') {
        return res.status(403).json({ error: 'Access denied to this business workspace.' });
      }

      const perms = (member.permissions || {}) as Record<string, boolean>;
      if (permissionKey && member.role !== 'business_admin' && !perms[permissionKey]) {
        return res.status(403).json({ error: `Permission '${permissionKey}' is required for this action.` });
      }

      req.businessId = businessId;
      req.businessRole = member.role;
      req.memberPermissions = perms;
      next();
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Authorization error' });
    }
  };
}

export function requireFeature(featureKey: string) {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.businessId) return res.status(400).json({ error: 'Business context required.' });
      if (req.user?.role === 'super_admin') return next();

      const allowed = await isFeatureEnabledForBusiness(req.businessId, featureKey);
      if (!allowed) {
        return res.status(403).json({
          error: `Feature '${featureKey}' is not enabled on your current subscription plan.`,
          code: 'FEATURE_LOCKED',
          featureKey,
        });
      }
      next();
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Feature check failed' });
    }
  };
}

const rateMap = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const record = rateMap.get(key);
    if (!record || record.resetAt < now) {
      rateMap.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (record.count >= maxRequests) {
      return res.status(429).json({ error: 'Too many requests. Please try again shortly.' });
    }
    record.count += 1;
    next();
  };
}
