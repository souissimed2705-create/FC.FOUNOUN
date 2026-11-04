import React, { useCallback, useEffect, useState } from 'react';
import { signOut } from 'firebase/auth';
import { ArrowRight, ClipboardList, LogOut, MessageCircle, Send, RefreshCw } from 'lucide-react';
import { auth } from '../lib/firebase';
import { listMyConversation, listMyTasks, recordMyProgress, sendWorkerMessage, updateMyTaskStatus } from '../lib/operationsApi';
import type { ChatMessage, TaskRecord } from '../types/operations';

interface Props { worker: { id: string; name: string }; }
type Page = 'home' | 'tasks' | 'messages';

export const WorkerDashboard: React.FC<Props> = ({ worker }) => {
  const [page, setPage] = useState<Page>('home');
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
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (page !== 'messages') return;
    void refreshMessages();
    const timer = window.setInterval(() => void refreshMessages(), 7000);
    return () => window.clearInterval(timer);
  }, [page, refreshMessages]);

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

  return <section dir="rtl" className="w-full max-w-3xl space-y-4">
    <header className="flex items-center justify-between gap-3 rounded-2xl border border-[#D4AF37]/35 bg-gradient-to-l from-[#211B0B] to-[#111] p-4">
      <div><h2 className="text-lg font-bold text-[#F5D77F]">{page === 'home' ? 'الرئيسية' : page === 'tasks' ? 'مهامي' : 'المحادثة'}</h2><p className="text-sm text-gray-300">{worker.name}</p></div>
      <div className="flex items-center gap-2">{page !== 'home' && <button onClick={() => { setPage('home'); setError(''); setNotice(''); }} className="secondary-button"><ArrowRight className="w-4 h-4" /> الرئيسية</button>}<button className="danger-button" onClick={() => void signOut(auth)}><LogOut className="w-4 h-4" /> خروج</button></div>
    </header>

    {page === 'home' && <>
      <div className="rounded-xl border border-[#D4AF37]/20 bg-[#111] px-4 py-3"><p className="text-sm leading-7 text-[#F5D77F]">أهلاً بك يا {worker.name}. نفّذ مهامك وسجّل إنجازك وتواصل مع المسؤول عند الحاجة.</p></div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button onClick={() => { setPage('tasks'); setError(''); setNotice(''); void refresh(); }} className="flex min-h-28 items-center gap-4 rounded-2xl border border-[#D4AF37]/35 bg-[#111] p-5 text-right hover:border-[#D4AF37]"><span className="flex h-14 w-14 items-center justify-center rounded-xl bg-[#D4AF37]/10 text-[#F5D77F]"><ClipboardList className="h-7 w-7" /></span><span><b className="block text-base">مهامي وتنفيذ الإنتاج</b><small className="mt-1 block text-xs leading-5 text-gray-400">عرض الكميات المطلوبة وتسجيل المنجز وتعليق المهمة أو استئنافها.</small></span></button>
        <button onClick={() => { setPage('messages'); setError(''); setNotice(''); }} className="flex min-h-28 items-center gap-4 rounded-2xl border border-[#D4AF37]/35 bg-[#111] p-5 text-right hover:border-[#D4AF37]"><span className="flex h-14 w-14 items-center justify-center rounded-xl bg-[#D4AF37]/10 text-[#F5D77F]"><MessageCircle className="h-7 w-7" /></span><span><b className="block text-base">المحادثة مع المسؤول</b><small className="mt-1 block text-xs leading-5 text-gray-400">إرسال واستقبال الرسائل المتعلقة بالعمل.</small></span></button>
      </div>
    </>}

    {error && <p role="alert" className="rounded-lg bg-red-950/40 p-3 text-sm text-red-200">{error}</p>}
    {notice && <p className="rounded-lg bg-emerald-950/30 p-3 text-sm text-emerald-200">{notice}</p>}

    {page === 'tasks' && <div className="rounded-2xl border border-white/10 bg-[#111] p-4 space-y-4">
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
    </div>}

    {page === 'messages' && <div className="rounded-2xl border border-white/10 bg-[#111] p-4 space-y-3">
      <div className="flex items-center gap-2"><MessageCircle className="w-5 h-5 text-[#D4AF37]" /><h3 className="font-bold text-[#F5D77F]">المحادثة مع المسؤول</h3></div>
      <div className="max-h-72 min-h-36 overflow-y-auto rounded-xl border border-white/10 bg-[#080808] p-3 space-y-2">
        {!messages.length && <p className="py-8 text-center text-sm text-gray-500">لا توجد رسائل بعد.</p>}
        {messages.map(msg => <div key={msg.id} className={'max-w-[88%] rounded-xl p-3 ' + (msg.senderRole === 'worker' ? 'ml-auto bg-white/10' : 'mr-auto bg-[#3A2E12]')}><div className="mb-1 text-[11px] text-[#F5D77F]">{msg.senderName} · {new Date(msg.createdAt).toLocaleString('ar-TN')}</div><p className="break-words whitespace-pre-wrap text-sm">{msg.text}</p></div>)}
      </div>
      <form onSubmit={sendMessage} className="flex gap-2"><input className="field min-w-0 flex-1" placeholder="اكتب رسالة للمسؤول..." value={draft} onChange={e => setDraft(e.target.value)} disabled={busy} /><button className="gold-button" disabled={busy || !draft.trim()}><Send className="h-4 w-4" /> إرسال</button></form>
    </div>}
  </section>;
};
