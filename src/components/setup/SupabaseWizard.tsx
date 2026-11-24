import React, { useState } from 'react';
import {
  CheckCircle2,
  Copy,
  Database,
  ExternalLink,
  FolderPlus,
  KeyRound,
  Loader2,
  Server,
  ShieldAlert,
  Sparkles,
  Zap,
} from 'lucide-react';
import { apiFetch } from '../../lib/api';

interface SupabaseWizardProps {
  initialConnected?: boolean;
  initialSchemaReady?: boolean;
  initialError?: string;
  onConnected: () => void;
}

interface DiscoveredProject {
  id: string;
  organization_id: string;
  name: string;
  region: string;
  status: string;
}

interface DiscoveredOrg {
  id: string;
  name: string;
}

export const SupabaseWizard: React.FC<SupabaseWizardProps> = ({
  initialConnected = false,
  initialSchemaReady = false,
  initialError = '',
  onConnected,
}) => {
  const [mode, setMode] = useState<'auto' | 'manual'>('auto');

  // Auto-connect state
  const [accessToken, setAccessToken] = useState('');
  const [discovering, setDiscovering] = useState(false);
  const [projects, setProjects] = useState<DiscoveredProject[]>([]);
  const [orgs, setOrgs] = useState<DiscoveredOrg[]>([]);
  const [discovered, setDiscovered] = useState(false);
  const [showCreateNew, setShowCreateNew] = useState(false);
  const [newProjectName, setNewProjectName] = useState('bexpar-ai');
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [selectedRegion, setSelectedRegion] = useState('ap-southeast-1');

  // Manual connect state
  const [url, setUrl] = useState('');
  const [anonKey, setAnonKey] = useState('');
  const [serviceRoleKey, setServiceRoleKey] = useState('');
  const [dbUrl, setDbUrl] = useState('');

  // Shared state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(initialError);
  const [sqlScript, setSqlScript] = useState('');
  const [copied, setCopied] = useState(false);
  const [stepMessage, setStepMessage] = useState('');

  const handleDiscoverProjects = async (e: React.FormEvent) => {
    e.preventDefault();
    setDiscovering(true);
    setError('');
    try {
      const res = await apiFetch<{ projects: DiscoveredProject[]; organizations: DiscoveredOrg[] }>(
        '/api/system/supabase/discover',
        {
          method: 'POST',
          body: JSON.stringify({ accessToken }),
        }
      );
      setProjects(res.projects || []);
      setOrgs(res.organizations || []);
      if (res.organizations?.length) {
        setSelectedOrgId(res.organizations[0].id);
      }
      if (!res.projects?.length) {
        setShowCreateNew(true);
      }
      setDiscovered(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Supabase projects.');
    } finally {
      setDiscovering(false);
    }
  };

  const handleAutoConnectExisting = async (projectRef: string) => {
    setLoading(true);
    setError('');
    setStepMessage('Fetching API keys, running SQL migrations, RLS policies & storage setup...');
    try {
      const res = await apiFetch<{
        success: boolean;
        schemaReady: boolean;
        consolidatedSql?: string;
        error?: string;
      }>('/api/system/supabase/auto-connect', {
        method: 'POST',
        body: JSON.stringify({ accessToken, projectRef }),
      });

      if (res.schemaReady && res.success) {
        onConnected();
        return;
      }
      if (res.consolidatedSql) setSqlScript(res.consolidatedSql);
      if (res.error) setError(res.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Automatic connection failed.');
    } finally {
      setLoading(false);
      setStepMessage('');
    }
  };

  const handleAutoCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setStepMessage('Creating new Supabase project, waiting for database readiness & running migrations (up to 60s)...');
    try {
      const res = await apiFetch<{
        success: boolean;
        schemaReady: boolean;
        consolidatedSql?: string;
        error?: string;
      }>('/api/system/supabase/auto-connect', {
        method: 'POST',
        body: JSON.stringify({
          accessToken,
          createNew: true,
          projectName: newProjectName,
          organizationId: selectedOrgId,
          region: selectedRegion,
        }),
      });

      if (res.schemaReady && res.success) {
        onConnected();
        return;
      }
      if (res.consolidatedSql) setSqlScript(res.consolidatedSql);
      if (res.error) setError(res.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Auto-create failed.');
    } finally {
      setLoading(false);
      setStepMessage('');
    }
  };

  const handleManualConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setStepMessage('Verifying Supabase connection and applying SQL migrations...');
    try {
      const res = await apiFetch<{
        success: boolean;
        schemaReady: boolean;
        consolidatedSql?: string;
        error?: string;
      }>('/api/system/supabase/connect', {
        method: 'POST',
        body: JSON.stringify({ url, anonKey, serviceRoleKey, dbUrl: dbUrl || undefined }),
      });

      if (res.schemaReady && res.success) {
        onConnected();
        return;
      }

      if (res.consolidatedSql) {
        setSqlScript(res.consolidatedSql);
      }
      if (res.error) {
        setError(res.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed.');
    } finally {
      setLoading(false);
      setStepMessage('');
    }
  };

  const handleVerifySchema = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch<{
        success: boolean;
        schemaReady: boolean;
        consolidatedSql?: string;
        error?: string;
      }>('/api/system/supabase/verify', {
        method: 'POST',
        body: JSON.stringify({ dbUrl: dbUrl || undefined }),
      });
      if (res.schemaReady && res.success) {
        onConnected();
        return;
      }
      if (res.consolidatedSql) setSqlScript(res.consolidatedSql);
      setError(res.error || 'Schema is not initialized yet.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed.');
    } finally {
      setLoading(false);
    }
  };

  const loadSqlFallback = async () => {
    try {
      const res = await apiFetch<{ sql: string }>('/api/system/supabase/sql');
      setSqlScript(res.sql);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load SQL script.');
    }
  };

  const copySql = async () => {
    await navigator.clipboard.writeText(sqlScript);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4 md:p-8">
      <div className="w-full max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 md:p-8 shadow-sm">
        <div className="flex items-center gap-3 mb-5">
          <img
            src="/assets/aistudio/file_000000008b8c82088417c1ec660bd1b7_795facb3.png"
            alt="BeXpar Ai"
            className="w-11 h-11 rounded-xl object-cover shrink-0 shadow-sm"
          />
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">BeXpar Ai — Supabase Setup</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              1-Click Automatic Connect অথবা Manual Keys দিয়ে Supabase PostgreSQL কানেক্ট করুন।
            </p>
          </div>
        </div>

        {/* Mode Switcher */}
        <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 mb-5">
          <button
            type="button"
            onClick={() => {
              setMode('auto');
              setError('');
            }}
            className={`py-2 px-3 rounded-lg text-xs sm:text-sm font-medium flex items-center justify-center gap-1.5 transition-colors ${
              mode === 'auto'
                ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            <Zap className="w-4 h-4" />
            <span>1-Click Auto-Connect</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('manual');
              setError('');
            }}
            className={`py-2 px-3 rounded-lg text-xs sm:text-sm font-medium flex items-center justify-center gap-1.5 transition-colors ${
              mode === 'manual'
                ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            <KeyRound className="w-4 h-4" />
            <span>Manual Keys &amp; DB URL</span>
          </button>
        </div>

        {initialConnected && !initialSchemaReady && (
          <div className="mb-5 rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/30 p-4 text-sm text-amber-800 dark:text-amber-200 flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Supabase connected, waiting for SQL schema migration</p>
              <p className="mt-1 text-xs opacity-90">
                Use 1-Click Auto-Connect above or run the SQL migration script in your Supabase SQL Editor and click Verify Schema.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleVerifySchema}
                  disabled={loading}
                  className="px-3 py-1.5 rounded-lg bg-amber-700 text-white text-xs font-medium hover:bg-amber-800"
                >
                  Verify Schema Now
                </button>
                {!sqlScript && (
                  <button
                    type="button"
                    onClick={loadSqlFallback}
                    className="px-3 py-1.5 rounded-lg border border-amber-400 text-xs font-medium hover:bg-amber-100 dark:hover:bg-amber-900/40"
                  >
                    View SQL Migration Script
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="mb-5 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 p-3.5 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        {stepMessage && (
          <div className="mb-5 rounded-xl border border-indigo-200 dark:border-indigo-900/50 bg-indigo-50 dark:bg-indigo-950/30 p-3.5 text-xs text-indigo-800 dark:text-indigo-200 flex items-center gap-2.5">
            <Loader2 className="w-4 h-4 animate-spin shrink-0" />
            <span>{stepMessage}</span>
          </div>
        )}

        {mode === 'auto' ? (
          <div className="space-y-5">
            <div className="rounded-xl border border-indigo-100 dark:border-indigo-900/40 bg-indigo-50/70 dark:bg-indigo-950/20 p-4 text-xs text-slate-700 dark:text-slate-300 space-y-2">
              <div className="font-semibold text-indigo-900 dark:text-indigo-200 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-indigo-600" />
                <span>শুধু ১টি Supabase Access Token দিন — বাকি সব অটোমেটিক হবে</span>
              </div>
              <p>
                আপনার Supabase Personal Access Token (<span className="font-mono">sbp_...</span>) দিলে BeXpar Ai নিজে থেকেই আপনার প্রজেক্ট লিস্ট আনবে (অথবা নতুন প্রজেক্ট তৈরি করবে), API Key গুলো সংযুক্ত করবে এবং সব SQL টেবিল, RLS ও Storage Bucket অটোমেটিক সেটআপ করবে।
              </p>
              <a
                href="https://supabase.com/dashboard/account/tokens"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                <span>Open Supabase Access Tokens Dashboard</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>

            <form onSubmit={handleDiscoverProjects} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Supabase Personal Access Token *
                </label>
                <div className="flex gap-2">
                  <input
                    type="password"
                    required
                    value={accessToken}
                    onChange={(e) => setAccessToken(e.target.value)}
                    placeholder="sbp_xxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    className="flex-1 px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <button
                    type="submit"
                    disabled={discovering || loading}
                    className="px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium flex items-center gap-2 disabled:opacity-60 shrink-0"
                  >
                    {discovering ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                    <span>Load Projects</span>
                  </button>
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  Used once during setup on the server to configure your project; never saved to disk or exposed to browsers.
                </p>
              </div>
            </form>

            {discovered && (
              <div className="space-y-4 pt-2 border-t border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                    Your Supabase Projects ({projects.length})
                  </h3>
                  {orgs.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowCreateNew((v) => !v)}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                      <FolderPlus className="w-3.5 h-3.5" />
                      <span>{showCreateNew ? 'Hide Create Form' : 'Create New Project Automatically'}</span>
                    </button>
                  )}
                </div>

                {projects.length > 0 && (
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {projects.map((p) => (
                      <div
                        key={p.id}
                        className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                      >
                        <div>
                          <div className="text-sm font-semibold text-slate-900 dark:text-white">{p.name}</div>
                          <div className="text-xs text-slate-500 font-mono">
                            {p.id} · {p.region} · {p.status}
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={loading || p.status !== 'ACTIVE_HEALTHY'}
                          onClick={() => void handleAutoConnectExisting(p.id)}
                          className="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-50"
                        >
                          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                          <span>Auto-Connect &amp; Migrate</span>
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {showCreateNew && orgs.length > 0 && (
                  <form
                    onSubmit={handleAutoCreateProject}
                    className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 space-y-3"
                  >
                    <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                      Auto-Create Brand New Supabase Project &amp; Migrate
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      <input
                        type="text"
                        required
                        value={newProjectName}
                        onChange={(e) => setNewProjectName(e.target.value)}
                        placeholder="Project Name"
                        className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                      />
                      <select
                        value={selectedOrgId}
                        onChange={(e) => setSelectedOrgId(e.target.value)}
                        className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                      >
                        {orgs.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name}
                          </option>
                        ))}
                      </select>
                      <select
                        value={selectedRegion}
                        onChange={(e) => setSelectedRegion(e.target.value)}
                        className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                      >
                        <option value="ap-southeast-1">Singapore (ap-southeast-1)</option>
                        <option value="ap-south-1">Mumbai (ap-south-1)</option>
                        <option value="us-east-1">US East (us-east-1)</option>
                        <option value="eu-west-1">Ireland (eu-west-1)</option>
                      </select>
                    </div>
                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium flex items-center justify-center gap-2 disabled:opacity-60"
                    >
                      {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FolderPlus className="w-3.5 h-3.5" />}
                      <span>Create Project &amp; Auto-Setup Everything</span>
                    </button>
                  </form>
                )}
              </div>
            )}
          </div>
        ) : (
          <form onSubmit={handleManualConnect} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                Supabase Project URL or Project ID *
              </label>
              <div className="relative">
                <Server className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                <input
                  type="text"
                  required
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://your-project-ref.supabase.co or project-ref"
                  className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Publishable / Anon Key *
                </label>
                <input
                  type="text"
                  required
                  value={anonKey}
                  onChange={(e) => setAnonKey(e.target.value)}
                  placeholder="eyJhbGciOi..."
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Server-Side Service Role Secret *
                </label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  <input
                    type="password"
                    required
                    value={serviceRoleKey}
                    onChange={(e) => setServiceRoleKey(e.target.value)}
                    placeholder="Stored securely on server only"
                    className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                Postgres Database Connection URL (Recommended for Auto-Migration)
              </label>
              <div className="relative">
                <Database className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                <input
                  type="password"
                  value={dbUrl}
                  onChange={(e) => setDbUrl(e.target.value)}
                  placeholder="postgresql://postgres:[YOUR-PASSWORD]@db.xxxx.supabase.co:5432/postgres"
                  className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Used strictly on the server to automatically execute SQL migrations, RLS policies, indexes, and atomic functions. Never exposed to the browser.
              </p>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              <span>{loading ? stepMessage || 'Connecting...' : 'Connect Supabase & Initialize Database'}</span>
            </button>
          </form>
        )}

        {sqlScript && (
          <div className="mt-6 border-t border-slate-200 dark:border-slate-800 pt-5">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Manual SQL Migration Script (Run in Supabase SQL Editor if needed)
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={copySql}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>{copied ? 'Copied' : 'Copy SQL'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleVerifySchema}
                  disabled={loading}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700"
                >
                  Verify Schema
                </button>
              </div>
            </div>
            <textarea
              readOnly
              value={sqlScript}
              rows={8}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-950 text-slate-100 p-3 text-xs font-mono"
            />
          </div>
        )}
      </div>
    </div>
  );
};
