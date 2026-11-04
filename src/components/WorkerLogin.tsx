import React, { useState } from 'react';
import { signInWithCustomToken } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { workerLogin } from '../lib/operationsApi';

export const WorkerLogin: React.FC = () => {
  const [workerId, setWorkerId] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!workerId.trim() || !/^\\d{6}$/.test(pin)) {
      setError('أدخل رمز العامل وPIN من ستة أرقام.');
      return;
    }
    setBusy(true); setError('');
    try {
      const result = await workerLogin(workerId.trim(), pin);
      await signInWithCustomToken(auth, result.customToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تسجيل الدخول.');
    } finally { setBusy(false); }
  };
  return <form onSubmit={submit} dir="rtl" className="w-full rounded-2xl border border-[#D4AF37]/30 bg-[#111] p-5 shadow-2xl space-y-3">
    <h2 className="text-center text-lg font-bold text-[#F5D77F]">دخول العامل</h2>
    <p className="text-center text-xs text-gray-400">أدخل رمز العامل الذي سلّمه لك المشرف ورمز PIN.</p>
    <input className="field w-full" value={workerId} onChange={e => setWorkerId(e.target.value)} placeholder="رمز العامل" autoComplete="username" />
    <input className="field w-full text-center tracking-[0.4em]" value={pin} onChange={e => setPin(e.target.value.replace(/\\D/g, '').slice(0, 6))} placeholder="PIN من 6 أرقام" inputMode="numeric" type="password" autoComplete="current-password" maxLength={6} />
    {error && <p role="alert" className="rounded-lg bg-red-950/40 p-3 text-sm text-red-200">{error}</p>}
    <button disabled={busy} className="gold-button w-full">{busy ? 'جارٍ التحقق...' : 'دخول'}</button>
  </form>;
};
