import React, { useEffect, useState } from 'react';
import { createManagementAccount, freezeManagementAccount, listManagementAccounts, setManagementCode, updateManagementAccount } from '../lib/operationsApi';
import type { ManagementAccountRecord } from '../types/operations';

export const ManagementAccountsPanel: React.FC = () => {
  const [accounts, setAccounts] = useState<ManagementAccountRecord[]>([]);
  const [name, setName] = useState('');
  const [role, setRole] = useState<'admin' | 'responsible'>('admin');
  const [shift, setShift] = useState<'day' | 'night'>('day');
  const [code, setCode] = useState('');
  const [edits, setEdits] = useState<Record<string, { name: string; code: string }>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const refresh = async () => {
    try {
      const result = await listManagementAccounts();
      setAccounts(result.data || []);
      setEdits(current => Object.fromEntries((result.data || []).map(account => [account.uid, current[account.uid] || { name: account.displayName, code: '' }])));
    } catch (err) { setError(err instanceof Error ? err.message : 'تعذر تحميل الحسابات.'); }
  };
  useEffect(() => { void refresh(); }, []);
  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !/^\d{6}$/.test(code)) { setError('أدخل الاسم وكوداً سرياً من 6 أرقام.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      await createManagementAccount({ name: name.trim(), role, code, ...(role === 'responsible' ? { shift } : {}) });
      setName(''); setCode(''); setNotice('تم إنشاء الحساب وتعيين الكود السري.'); await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : 'تعذر إنشاء الحساب.'); }
    finally { setBusy(false); }
  };
  const saveName = async (account: ManagementAccountRecord) => {
    const next = edits[account.uid]?.name?.trim();
    if (!next) { setError('اسم الحساب لا يمكن أن يكون فارغاً.'); return; }
    setBusy(true); setError(''); setNotice('');
    try { await updateManagementAccount(account.uid, { name: next }); setNotice('تم تحديث الاسم.'); await refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : 'تعذر تحديث الاسم.'); }
    finally { setBusy(false); }
  };
  const saveCode = async (account: ManagementAccountRecord) => {
    const next = edits[account.uid]?.code || '';
    if (!/^\d{6}$/.test(next)) { setError('الكود السري يجب أن يتكون من 6 أرقام.'); return; }
    setBusy(true); setError(''); setNotice('');
    try { await setManagementCode(account.uid, next); setEdits(current => ({ ...current, [account.uid]: { ...current[account.uid], code: '' } })); setNotice('تم تغيير الكود السري.'); }
    catch (err) { setError(err instanceof Error ? err.message : 'تعذر تغيير الكود.'); }
    finally { setBusy(false); }
  };
  const toggle = async (account: ManagementAccountRecord) => {
    setBusy(true); setError(''); setNotice('');
    try {
      if (account.status === 'active') await freezeManagementAccount(account.uid);
      else await updateManagementAccount(account.uid, { status: 'active' });
      setNotice(account.status === 'active' ? 'تم تجميد الحساب مع الاحتفاظ بسجله.' : 'تمت إعادة تفعيل الحساب.');
      await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : 'تعذر تغيير حالة الحساب.'); }
    finally { setBusy(false); }
  };
  return <section dir="rtl" className="space-y-4 rounded-2xl border border-[#D4AF37]/25 bg-[#111] p-4">
    <div><h3 className="font-bold text-[#F5D77F]">إدارة حسابات المديرين والمسؤولين</h3><p className="mt-1 text-xs leading-6 text-gray-400">المشرف العام وحده ينشئ هذه الحسابات ويعيّن أكوادها. التجميد يحفظ السجل ولا يحذف الحساب نهائياً. للمسؤول حسابان فقط: نهاري وليلي.</p></div>
    {error && <p role="alert" className="rounded-lg bg-red-950/40 p-3 text-sm text-red-200">{error}</p>}
    {notice && <p className="rounded-lg bg-emerald-950/30 p-3 text-sm text-emerald-200">{notice}</p>}
    <form onSubmit={create} className="grid grid-cols-1 gap-2 rounded-xl border border-white/10 bg-[#080808] p-3 sm:grid-cols-2">
      <label className="block text-xs text-gray-300">اسم المدير أو المسؤول<input className="field mt-1 w-full" placeholder="اكتب الاسم" value={name} onChange={e => setName(e.target.value)} disabled={busy} /></label>
      <label className="block text-xs text-gray-300">نوع الحساب<select className="field mt-1 w-full" value={role} onChange={e => setRole(e.target.value as 'admin' | 'responsible')} disabled={busy}><option value="admin">مدير عام</option><option value="responsible">مسؤول</option></select></label>
      {role === 'responsible' && <label className="block text-xs text-gray-300">الوردية<select className="field mt-1 w-full" value={shift} onChange={e => setShift(e.target.value as 'day' | 'night')} disabled={busy}><option value="day">مسؤول الوردية النهارية</option><option value="night">مسؤول الوردية الليلية</option></select></label>}
      <label className="block text-xs text-[#F5D77F]">رمز الدخول السري PIN (6 أرقام)<input className="field mt-1 w-full text-center tracking-[0.3em]" inputMode="numeric" type="password" autoComplete="new-password" maxLength={6} placeholder="عيّن رمز الدخول للحساب" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} disabled={busy} /><span className="mt-1 block text-[11px] text-gray-500">يستعمل المدير أو المسؤول هذا الرمز للدخول باسمه.</span></label>
      <button className="gold-button sm:col-span-2" disabled={busy}>{busy ? 'جارٍ الحفظ...' : 'إنشاء الحساب وحفظ رمز الدخول'}</button>
    </form>
    <div className="space-y-3">
      {accounts.map(account => <article key={account.uid} className="space-y-2 rounded-xl border border-white/10 bg-[#080808] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><b>{account.role === 'admin' ? 'مدير عام' : 'مسؤول'} {account.shift ? (account.shift === 'day' ? '· نهار' : '· ليل') : ''}</b><span className={account.status === 'active' ? 'text-xs text-emerald-300' : 'text-xs text-gray-400'}>{account.status === 'active' ? 'نشط' : 'مجمّد'}</span></div>
        <input className="field w-full" value={edits[account.uid]?.name ?? account.displayName} onChange={e => setEdits(current => ({ ...current, [account.uid]: { name: e.target.value, code: current[account.uid]?.code || '' } }))} aria-label="اسم الحساب" />
        <div className="flex flex-wrap gap-2"><button className="secondary-button flex-1" disabled={busy} onClick={() => void saveName(account)}>حفظ الاسم</button><button className={account.status === 'active' ? 'danger-button flex-1' : 'secondary-button flex-1'} disabled={busy} onClick={() => void toggle(account)}>{account.status === 'active' ? 'تجميد الحساب' : 'إعادة التفعيل'}</button></div>
        <div className="flex gap-2"><input className="field min-w-0 flex-1 text-center tracking-[0.3em]" type="password" inputMode="numeric" maxLength={6} placeholder="كود جديد" value={edits[account.uid]?.code || ''} onChange={e => setEdits(current => ({ ...current, [account.uid]: { name: current[account.uid]?.name || account.displayName, code: e.target.value.replace(/\D/g, '').slice(0, 6) } }))} /><button className="secondary-button" disabled={busy} onClick={() => void saveCode(account)}>تغيير الكود</button></div>
      </article>)}
      {!accounts.length && <p className="py-5 text-center text-sm text-gray-500">لا توجد حسابات إضافية بعد.</p>}
    </div>
  </section>;
};
