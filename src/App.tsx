/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { AdminLoginForm } from './components/AdminLoginForm';
import { AdminDashboard } from './components/AdminDashboard';
import { WorkerLogin } from './components/WorkerLogin';
import { NamedCodeLogin } from './components/NamedCodeLogin';
import { WorkerDashboard } from './components/WorkerDashboard';
import { PWAInstallBadge } from './components/PWAInstallBadge';
import { NotificationsBell } from './components/NotificationsBell';
import { PrivateMessagesPanel } from './components/PrivateMessagesPanel';
import { MessageCircle, X } from 'lucide-react';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { WifiOff, Sparkles, Crown } from 'lucide-react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import {
  auth,
  isFirebaseConfigured,
  getFirebaseConfigurationError,
  verifyAdmin,
  UserProfile,
  mapAuthorizationErrorToArabic,
} from './lib/firebase';

export default function App() {
  const isOnline = useOnlineStatus();
  const [verifiedAdmin, setVerifiedAdmin] = useState<UserProfile | null>(null);
  const [verifiedWorker, setVerifiedWorker] = useState<{ id: string; name: string } | null>(null);
  const [loginMode, setLoginMode] = useState<'super_admin' | 'admin' | 'responsible' | 'worker'>('super_admin');
  const [isCheckingInitialAuth, setIsCheckingInitialAuth] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [showPrivateMessages, setShowPrivateMessages] = useState(false);
  const openPrivateMessages = () => {
    window.history.pushState({ fcFounounModal: 'private-messages' }, '');
    setShowPrivateMessages(true);
  };
  const closePrivateMessages = () => {
    setShowPrivateMessages(false);
    if (window.history.state?.fcFounounModal === 'private-messages') window.history.back();
  };
  useEffect(() => {
    if (!showPrivateMessages) return;
    const handleBack = () => setShowPrivateMessages(false);
    window.addEventListener('popstate', handleBack);
    return () => window.removeEventListener('popstate', handleBack);
  }, [showPrivateMessages]);

  // Synchronize and verify current active session against Firestore RBAC
  useEffect(() => {
    if (!isFirebaseConfigured()) {
      setSessionError(getFirebaseConfigurationError());
      setIsCheckingInitialAuth(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        try {
          const tokenResult = await user.getIdTokenResult();
          if (tokenResult.claims.role === 'worker' && tokenResult.claims.workerId === user.uid) {
            setVerifiedWorker({ id: user.uid, name: String(tokenResult.claims.workerName || 'العامل') });
            setVerifiedAdmin(null);
            setSessionError(null);
          } else {
            const profile = await verifyAdmin(user.uid);
            setVerifiedAdmin(profile);
            setVerifiedWorker(null);
            setSessionError(null);
          }
        } catch (err: unknown) {
          await signOut(auth);
          setVerifiedAdmin(null);
          setVerifiedWorker(null);
          const errorObj = err as { message?: string; code?: string };
          setSessionError(mapAuthorizationErrorToArabic(errorObj?.message || errorObj?.code || ''));
        }
      } else {
        setVerifiedAdmin(null);
        setVerifiedWorker(null);
      }
      setIsCheckingInitialAuth(false);
    });

    return () => unsubscribe();
  }, []);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await signOut(auth);
      setVerifiedAdmin(null);
      setVerifiedWorker(null);
      setSessionError(null);
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      setIsLoggingOut(false);
    }
  };

  if (!isFirebaseConfigured()) {
    return (
      <div dir="rtl" className="min-h-screen bg-[#080808] text-white flex items-center justify-center p-6">
        <main className="w-full max-w-xl rounded-2xl border border-[#D4AF37]/40 bg-[#111] p-6 text-center shadow-2xl">
          <h1 className="mb-3 text-xl font-bold text-[#F5D77F]">يلزم ضبط اتصال Firebase</h1>
          <p className="text-sm leading-7 text-gray-300">
            {sessionError || 'إعداد Firebase غير مكتمل. يرجى ضبط متغيرات VITE_FIREBASE_* ثم إعادة بناء التطبيق.'}
          </p>
          <p className="mt-4 text-xs leading-6 text-gray-500">
            استخدم إعداد Web الرسمي من مشروع fc-founoun في Firebase Console، ولا تضع مفاتيح Service Account في التطبيق.
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#080808] text-white flex flex-col justify-between relative selection:bg-[#D4AF37]/30 selection:text-[#F3E5AB]">
      {/* Background Luxury Ambient Glows */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-96 h-96 bg-[#D4AF37]/10 rounded-full blur-[120px]"></div>
        <div className="absolute -bottom-32 right-1/4 w-80 h-80 bg-[#B38728]/5 rounded-full blur-[100px]"></div>
      </div>

      {/* Offline Status Banner */}
      {!isOnline && (
        <div className="relative z-50 bg-[#251A0A] border-b border-[#D4AF37]/40 px-4 py-2 text-center text-xs text-[#F5D77F] flex items-center justify-center gap-2">
          <WifiOff className="w-3.5 h-3.5 text-[#D4AF37] animate-pulse" />
          <span>أنت تعمل حالياً في وضع عدم الاتصال (PWA Offline)</span>
        </div>
      )}

      {/* Top Bar / Navigation */}
      <header className="relative z-10 w-full border-b border-white/5 bg-[#0A0A0A]/80 backdrop-blur-md px-4 sm:px-6 py-3.5">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          {/* Brand Monogram Left */}
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#BF953F] via-[#FCF6BA] to-[#AA771C] p-[1px] shadow-sm">
              <div className="w-full h-full bg-[#0E0E0E] rounded-[7px] flex items-center justify-center">
                <Crown className="w-4 h-4 text-[#D4AF37]" />
              </div>
            </div>
            <div className="flex flex-col">
              <span className="font-['Cinzel'] tracking-widest text-xs font-bold text-white">
                FONOUN CHAUSSURES
              </span>
              <span className="text-[10px] text-gray-400 font-['Cairo'] -mt-0.5">
                فنون للأحذية الفاخرة
              </span>
            </div>
          </div>

          {/* Right Action: PWA Install Button */}
          <div className="flex items-center gap-2">
            {(verifiedAdmin || verifiedWorker) && <>
              <NotificationsBell />
              <button type="button" onClick={openPrivateMessages} aria-label="فتح الرسائل الخاصة" title="الرسائل الخاصة" className="relative flex h-10 w-10 items-center justify-center rounded-full border border-[#D4AF37]/50 bg-[#D4AF37]/10 text-[#F5D77F] transition hover:bg-[#D4AF37]/20 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]">
                <MessageCircle className="h-5 w-5" />
              </button>
            </>}
            <PWAInstallBadge />
          </div>
        </div>
      </header>

      {showPrivateMessages && (verifiedAdmin || verifiedWorker) && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="المراسلات الخاصة" onClick={(event) => { if (event.target === event.currentTarget) closePrivateMessages(); }}>
          <section className="relative max-h-[88vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-[#D4AF37]/50 bg-[#0D0D0D] p-3 pt-14 shadow-2xl" dir="rtl">
            <button type="button" onClick={closePrivateMessages} aria-label="إغلاق الرسائل" className="absolute left-3 top-3 flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/5 text-gray-200 hover:border-[#D4AF37]/60 hover:text-[#F5D77F]"><X className="h-5 w-5" /></button>
            <PrivateMessagesPanel />
          </section>
        </div>
      )}

      {/* Main Content Area */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-4 py-8 sm:py-12 w-full">
        {isCheckingInitialAuth ? (
          // Clean luxury initial loading spinner
          <div className="flex flex-col items-center justify-center py-16 space-y-3">
            <div className="w-10 h-10 border-2 border-[#D4AF37]/20 border-t-[#D4AF37] rounded-full animate-spin"></div>
            <span className="text-xs text-gray-400 font-medium">
              جاري فحص حالة الجلسة والأمان...
            </span>
          </div>
        ) : verifiedAdmin ? (
          <AdminDashboard admin={verifiedAdmin} onLogout={handleLogout} isLoggingOut={isLoggingOut} />
        ) : verifiedWorker ? (
          <WorkerDashboard worker={verifiedWorker} />
        ) : (
          <div className="w-full max-w-md mx-auto flex flex-col items-center">
            {/* Brand Logo & Presentation */}
            <div className="text-center mb-6 sm:mb-8 select-none">
              {/* Elegant Crest Icon */}
              <div className="inline-flex items-center justify-center w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-[#121212] border border-[#D4AF37]/40 shadow-xl mb-3 relative gold-glow">
                <div className="absolute inset-1 rounded-xl border border-[#D4AF37]/20 border-dashed"></div>
                <span className="font-['Cinzel'] text-2xl sm:text-3xl font-extrabold text-gold-gradient tracking-wider">
                  FC
                </span>
              </div>

              {/* Main Text Logo */}
              <h1 className="font-['Cinzel'] text-2xl sm:text-3xl font-bold tracking-[0.2em] text-white">
                FONOUN CHAUSSURES
              </h1>

              {/* Brand Sub-title */}
              <div className="flex items-center justify-center gap-2 mt-1">
                <span className="h-px w-6 bg-gradient-to-r from-transparent to-[#D4AF37]/50"></span>
                <p className="font-['Cairo'] text-xs sm:text-sm text-[#D4AF37] font-semibold tracking-wider">
                  فنون للأحذية الفاخرة
                </p>
                <span className="h-px w-6 bg-gradient-to-l from-transparent to-[#D4AF37]/50"></span>
              </div>
              <p className="mt-3 max-w-sm text-xs leading-6 text-gray-400">للبحث عن الموديلات وتنظيم أوامر الإنتاج ومتابعة إنجاز العمل.</p>
            </div>

            <div className="mb-3 grid w-full grid-cols-2 gap-2 rounded-xl border border-white/10 bg-[#111] p-1">
              <button className={`tab-button ${loginMode === 'super_admin' ? 'tab-active' : ''}`} onClick={() => setLoginMode('super_admin')}>المشرف العام</button>
              <button className={`tab-button ${loginMode === 'admin' ? 'tab-active' : ''}`} onClick={() => setLoginMode('admin')}>المدير العام</button>
              <button className={`tab-button ${loginMode === 'responsible' ? 'tab-active' : ''}`} onClick={() => setLoginMode('responsible')}>المسؤول</button>
              <button className={`tab-button ${loginMode === 'worker' ? 'tab-active' : ''}`} onClick={() => setLoginMode('worker')}>مشرف العمال</button>
            </div>
            {loginMode === 'super_admin' ? (
              <AdminLoginForm onSuccess={(admin) => setVerifiedAdmin(admin)} externalError={sessionError} onClearExternalError={() => setSessionError(null)} />
            ) : loginMode === 'admin' ? <NamedCodeLogin role="admin" title="دخول المدير العام" />
            : loginMode === 'responsible' ? <NamedCodeLogin role="responsible" title="دخول المسؤول" />
            : <WorkerLogin />}
          </div>
        )}
      </main>

      {/* Bottom Footer */}
      <footer className="relative z-10 w-full border-t border-white/5 bg-[#070707] py-4 px-4 safe-pb text-center text-xs text-gray-500">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px]">
          <p className="text-gray-400">
            جميع الحقوق محفوظة © {new Date().getFullYear()} FONOUN CHAUSSURES
          </p>
          <div className="flex items-center gap-1.5 text-[#D4AF37]/80">
            <Sparkles className="w-3 h-3" />
            <span>نظام الحماية والمصادقة المزدوجة (Auth + Firestore RBAC)</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
