import crypto from 'crypto';

const SUPABASE_API_BASE = 'https://api.supabase.com/v1';

export interface SupabaseMgmtProject {
  id: string; // project ref
  organization_id: string;
  name: string;
  region: string;
  status: string;
  created_at?: string;
}

export interface SupabaseMgmtOrganization {
  id: string;
  name: string;
  slug?: string;
}

async function mgmtFetch<T>(accessToken: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${SUPABASE_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken.trim()}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });

  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  if (!res.ok) {
    let errMsg = `Supabase Management API error (${res.status})`;
    if (parsed && typeof parsed === 'object' && 'message' in parsed) {
      errMsg = String((parsed as { message: unknown }).message);
    } else if (typeof parsed === 'string' && parsed.trim()) {
      errMsg = parsed;
    }
    throw new Error(errMsg);
  }

  return parsed as T;
}

export async function listSupabaseProjectsAndOrgs(accessToken: string): Promise<{
  projects: SupabaseMgmtProject[];
  organizations: SupabaseMgmtOrganization[];
}> {
  const [projectsRes, orgsRes] = await Promise.allSettled([
    mgmtFetch<SupabaseMgmtProject[]>(accessToken, '/projects'),
    mgmtFetch<SupabaseMgmtOrganization[]>(accessToken, '/organizations'),
  ]);

  if (projectsRes.status === 'rejected') {
    throw projectsRes.reason;
  }

  const projects = Array.isArray(projectsRes.value) ? projectsRes.value : [];
  let organizations: SupabaseMgmtOrganization[] =
    orgsRes.status === 'fulfilled' && Array.isArray(orgsRes.value) ? orgsRes.value : [];

  if (organizations.length === 0 && projects.length > 0) {
    const seen = new Set<string>();
    organizations = projects
      .filter((p) => p.organization_id && !seen.has(p.organization_id) && seen.add(p.organization_id))
      .map((p) => ({ id: p.organization_id, name: p.organization_id }));
  }

  return { projects, organizations };
}

export async function createSupabaseProjectAuto(
  accessToken: string,
  params: { name: string; organizationId: string; region?: string }
): Promise<{ project: SupabaseMgmtProject; dbUrl: string }> {
  const dbPass = `${crypto.randomBytes(14).toString('hex')}Bx!9`;
  const created = await mgmtFetch<SupabaseMgmtProject>(accessToken, '/projects', {
    method: 'POST',
    body: JSON.stringify({
      name: params.name.trim() || 'bexpar-ai-db',
      organization_id: params.organizationId,
      region: params.region || 'ap-southeast-1',
      db_pass: dbPass,
    }),
  });

  // Poll project readiness up to ~90 seconds
  let current = created;
  const startedAt = Date.now();
  while (Date.now() - startedAt < 90000) {
    if (current.status === 'ACTIVE_HEALTHY') {
      break;
    }
    await new Promise((r) => setTimeout(r, 3500));
    try {
      const latest = await mgmtFetch<SupabaseMgmtProject>(accessToken, `/projects/${created.id}`);
      current = latest;
      if (current.status === 'ACTIVE_HEALTHY') break;
    } catch {
      // ignore transient polling error while provisioning
    }
  }

  const dbUrl = `postgresql://postgres:${encodeURIComponent(dbPass)}@db.${created.id}.supabase.co:5432/postgres`;
  return { project: current, dbUrl };
}

export async function fetchProjectApiKeysAuto(
  accessToken: string,
  projectRef: string
): Promise<{ url: string; anonKey: string; serviceRoleKey: string }> {
  const keys = await mgmtFetch<Array<{ name?: string; type?: string; api_key?: string }>>(
    accessToken,
    `/projects/${encodeURIComponent(projectRef)}/api-keys?reveal=true`
  );

  if (!Array.isArray(keys) || keys.length === 0) {
    throw new Error('Could not retrieve API keys for this Supabase project.');
  }

  const anonEntry =
    keys.find((k) => k.name === 'anon' && k.api_key) ||
    keys.find((k) => k.type === 'publishable' && k.api_key);
  const serviceEntry =
    keys.find((k) => k.name === 'service_role' && k.api_key) ||
    keys.find((k) => k.type === 'secret' && k.api_key);

  if (!anonEntry?.api_key || !serviceEntry?.api_key) {
    throw new Error(
      'Supabase did not return both anon/publishable and service_role/secret keys. Wait a few seconds if the project was just created, or use manual setup.'
    );
  }

  return {
    url: `https://${projectRef}.supabase.co`,
    anonKey: anonEntry.api_key,
    serviceRoleKey: serviceEntry.api_key,
  };
}

export async function executeSqlViaManagementApi(
  accessToken: string,
  projectRef: string,
  query: string
): Promise<unknown> {
  return mgmtFetch<unknown>(accessToken, `/projects/${encodeURIComponent(projectRef)}/database/query`, {
    method: 'POST',
    body: JSON.stringify({ query }),
  });
}
