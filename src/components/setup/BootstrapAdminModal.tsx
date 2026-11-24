import React, { useState } from 'react';
import { Loader2, ShieldCheck, X } from 'lucide-react';
import { apiFetch } from '../../lib/api';

interface BootstrapAdminModalProps {
  onSuccess: () => void;
  onClose: () => void;
}

export const BootstrapAdminModal: React.FC<BootstrapAdminModalProps> = ({ onSuccess, onClose }) => {
  const [verificationCode, setVerificationCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await apiFetch('/api/system/claim-owner', {
        method: 'POST',
        body: JSON.stringify({ verificationCode }),
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-5 h-5 text-indigo-600" />
            <h2 className="text-base font-bold text-slate-900 dark:text-white">First-Time Super Admin Setup</h2>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-slate-600 dark:text-slate-400 mb-4 leading-relaxed">
          No Super Admin exists yet. Enter the one-time server bootstrap verification code (logged in server startup console or set via <code className="font-mono">ADMIN_BOOTSTRAP_SECRET</code>) to promote your current authenticated account to Super Admin.
        </p>

        {error && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/30 p-2.5 text-xs text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Bootstrap Verification Code *
            </label>
            <input
              type="text"
              required
              value={verificationCode}
              onChange={(e) => setVerificationCode(e.target.value)}
              placeholder="BEXPAR-ADMIN-XXXXXXXX"
              className="w-full px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium flex items-center justify-center gap-2"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            <span>Verify & Claim Super Admin</span>
          </button>
        </form>
      </div>
    </div>
  );
};
