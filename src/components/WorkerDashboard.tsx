import React, { useCallback, useEffect, useState } from 'react';
import { signOut } from 'firebase/auth';
import { Home, ClipboardList, LogOut, MessageCircle, RefreshCw, Gauge, Package } from 'lucide-react';
import { auth } from '../lib/firebase';
import { listMyTasks, recordMyProgress, updateMyTaskStatus, listMyMachineCycles, submitMachineCycle, queueMutation, flushQueuedMutations, queuedMutationCount } from '../lib/operationsApi';
import { PrivateMessagesPanel } from './PrivateMessagesPanel';
import { ModelsPanel } from './ModelsPanel';
import { optimizeAndEncodeImage } from '../utils/imageOptimizer';
import { readOfflineSnapshot, saveOfflineSnapshot } from '../utils/offlineCache';
import type { TaskRecord, MachineCycleRecord } from '../types/operations';

interface Props { worker: { id: string; name: string }; }
type Page = 'home' | 'models' | 'tasks' | 'messages' | 'cycles';

export const WorkerDashboard: React.FC<Props> = ({ worker }) => {
  const [page, setPage] = useState<Page>('home');
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [cycles, setCycles] = useState<MachineCycleRecord[]>([]);
  const [cycleCount, setCycleCount] = useState('');
  const [cyclePhoto, setCyclePhoto] = useState('');
  const [cyclePhotoName, setCyclePhotoName] = useState('');
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pendingSync, setPendingSync] = useState(queuedMutationCount());
  const refresh = useCallback(async () => {
    try {
      const response = await listMyTasks();
      const data = response.data || [];
      setTasks(data);
      void saveOfflineSnapshot(`worker-tasks:${worker.id}`, data).catch(() => undefined);
    } catch (err) {
      const cached = await readOfflineSnapshot<TaskRecord[]>(`worker-tasks:${worker.id}`).catch(() => null);
      if (cached) { setTasks(cached); setNotice('أنت دون اتصال؛ تعرض آخر نسخة محفوظة من مهامك.'); }
      else setError(err instanceof Error ? err.message : 'تعذر تحميل المهام ولا توجد نسخة محفوظة.');
    }
  }, [worker.id]);
  const refreshCycles = useCallback(async () => {
    try {
      const response = await listMyMachineCycles();
      const data = response.data || [];
      setCycles(data);
      void saveOfflineSnapshot(`worker-cycles:${worker.id}`, data).catch(() => undefined);
    } catch (err) {
      const cached = await readOfflineSnapshot<MachineCycleRecord[]>(`worker-cycles:${worker.id}`).catch(() => null);
      if (cached) { setCycles(cached); setNotice('أنت دون اتصال؛ تعرض آخر نسخة محفوظة من تقارير الدورات.'); }
      else setError(err instanceof Error ? err.message : 'تعذر تحميل تقارير الدورات ولا توجد نسخة محفوظة.');
    }
  }, [worker.id]);
  useEffect(() => { void refresh(); void refreshCycles(); }, [refresh, refreshCycles]);
  useEffect(() => {
    let active = true;
    const syncPendingOperations = async () => {
      if (!navigator.onLine) return;
      const flushed = await flushQueuedMutations();
      if (!active) return;
      setPendingSync(queuedMutationCount());
      if (flushed > 0) {
        setNotice(`تمت مزامنة ${flushed} عملية محفوظة دون اتصال.`);
        await refresh();
        await refreshCycles();
      }
    };
    // Retry after a reload too; do not wait for another online event.
    void syncPendingOperations();
    window.addEventListener('online', syncPendingOperations);
    return () => {
      active = false;
      window.removeEventListener('online', syncPendingOperations);
    };
  }, [refresh, refreshCycles]);


  const saveCycle = async (event: React.FormEvent) => {
    event.preventDefault();
    const count = Number(cycleCount);
    if (!Number.isSafeInteger(count) || count < 0) { setError('أدخل عدداً صحيحاً غير سالب للدورات.'); return; }
    if (!cyclePhoto) { setError('صورة عداد المكينة إلزامية.'); return; }
    setBusy(true); setError(''); setNotice('');
    try { if (!navigator.onLine) { queueMutation('/api/worker/cycles', { method: 'POST', body: JSON.stringify({ count, photo: cyclePhoto }) }); setPendingSync(queuedMutationCount()); setNotice('لا يوجد اتصال؛ حُفظ تقرير الدورات وصورة العداد على الهاتف وسيتزامن عند عودة الاتصال.'); } else { await submitMachineCycle(count, cyclePhoto); setNotice('تم حفظ تقرير الدورات وصورة العداد مع التاريخ والوقت تلقائياً.'); await refreshCycles(); } setCycleCount(''); setCyclePhoto(''); setCyclePhotoName(''); }
    catch (err) { setError(err instanceof Error ? err.message : 'تعذر حفظ تقرير الدورات.'); }
    finally { setBusy(false); }
  };
  const submitProgress = async (task: TaskRecord) => {
    const quantity = Number(quantities[task.id]);
    if (!Number.isSafeInteger(quantity) || quantity < 1) { setError('أدخل كمية صحيحة أكبر من صفر.'); return; }
    if (quantity > task.targetQuantity - task.completedQuantity) { setError('الكمية أكبر من المتبقي في المهمة.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const body = { quantity, clientMutationId: crypto.randomUUID() };
      if (!navigator.onLine) {
        queueMutation(`/api/worker/tasks/${encodeURIComponent(task.id)}/progress`, { method: 'POST', body: JSON.stringify(body) });
        setPendingSync(queuedMutationCount()); setNotice('لا يوجد اتصال؛ حُفظت كمية الإنجاز وستتم مزامنتها عند عودة الاتصال.');
      } else await recordMyProgress(task.id, body);
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
      if (!navigator.onLine) {
        queueMutation(`/api/worker/tasks/${encodeURIComponent(task.id)}/status`, { method: 'PUT', body: JSON.stringify({ status: nextStatus }) });
        setPendingSync(queuedMutationCount());
      } else await updateMyTaskStatus(task.id, nextStatus);
      setNotice(nextStatus === 'pending' ? 'تم تعليق المهمة.' : 'تم استئناف المهمة.');
      await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : 'تعذر تغيير حالة المهمة.'); }
    finally { setBusy(false); }
  };
  const statusLabel = (status: TaskRecord['status']) => ({
    open: 'جديدة', in_progress: 'قيد التنفيذ', pending: 'معلّقة', completed: 'مكتملة', cancelled: 'ملغاة'
  }[status]);


  return <section dir="rtl" className="w-full max-w-3xl space-y-4">
    <header className="flex items-center justify-between gap-3 rounded-2xl border border-[#D4AF37]/35 bg-gradient-to-l from-[#211B0B] to-[#111] p-4">
      <div><h2 className="text-lg font-bold text-[#F5D77F]">{page === 'home' ? 'الرئيسية' : page === 'models' ? 'الموديلات والبحث' : page === 'tasks' ? 'مهامي' : page === 'cycles' ? 'عدد دورات المكينة' : 'المراسلات الخاصة'}</h2><p className="text-sm text-gray-300">{worker.name}</p></div>
      <div className="flex items-center gap-2">{page !== 'home' && <button type="button" onClick={() => { setPage('home'); setError(''); setNotice(''); }} aria-label="العودة إلى واجهة الاستقبال" title="العودة إلى واجهة الاستقبال" className="flex h-10 w-10 items-center justify-center rounded-full border border-[#D4AF37]/50 bg-[#D4AF37]/10 text-[#F5D77F] transition hover:bg-[#D4AF37]/20 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]"><Home className="h-5 w-5" /></button>}<button className="danger-button" onClick={() => void signOut(auth)}><LogOut className="w-4 h-4" /> خروج</button></div>
    </header>

    {page === 'home' && <>
      <div className="rounded-xl border border-[#D4AF37]/20 bg-[#111] px-4 py-3"><p className="text-sm leading-7 text-[#F5D77F]">أهلاً بك يا {worker.name}. نفّذ مهامك وسجّل إنجازك وتواصل مع المسؤول عند الحاجة.</p></div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button onClick={() => { setPage('models'); setError(''); setNotice(''); }} className="flex min-h-28 items-center gap-4 rounded-2xl border border-[#D4AF37]/35 bg-[#111] p-5 text-right hover:border-[#D4AF37]"><span className="flex h-14 w-14 items-center justify-center rounded-xl bg-[#D4AF37]/10 text-[#F5D77F]"><Package className="h-7 w-7" /></span><span><b className="block text-base">الموديلات والبحث</b><small className="mt-1 block text-xs leading-5 text-gray-400">ابحث عن الموديلات واعرض القياسات والصور المكبرة.</small></span></button>
        <button onClick={() => { setPage('tasks'); setError(''); setNotice(''); void refresh(); }} className="flex min-h-28 items-center gap-4 rounded-2xl border border-[#D4AF37]/35 bg-[#111] p-5 text-right hover:border-[#D4AF37]"><span className="flex h-14 w-14 items-center justify-center rounded-xl bg-[#D4AF37]/10 text-[#F5D77F]"><ClipboardList className="h-7 w-7" /></span><span><b className="block text-base">مهامي وتنفيذ الإنتاج</b><small className="mt-1 block text-xs leading-5 text-gray-400">عرض الكميات المطلوبة وتسجيل المنجز وتعليق المهمة أو استئنافها.</small></span></button>
        <button onClick={() => { setPage('cycles'); setError(''); setNotice(''); void refreshCycles(); }} className="flex min-h-28 items-center gap-4 rounded-2xl border border-[#D4AF37]/35 bg-[#111] p-5 text-right hover:border-[#D4AF37]"><span className="flex h-14 w-14 items-center justify-center rounded-xl bg-[#D4AF37]/10 text-[#F5D77F]"><Gauge className="h-7 w-7" /></span><span><b className="block text-base">عدد دورات المكينة</b><small className="mt-1 block text-xs leading-5 text-gray-400">سجّل عدد دورات ورديتك وأرفق صورة العداد.</small></span></button>
        <button onClick={() => { setPage('messages'); setError(''); setNotice(''); }} className="flex min-h-28 items-center gap-4 rounded-2xl border border-[#D4AF37]/35 bg-[#111] p-5 text-right hover:border-[#D4AF37]"><span className="flex h-14 w-14 items-center justify-center rounded-xl bg-[#D4AF37]/10 text-[#F5D77F]"><MessageCircle className="h-7 w-7" /></span><span><b className="block text-base">المراسلات الخاصة</b><small className="mt-1 block text-xs leading-5 text-gray-400">محادثات خاصة مع أي مستخدم نشط في النظام.</small></span></button>
      </div>
    </>}

    {pendingSync > 0 && <p className="rounded-lg border border-amber-500/40 bg-amber-950/30 p-3 text-xs text-amber-200">عمليات محفوظة بانتظار المزامنة: {pendingSync}</p>}
    {error && <p role="alert" className="rounded-lg bg-red-950/40 p-3 text-sm text-red-200">{error}</p>}
    {notice && <p className="rounded-lg bg-emerald-950/30 p-3 text-sm text-emerald-200">{notice}</p>}

    {page === 'models' && <ModelsPanel readOnly />}

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

    {page === 'cycles' && <div className="rounded-2xl border border-white/10 bg-[#111] p-4 space-y-4">
      <div><h3 className="font-bold text-[#F5D77F]">تسجيل عدد دورات المكينة</h3><p className="mt-1 text-xs leading-6 text-gray-400">يُسجّل التقرير للمكينة والوردية المرتبطتين بحسابك. لا يتم جمع دورات النهار والليل. التاريخ والوقت يحددهما الخادم تلقائياً بتوقيت تونس.</p></div>
      <form onSubmit={saveCycle} className="space-y-3">
        <input className="field w-full" type="number" min="0" step="1" inputMode="numeric" placeholder="عدد الدورات" value={cycleCount} onChange={e => setCycleCount(e.target.value)} />
        <label className="block rounded-xl border border-dashed border-[#D4AF37]/50 bg-[#080808] p-4 text-center text-sm text-gray-300">صورة عداد المكينة<input className="mt-3 block w-full text-xs" type="file" accept="image/*" capture="environment" disabled={busy} onChange={async e => { const file = e.target.files?.[0]; if (!file) return; try { const image = await optimizeAndEncodeImage(file, { maxWidth: 1024, maxHeight: 1024, quality: 0.72, maxChars: 400000 }); setCyclePhoto(image.dataUrl); setCyclePhotoName(file.name); setError(''); } catch (err) { setCyclePhoto(''); setError(err instanceof Error ? err.message : 'تعذر ضغط الصورة.'); } }} /></label>
        {cyclePhoto && <div className="space-y-1"><img src={cyclePhoto} alt="صورة عداد المكينة" className="mx-auto max-h-56 rounded-lg border border-white/10" /><p className="text-center text-xs text-gray-400">{cyclePhotoName} · صورة مضغوطة قبل الحفظ</p></div>}
        <button className="gold-button w-full" disabled={busy || !cycleCount || !cyclePhoto}>{busy ? 'جارٍ الحفظ...' : 'حفظ تقرير الدورات'}</button>
      </form>
      <div className="space-y-2"><div className="flex items-center justify-between"><h4 className="font-semibold">سجل تقاريري السابقة</h4><button className="secondary-button" onClick={() => void refreshCycles()}>تحديث</button></div>
        {!cycles.length && <p className="py-4 text-center text-xs text-gray-500">لا توجد تقارير مسجلة بعد.</p>}
        {cycles.map(report => <article key={report.id} className="rounded-xl border border-white/10 bg-[#080808] p-3"><div className="flex justify-between gap-2"><b>المكينة {report.machineNumber} · {report.shift === 'day' ? 'النهار' : 'الليل'}</b><strong className="text-[#F5D77F]">{report.count.toLocaleString('ar-TN')} دورة</strong></div><p className="mt-1 text-xs text-gray-400">{report.date} · {new Date(report.recordedAt).toLocaleTimeString('ar-TN', { timeZone: 'Africa/Tunis' })}</p></article>)}
      </div>
    </div>}

    {page === 'messages' && <PrivateMessagesPanel />}
  </section>;
};
