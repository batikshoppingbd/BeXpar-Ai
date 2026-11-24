import React, { useState } from 'react';
import { Loader2, Lock, Mail, Moon, Sun, User } from 'lucide-react';
import { getBrowserSupabase } from '../../lib/supabaseClient';
import type { AppSettings } from '../../types';
import type { Lang } from '../../i18n/translations';
import { PWAInstallButton } from '../pwa/PWAControls';

interface AuthScreenProps {
  appSettings: AppSettings;
  lang: Lang;
  onToggleLang: () => void;
  dark: boolean;
  onToggleDark: () => void;
  onAuthenticated: () => void;
  initialMode?: 'login' | 'register';
  onBackToHome?: () => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({
  appSettings,
  lang,
  onToggleLang,
  dark,
  onToggleDark,
  onAuthenticated,
  initialMode = 'login',
  onBackToHome,
}) => {
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');

    try {
      const supabase = getBrowserSupabase();

      if (mode === 'login') {
        const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
        if (signInErr) throw signInErr;
        onAuthenticated();
      } else if (mode === 'register') {
        if (!appSettings.registration_enabled) {
          throw new Error('New user registrations are currently paused by the administrator.');
        }
        const { data, error: signUpErr } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullName },
            emailRedirectTo: window.location.origin,
          },
        });
        if (signUpErr) throw signUpErr;
        if (data.session) {
          onAuthenticated();
        } else {
          setMessage(
            lang === 'bn'
              ? 'রেজিস্ট্রেশন সম্পন্ন হয়েছে! অনুগ্রহ করে আপনার ইমেইল ইনবক্স থেকে ভেরিফিকেশন লিংক নিশ্চিত করুন।'
              : 'Registration successful! Please check your email inbox to verify your account before signing in.'
          );
          setMode('login');
        }
      } else if (mode === 'forgot') {
        const { error: resetErr } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin,
        });
        if (resetErr) throw resetErr;
        setMessage(
          lang === 'bn'
            ? 'পাসওয়ার্ড রিসেট লিংক আপনার ইমেইলে পাঠানো হয়েছে।'
            : 'Password reset link has been sent to your email.'
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    try {
      const supabase = getBrowserSupabase();
      const { error: oauthErr } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      });
      if (oauthErr) throw oauthErr;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google Sign-In failed.');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col justify-between p-4 md:p-8">
      <div className="max-w-5xl w-full mx-auto flex items-center justify-between">
        <button
          type="button"
          onClick={onBackToHome}
          className="flex items-center gap-2.5 text-left hover:opacity-90"
        >
          <img
            src="/assets/aistudio/file_000000008b8c82088417c1ec660bd1b7_795facb3.png"
            alt={appSettings.app_name || 'BeXpar Ai'}
            className="w-9 h-9 rounded-xl object-cover shrink-0 shadow-sm"
          />
          <span className="font-display font-bold text-lg text-slate-900 dark:text-white">
            {appSettings.app_name || 'BeXpar Ai'}
          </span>
        </button>
        <div className="flex items-center gap-2">
          {onBackToHome && (
            <button
              type="button"
              onClick={onBackToHome}
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-900"
            >
              {lang === 'bn' ? 'হোম পেজ' : 'Home'}
            </button>
          )}
          <PWAInstallButton compact label={lang === 'bn' ? 'অ্যাপ ইনস্টল' : 'Install App'} />
          <button
            type="button"
            onClick={onToggleLang}
            className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-900"
          >
            {lang === 'bn' ? 'English' : 'বাংলা'}
          </button>
          <button
            type="button"
            onClick={onToggleDark}
            aria-label="Toggle theme"
            className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-900"
          >
            {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </div>

      <div className="w-full max-w-md mx-auto my-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 md:p-8 shadow-sm">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            {mode === 'login'
              ? lang === 'bn'
                ? 'BeXpar Ai-এ লগইন করুন'
                : 'Sign in to BeXpar Ai'
              : mode === 'register'
              ? lang === 'bn'
                ? 'নতুন অ্যাকাউন্ট খুলুন'
                : 'Create your business account'
              : lang === 'bn'
              ? 'পাসওয়ার্ড রিসেট করুন'
              : 'Reset your password'}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {lang === 'bn'
              ? 'Facebook, Instagram ও WhatsApp অটোমেশন একই ড্যাশবোর্ডে।'
              : 'Omnichannel AI sales, inbox, orders, and courier automation.'}
          </p>
        </div>

        {appSettings.maintenance_mode && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 p-3 text-xs text-amber-800 dark:text-amber-200">
            Platform is currently in maintenance mode. Only Super Admins can sign in.
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-900 p-3 text-xs text-red-700 dark:text-red-300">
            {error}
          </div>
        )}
        {message && (
          <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-900 p-3 text-xs text-emerald-700 dark:text-emerald-300">
            {message}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'register' && (
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                {lang === 'bn' ? 'আপনার নাম' : 'Full Name'}
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Rashidul Islam"
                  className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              {lang === 'bn' ? 'ইমেইল ঠিকানা' : 'Email Address'}
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="owner@business.com"
                className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          {mode !== 'forgot' && (
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                {lang === 'bn' ? 'পাসওয়ার্ড' : 'Password'}
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            <span>
              {mode === 'login'
                ? lang === 'bn'
                  ? 'লগইন করুন'
                  : 'Sign In'
                : mode === 'register'
                ? lang === 'bn'
                  ? 'অ্যাকাউন্ট তৈরি করুন'
                  : 'Create Account'
                : lang === 'bn'
                ? 'রিসেট লিংক পাঠান'
                : 'Send Reset Link'}
            </span>
          </button>
        </form>

        {mode !== 'forgot' && (
          <>
            <div className="my-5 flex items-center gap-3 text-xs text-slate-400">
              <div className="flex-1 h-px bg-slate-200 dark:bg-slate-800" />
              <span>{lang === 'bn' ? 'অথবা' : 'OR'}</span>
              <div className="flex-1 h-px bg-slate-200 dark:bg-slate-800" />
            </div>

            <button
              type="button"
              onClick={handleGoogleSignIn}
              className="w-full py-2.5 px-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-medium text-slate-700 dark:text-slate-200 flex items-center justify-center gap-2 transition-colors"
            >
              <span>{lang === 'bn' ? 'Google দিয়ে চালিয়ে যান' : 'Continue with Google'}</span>
            </button>
          </>
        )}

        <div className="mt-6 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
          {mode === 'login' ? (
            <>
              <button type="button" onClick={() => setMode('forgot')} className="hover:text-indigo-600">
                {lang === 'bn' ? 'পাসওয়ার্ড ভুলে গেছেন?' : 'Forgot password?'}
              </button>
              {appSettings.registration_enabled && (
                <button type="button" onClick={() => setMode('register')} className="font-medium text-indigo-600 hover:underline">
                  {lang === 'bn' ? 'নতুন অ্যাকাউন্ট খুলুন' : 'Create account'}
                </button>
              )}
            </>
          ) : (
            <button type="button" onClick={() => setMode('login')} className="font-medium text-indigo-600 hover:underline">
              {lang === 'bn' ? 'আগের অ্যাকাউন্টে লগইন করুন' : 'Back to sign in'}
            </button>
          )}
        </div>
      </div>

      <div className="text-center text-xs text-slate-400">
        {appSettings.app_name || 'BeXpar Ai'} · {appSettings.support_email || 'support@bexpar.ai'}
      </div>
    </div>
  );
};
