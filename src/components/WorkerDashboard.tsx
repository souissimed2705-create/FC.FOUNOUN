import React, { useCallback, useEffect, useState } from 'react';
import { signOut } from 'firebase/auth';
import { MessageCircle, Send, RefreshCw } from 'lucide-react';
import { auth } from '../lib/firebase';
import { listMyConversation, listMyTasks, recordMyProgress, sendWorkerMessage, updateMyTaskStatus } from '../lib/operationsApi';
import type { ChatMessage, TaskRecord } from '../types/operations';

interface Props { worker: { id: string; name: string }; }
export const WorkerDashboard: React.FC<Props> = ({ worker }) => {
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const refresh = useCallback(async () => {
    try { const response = await listMyTasks(); setTasks(response.data || []); }
    catch (err) { setError(err instanceof Error ? err.message : 'تعذر تحميل المهام.'); }
  }, []);
  const refreshMessages = useCallback(async () => {
    try { const response = await listMyConversation(); setMessages(response.data || []); }
    catch (err) { setError(err instanceof Error ? err.message : 'تعذر تحميل المحادثة.'); }
  }, []);
  useEffect(() => { void refresh(); void refreshMessages(); const timer = window.setInterval(() => void refreshMessages(), 7000); return () => window.clearInterval(timer); }, [refresh, refreshMessages]);
  const submitProgress = async (task: TaskRecord) => {
    const quantity = Number(quantities[task.id]);
    if (!Number.isSafeInteger(quantity) || quantity < 1) { setError('أدخل كمية صحيحة أكبر من صفر.'); return; }
    if (quantity > task.targetQuantity - task.completedQuantity) { setError('الكمية أكبر من المتبقي في المهمة.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      await recordMyProgress(task.id, { quantity, clientMutationId: crypto.randomUUID() });
      setQuantities(v => ({ ...v, [task.id]: '' }));
      setNotice('تم تسجيل الكمية المنجزة.');
      await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : 'تعذر تسجيل الإنجاز.'); }
    finally { setBusy(false); }
  };
  const toggleTaskStatus = async (task: TaskRecord) => {
    const nextStatus = task.status === 'pending' ? 'in_progress' : 'pending';
    setBusy(true); setError(''); setNotice('');
    try {
      await updateMyTaskStatus(task.id, nextStatus);
      setNotice(nextStatus === 'pending' ? 'تم تعليق المهمة.' : 'تم استئناف المهمة.');
      await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : 'تعذر تغيير حالة المهمة.'); }
    finally { setBusy(false); }
  };
  const statusLabel = (status: TaskRecord['status']) => ({
    open: 'جديدة', in_progress: 'قيد التنفيذ', pending: 'معلّقة', completed: 'مكتملة', cancelled: 'ملغاة'
  }[status]);
  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    setBusy(true); setError(''); setNotice('');
    try { await sendWorkerMessage(draft.trim()); setDraft(''); await refreshMessages(); }
    catch (err) { setError(err instanceof Error ? err.message : 'تعذر إرسال الرسالة.'); }
    finally { setBusy(false); }
  };
  return <section dir="rtl" className="w-full max-w-3xl rounded-2xl border border-[#D4AF37]/30 bg-[#111] p-5 space-y-4">
    <header className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-bold text-[#F5D77F]">مساحة العامل</h2><p className="text-sm text-gray-300">{worker.name}</p></div><button className="danger-button" onClick={() => void signOut(auth)}>خروج</button></header>
    {error && <p role="alert" className="rounded-lg bg-red-950/40 p-3 text-sm text-red-200">{error}</p>}
    {notice && <p className="rounded-lg bg-emerald-950/30 p-3 text-sm text-emerald-200">{notice}</p>}
    <div className="flex items-center justify-between"><h3 className="font-bold text-[#F5D77F]">أوامر الإنتاج المسندة إليك</h3><button className="secondary-button" onClick={() => void refresh()}><RefreshCw className="w-4 h-4" /> تحديث</button></div>
    {!tasks.length && <p className="py-6 text-center text-sm text-gray-400">لا توجد أوامر إنتاج مسندة إليك حالياً.</p>}
    <div className="space-y-3">{tasks.map(task => <article key={task.id} className="rounded-xl border border-white/10 bg-[#080808] p-4 space-y-2">
      <div className="flex items-center justify-between gap-2"><div><h3 className="font-bold">{task.modelName || task.title}</h3>{task.modelCategory && <p className="text-xs text-[#D4AF37]">{task.modelCategory}</p>}</div><span className="text-xs text-[#F5D77F]">{statusLabel(task.status)}</span></div>
      {task.description && <p className="text-sm text-gray-400">{task.description}</p>}
      <p className="text-sm text-gray-400">المطلوب: {task.targetQuantity} · المنجز: {task.completedQuantity} · المتبقي: {Math.max(0, task.targetQuantity - task.completedQuantity)}</p>
      <div className="h-2 rounded-full bg-white/10"><div className="h-2 rounded-full bg-[#D4AF37]" style={{ width: Math.min(100, task.completedQuantity / Math.max(1, task.targetQuantity) * 100) + '%' }} /></div>
      {task.status !== 'completed' && task.status !== 'cancelled' && <>
        <div className="flex gap-2"><input className="field min-w-0 flex-1" type="number" min="1" max={task.targetQuantity-task.completedQuantity} placeholder="الكمية المنجزة" value={quantities[task.id] || ''} onChange={e => setQuantities(v => ({ ...v, [task.id]: e.target.value }))} /><button disabled={busy || task.status === 'pending'} className="gold-button" onClick={() => void submitProgress(task)}>تسجيل</button></div>
        <button disabled={busy} className="secondary-button w-full" onClick={() => void toggleTaskStatus(task)}>{task.status === 'pending' ? 'استئناف المهمة' : 'تعليق المهمة'}</button>
      </>}
    </article>)}</div>
    <div className="border-t border-white/10 pt-4 space-y-3">
      <div className="flex items-center gap-2"><MessageCircle className="w-5 h-5 text-[#D4AF37]" /><h3 className="font-bold text-[#F5D77F]">المحادثة مع المسؤول</h3></div>
      <div className="max-h-72 min-h-36 overflow-y-auto rounded-xl border border-white/10 bg-[#080808] p-3 space-y-2">
        {!messages.length && <p className="text-center text-sm text-gray-500 py-8">لا توجد رسائل بعد.</p>}
        {messages.map(msg => <div key={msg.id} className={'max-w-[88%] rounded-xl p-3 ' + (msg.senderRole === 'worker' ? 'ml-auto bg-white/10' : 'mr-auto bg-[#3A2E12]')}>
          <div className="text-[11px] text-[#F5D77F] mb-1">{msg.senderName} · {new Date(msg.createdAt).toLocaleString('ar-TN')}</div>
          <p className="text-sm whitespace-pre-wrap break-words">{msg.text}</p>
        </div>)}
      </div>
      <form onSubmit={sendMessage} className="flex gap-2">
        <input className="field min-w-0 flex-1" placeholder="اكتب رسالة للمسؤول..." value={draft} onChange={e => setDraft(e.target.value)} disabled={busy} />
        <button className="gold-button" disabled={busy || !draft.trim()}><Send className="w-4 h-4" /> إرسال</button>
      </form>
      <button className="secondary-button" onClick={() => void refreshMessages()}>تحديث المحادثة</button>
    </div>
  </section>;
};
