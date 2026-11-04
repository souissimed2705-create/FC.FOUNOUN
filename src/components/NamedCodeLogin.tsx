import React, { useState } from 'react';
import { signInWithCustomToken } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { managementLogin } from '../lib/operationsApi';

interface Props { role: 'admin' | 'responsible'; title: string; }

export const NamedCodeLogin: React.FC<Props> = ({ role, title }) => {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !/^\d{6}$/.test(code)) {
      setError('أدخل الاسم والكود السري المكوّن من 6 أرقام.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await managementLogin(name.trim(), code, role);
      await signInWithCustomToken(auth, result.customToken);
      setCode('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تسجيل الدخول.');
    } finally {
      setBusy(false);
    }
  };
  return <form onSubmit={submit} dir="rtl" className="w-full rounded-2xl border border-[#D4AF37]/30 bg-[#111] p-5 shadow-2xl space-y-3">
    <h2 className="text-center text-lg font-bold text-[#F5D77F]">{title}</h2>
    <p className="text-center text-xs text-gray-400">الدخول بالاسم والكود السري الذي عيّنه المشرف العام.</p>
    <input className="field w-full" value={name} onChange={e => setName(e.target.value)} placeholder="الاسم" autoComplete="username" disabled={busy} />
    <input className="field w-full text-center tracking-[0.4em]" value={code} onChange={e => setCode(e.target.value.replace(/\\D/g, '').slice(0, 6))} placeholder="الكود السري من 6 أرقام" inputMode="numeric" type="password" autoComplete="current-password" maxLength={6} disabled={busy} />
    {error && <p role="alert" className="rounded-lg bg-red-950/40 p-3 text-sm text-red-200">{error}</p>}
    <button disabled={busy} className="gold-button w-full">{busy ? 'جارٍ التحقق...' : 'دخول'}</button>
  </form>;
};
