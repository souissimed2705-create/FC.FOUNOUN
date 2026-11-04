import React, { useCallback, useEffect, useState } from 'react';
import { signOut } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { listMyTasks, recordMyProgress } from '../lib/operationsApi';
import type { TaskRecord } from '../types/operations';

interface Props { worker: { id: string; name: string }; }
export const WorkerDashboard: React.FC<Props> = ({ worker }) => {
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const refresh = useCallback(async () => {
    try { const response = await listMyTasks(); setTasks(response.data || []); }
    catch (err) { setError(err instanceof Error ? err.message : 'تعذر تحميل المهام.'); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const submitProgress = async (task: TaskRecord) => {
    const quantity = Number(quantities[task.id]);
    if (!Number.isSafeInteger(quantity) || quantity < 1) { setError('أدخل كمية صحيحة أكبر من صفر.'); return; }
    if (quantity > task.targetQuantity - task.completedQuantity) { setError('الكمية أكبر من المتبقي في المهمة.'); return; }
    setBusy(true); setError(''); setMessage('');
    try {
      await recordMyProgress(task.id, { quantity, clientMutationId: crypto.randomUUID() });
      setQuantities(v => ({ ...v, [task.id]: '' }));
      setMessage('تم تسجيل الكمية المنجزة.');
      await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : 'تعذر تسجيل الإنجاز.'); }
    finally { setBusy(false); }
  };
  return <section dir="rtl" className="w-full max-w-3xl rounded-2xl border border-[#D4AF37]/30 bg-[#111] p-5 space-y-4">
    <header className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-bold text-[#F5D77F]">مساحة العامل</h2><p className="text-sm text-gray-300">{worker.name}</p></div><button className="danger-button" onClick={() => void signOut(auth)}>خروج</button></header>
    {error && <p role="alert" className="rounded-lg bg-red-950/40 p-3 text-sm text-red-200">{error}</p>}
    {message && <p className="rounded-lg bg-emerald-950/30 p-3 text-sm text-emerald-200">{message}</p>}
    <button className="secondary-button" onClick={() => void refresh()}>تحديث المهام</button>
    {!tasks.length && <p className="py-6 text-center text-sm text-gray-400">لا توجد مهام مسندة إليك حالياً.</p>}
    <div className="space-y-3">{tasks.map(task => <article key={task.id} className="rounded-xl border border-white/10 bg-[#080808] p-4 space-y-2">
      <div className="flex items-center justify-between gap-2"><h3 className="font-bold">{task.title}</h3><span className="text-xs text-[#F5D77F]">{task.status}</span></div>
      <p className="text-sm text-gray-400">المنجز: {task.completedQuantity} من {task.targetQuantity}</p>
      <div className="h-2 rounded-full bg-white/10"><div className="h-2 rounded-full bg-[#D4AF37]" style={{ width: `${Math.min(100, task.completedQuantity / Math.max(1, task.targetQuantity) * 100)}%` }} /></div>
      {task.status !== 'completed' && task.status !== 'cancelled' && <div className="flex gap-2"><input className="field min-w-0 flex-1" type="number" min="1" max={task.targetQuantity-task.completedQuantity} placeholder="الكمية المنجزة" value={quantities[task.id] || ''} onChange={e => setQuantities(v => ({ ...v, [task.id]: e.target.value }))} /><button disabled={busy} className="gold-button" onClick={() => void submitProgress(task)}>تسجيل</button></div>}
    </article>)}</div>
  </section>;
};
