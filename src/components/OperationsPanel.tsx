import React, { useEffect, useState } from 'react';
import { MessageCircle, Gauge } from 'lucide-react';
import { createTask, createWorker, flushQueuedMutations, listTasks, listWorkers, queuedMutationCount, recordProgress, setWorkerPin, updateTask, updateWorker, listMachineCycles, getMachineCyclePhoto } from '../lib/operationsApi';
import { PrivateMessagesPanel } from './PrivateMessagesPanel';
import { CycleReportPhoto } from './CycleReportPhoto';
import { listShoeModels } from '../lib/modelsApi';
import { readOfflineSnapshot, saveOfflineSnapshot } from '../utils/offlineCache';
import type { ShoeModel } from '../types/models';
import type { TaskRecord, WorkerRecord, MachineCycleRecord } from '../types/operations';
import type { UserProfile } from '../lib/firebase';

type Section = 'workers' | 'tasks' | 'messages' | 'cycles';
interface Props { initialSection: 'workers' | 'tasks'; admin: UserProfile; focusTaskId?: string; }

export const OperationsPanel: React.FC<Props> = ({ initialSection, admin, focusTaskId }) => {
  const isSupervisor = admin.role === 'super_admin';
  const canFreezeWorkers = ['super_admin', 'admin', 'responsible'].includes(admin.role);
  const isResponsible = admin.role === 'responsible';
  const canManageWorkers = ['super_admin', 'admin', 'responsible'].includes(admin.role);
  const [section, setSection] = useState<Section>(initialSection);
  const [workers, setWorkers] = useState<WorkerRecord[]>([]);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [models, setModels] = useState<ShoeModel[]>([]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [newWorkerPin, setNewWorkerPin] = useState('');
  const [machineNumber, setMachineNumber] = useState<'1' | '2' | '3'>('1');
  const [shift, setShift] = useState<'day' | 'night'>('day');
  const [cycles, setCycles] = useState<MachineCycleRecord[]>([]);
  const [cycleNextPageToken, setCycleNextPageToken] = useState<string | null>(null);
  const [loadingMoreCycles, setLoadingMoreCycles] = useState(false);
  const [cycleMachineFilter, setCycleMachineFilter] = useState('');
  const [cycleShiftFilter, setCycleShiftFilter] = useState('');
  const [cycleDateFilter, setCycleDateFilter] = useState('');
  const [selectedCyclePhoto, setSelectedCyclePhoto] = useState<{ id: string; photo: string } | null>(null);
  const [workerEdits, setWorkerEdits] = useState<Record<string, { name: string; phone: string; machineNumber: string; shift: 'day' | 'night' }>>({});
  const [pinId, setPinId] = useState('');
  const [pin, setPin] = useState('');
  const [modelId, setModelId] = useState('');
  const [assignedWorkerId, setAssignedWorkerId] = useState('');
  const [targetQuantity, setTargetQuantity] = useState('');
  const [description, setDescription] = useState('');
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [progressId, setProgressId] = useState('');
  const [progressQuantity, setProgressQuantity] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (focusTaskId) setSection('tasks');
  }, [focusTaskId]);
  useEffect(() => {
    if (!focusTaskId || section !== 'tasks' || !tasks.length) return;
    document.getElementById(`admin-task-${focusTaskId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focusTaskId, section, tasks]);

  const loadMoreCycles = async () => {
    if (!cycleNextPageToken || loadingMoreCycles) return;
    setLoadingMoreCycles(true);
    setError(null);
    try {
      const page = await listMachineCycles(cycleNextPageToken);
      setCycles(current => {
        const known = new Set(current.map(report => report.id));
        return [...current, ...(page.data || []).filter(report => !known.has(report.id))];
      });
      setCycleNextPageToken(page.nextPageToken || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تحميل التقارير الأقدم.');
    } finally {
      setLoadingMoreCycles(false);
    }
  };

  const refresh = async () => {
    setError(null);
    const [workersResult, tasksResult, modelsResult, cyclesResult] = await Promise.allSettled([
      listWorkers(),
      listTasks(),
      // Keep the same page size used by the working Models screen.
      listShoeModels({ pageSize: 50 }),
      listMachineCycles()
    ]);

    const loadErrors: string[] = [];

    if (workersResult.status === 'fulfilled') {
      const workerData = workersResult.value.data || [];
      setWorkers(workerData);
      setWorkerEdits(current => Object.fromEntries(workerData.map(worker => [worker.id, current[worker.id] || { name: worker.name, phone: worker.phone || '', machineNumber: String(worker.machineNumber || ''), shift: worker.shift || 'day' }])));
      void saveOfflineSnapshot(`management-workers:${admin.uid}`, workerData).catch(() => undefined);
    } else {
      const cachedWorkers = await readOfflineSnapshot<WorkerRecord[]>(`management-workers:${admin.uid}`).catch(() => null);
      if (cachedWorkers) {
        setWorkers(cachedWorkers);
        setWorkerEdits(current => Object.fromEntries(cachedWorkers.map(worker => [worker.id, current[worker.id] || { name: worker.name, phone: worker.phone || '', machineNumber: String(worker.machineNumber || ''), shift: worker.shift || 'day' }])));
      } else {
        loadErrors.push(`قراءة قائمة العمال: ${workersResult.reason instanceof Error ? workersResult.reason.message : 'تعذر تحميل قائمة العمال.'}`);
      }
    }

    if (tasksResult.status === 'fulfilled') {
      const taskData = isResponsible ? [] : (tasksResult.value.data || []);
      setTasks(taskData);
      void saveOfflineSnapshot(`management-tasks:${admin.uid}`, taskData).catch(() => undefined);
    } else {
      const cachedTasks = await readOfflineSnapshot<TaskRecord[]>(`management-tasks:${admin.uid}`).catch(() => null);
      if (cachedTasks) setTasks(isResponsible ? [] : cachedTasks);
      else loadErrors.push(`قراءة أوامر الإنتاج: ${tasksResult.reason instanceof Error ? tasksResult.reason.message : 'تعذر تحميل أوامر الإنتاج.'}`);
    }

    if (modelsResult.status === 'fulfilled') {
      const modelData = modelsResult.value.models || [];
      setModels(modelData);
      setModelsError(null);
      void saveOfflineSnapshot(`management-models:${admin.uid}`, modelData).catch(() => undefined);
    } else {
      const cachedModels = await readOfflineSnapshot<ShoeModel[]>(`management-models:${admin.uid}`).catch(() => null);
      setModels(cachedModels || []);
      setModelsError(modelsResult.reason instanceof Error ? modelsResult.reason.message : 'تعذر تحميل قائمة الموديلات.');
    }

    if (cyclesResult.status === 'fulfilled') {
      const cycleData = cyclesResult.value.data || [];
      setCycleNextPageToken(cyclesResult.value.nextPageToken || null);
      setCycles(cycleData);
      void saveOfflineSnapshot(`management-cycles:${admin.uid}`, cycleData).catch(() => undefined);
    } else {
      const cachedCycles = await readOfflineSnapshot<MachineCycleRecord[]>(`management-cycles:${admin.uid}`).catch(() => null);
      if (cachedCycles) setCycles(cachedCycles);
      else loadErrors.push(`قراءة تقارير دورات المكائن: ${cyclesResult.reason instanceof Error ? cyclesResult.reason.message : 'تعذر تحميل تقارير دورات المكائن.'}`);
    }

    setError(loadErrors.length ? loadErrors.join(' · ') : null);
  };


  useEffect(() => {
    let active = true;
    const handler = async () => {
      await flushQueuedMutations();
      const count = await queuedMutationCount().catch(() => 0);
      if (!active) return;
      setPending(count);
      void refresh();
    };
    // Resume saved management operations after a reload as soon as the app is online.
    void handler();
    window.addEventListener('online', handler);
    return () => { active = false; window.removeEventListener('online', handler); };
  }, []);



  const runMutation = async (fn: () => Promise<unknown>, fallback?: { path: string; init: RequestInit }, onSuccess?: () => void): Promise<boolean> => {
    setError(null); setNotice(null);
    try {
      if (!navigator.onLine && fallback) {
        const { queueMutation } = await import('../lib/operationsApi');
        await queueMutation(fallback.path, fallback.init);
        setPending(await queuedMutationCount());
        setNotice('لا يوجد اتصال؛ حُفظت العملية وستتم مزامنتها عند عودة الاتصال.');
        onSuccess?.();
        return true;
      }
      await fn();
      setNotice('تم الحفظ بنجاح.');
      await refresh();
      onSuccess?.();
      return true;
    } catch (e) {
      if (fallback && (e instanceof TypeError || !navigator.onLine)) {
        try {
          const { queueMutation } = await import('../lib/operationsApi');
          await queueMutation(fallback.path, fallback.init);
          setPending(await queuedMutationCount());
          setNotice('انقطع الاتصال أثناء الحفظ؛ حُفظت العملية على الهاتف وستتم مزامنتها عند عودة الاتصال.');
          onSuccess?.();
          return true;
        } catch (queueError) {
          setError(queueError instanceof Error ? queueError.message : 'تعذر حفظ العملية محلياً.');
          return false;
        }
      }
      setError(e instanceof Error ? e.message : 'فشلت العملية.');
      return false;
    }
  };

  const addWorker = (e: React.FormEvent) => {
    e.preventDefault();
    // Capture the submitted value once; do not clear the controlled input until
    // the server confirms the create (or the offline queue confirms it saved).
    // Use the controlled React input value directly; FormData may be empty on mobile.
    const workerName = String(name || '').trim();
    if (!workerName) { setError('اسم العامل مطلوب.'); return; }
    if (isSupervisor && !/^\d{6}$/.test(newWorkerPin)) { setError('عيّن للعامل PIN من 6 أرقام قبل إنشاء الحساب.'); return; }
    if (isSupervisor && !navigator.onLine) { setError('إنشاء العامل مع تعيين PIN يتطلب اتصالاً بالإنترنت لحماية الرمز السري وعدم حفظه مكشوفاً على الهاتف.'); return; }
    const payload = { name: workerName, ...(!isResponsible ? { phone: phone.trim() } : {}), machineNumber: Number(machineNumber) as 1 | 2 | 3, shift, ...(isSupervisor ? { pin: newWorkerPin } : {}), clientMutationId: crypto.randomUUID() };
    const fallback = !isSupervisor ? { path: '/api/workers', init: { method: 'POST' as const, body: JSON.stringify(payload) } } : undefined;
    void runMutation(() => createWorker(payload), fallback, () => { setName(''); setPhone(''); setNewWorkerPin(''); });
  };

  const addTask = (e: React.FormEvent) => {
    e.preventDefault();
    const model = models.find(item => item.id === modelId);
    const qty = Number(targetQuantity);
    if (!model || !assignedWorkerId || !Number.isSafeInteger(qty) || qty < 1) {
      setError('اختر المودال والعامل وأدخل الكمية المطلوبة بصورة صحيحة.');
      return;
    }
    const selectedWorker = workers.find(worker => worker.id === assignedWorkerId);
    if (!selectedWorker?.machineNumber || !selectedWorker.shift) { setError('يجب ربط مشرف العمال بمكينة ووردية قبل إسناد أمر الإنتاج.'); return; }
    if (isResponsible && admin.shift && selectedWorker.shift !== admin.shift) { setError('يمكنك إسناد المهام إلى مشرفي العمال التابعين لورديتك فقط.'); return; }
    const payload = { title: 'إنتاج مودال ' + model.name, description: description.trim(), modelId: model.id, modelName: model.name, modelCategory: model.category, assignedWorkerId, targetQuantity: qty };
    if (editingTaskId) {
      const task = tasks.find(item => item.id === editingTaskId);
      if (task && qty < task.completedQuantity) { setError('لا يمكن جعل الكمية المطلوبة أقل من الكمية المنجزة بالفعل.'); return; }
      void runMutation(() => updateTask(editingTaskId, payload), { path: '/api/tasks/' + encodeURIComponent(editingTaskId), init: { method: 'PUT', body: JSON.stringify(payload) } });
    } else {
      const createPayload = { ...payload, clientMutationId: crypto.randomUUID() };
      void runMutation(() => createTask(createPayload), { path: '/api/tasks', init: { method: 'POST', body: JSON.stringify(createPayload) } });
    }
    setModelId(''); setTargetQuantity(''); setDescription(''); setEditingTaskId(null);
  };

  const addProgress = (e: React.FormEvent) => {
    e.preventDefault();
    const qty = Number(progressQuantity);
    if (!progressId || !Number.isSafeInteger(qty) || qty < 1) { setError('اختر مهمة وأدخل كمية صحيحة.'); return; }
    const body = { quantity: qty, clientMutationId: crypto.randomUUID() };
    void runMutation(() => recordProgress(progressId, body), { path: '/api/tasks/' + encodeURIComponent(progressId) + '/progress', init: { method: 'POST', body: JSON.stringify(body) } });
    setProgressQuantity('');
  };



  const taskStatusLabel = (status: TaskRecord['status']) => ({
    open: 'جديدة', in_progress: 'قيد التنفيذ', pending: 'معلّقة', completed: 'مكتملة', cancelled: 'ملغاة'
  }[status]);
  const tabs: { id: Section; label: string }[] = [
    ...(canManageWorkers ? [{ id: 'workers' as const, label: 'إدارة مشرفي العمال' }] : []),
    { id: 'tasks' as const, label: 'أوامر الإنتاج' },
    { id: 'cycles', label: 'عدد دورات المكائن' },
    { id: 'messages', label: 'المحادثة' },
  ];

  const filteredCycles = cycles.filter(report =>
    (!cycleMachineFilter || String(report.machineNumber) === cycleMachineFilter) &&
    (!cycleShiftFilter || report.shift === cycleShiftFilter) &&
    (!cycleDateFilter || report.date === cycleDateFilter)
  );

  return <section className="w-full rounded-2xl border border-white/10 bg-[#111] p-5 space-y-4" dir="rtl">
    <div className="flex flex-wrap gap-2 mb-2">
      {tabs.map(tab => <button key={tab.id} className={'tab-button ' + (section === tab.id ? 'tab-active' : '')} onClick={() => setSection(tab.id)}>{tab.id === 'messages' && <MessageCircle className="w-4 h-4" />}{tab.label}</button>)}
      <button className="secondary-button mr-auto" onClick={() => void refresh()}>تحديث</button>
    </div>
    {pending > 0 && <div className="rounded-lg border border-amber-500/40 bg-amber-950/30 p-3 text-xs text-amber-200">عمليات تنتظر المزامنة: {pending}</div>}
    {error && <div role="alert" className="rounded-lg border border-red-500/40 bg-red-950/40 p-3 text-sm text-red-200">{error}</div>}
    {notice && <div className="rounded-lg border border-emerald-500/40 bg-emerald-950/30 p-3 text-sm text-emerald-200">{notice}</div>}

    {section === 'workers' && canManageWorkers && <div className="space-y-4">
      <h3 className="font-bold text-[#F5D77F]">إدارة العمال ورموز الدخول</h3>
      <form onSubmit={addWorker} className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="block text-xs text-gray-300">اسم مشرف العمال<input name="workerName" autoComplete="off" className="field mt-1 w-full" placeholder="اكتب اسم مشرف العمال" value={name} onChange={e => { setName(e.target.value); if (e.target.value.trim()) setError(null); }} /></label>
        {!isResponsible && <label className="block text-xs text-gray-300">رقم الهاتف (اختياري)<input className="field mt-1 w-full" placeholder="رقم الهاتف" value={phone} onChange={e => setPhone(e.target.value)} /></label>}
        <label className="block text-xs text-gray-300">تعيين المكينة<select className="field mt-1 w-full" value={machineNumber} onChange={e => setMachineNumber(e.target.value as '1' | '2' | '3')}><option value="1">المكينة 1</option><option value="2">المكينة 2</option><option value="3">المكينة 3</option></select></label>
        <label className="block text-xs text-gray-300">تعيين الوردية<select className="field mt-1 w-full" value={shift} onChange={e => setShift(e.target.value as 'day' | 'night')}><option value="day">الوردية النهارية</option><option value="night">الوردية الليلية</option></select></label>
        {isSupervisor && <label className="block text-xs text-[#F5D77F] sm:col-span-2">رمز دخول العامل PIN (6 أرقام)<input className="field mt-1 w-full text-center tracking-[0.35em]" type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} placeholder="عيّن رمز الدخول السري" value={newWorkerPin} onChange={e => setNewWorkerPin(e.target.value.replace(/\D/g, '').slice(0, 6))} /><span className="mt-1 block text-[11px] text-gray-500">المشرف العام وحده يعيّن الرمز. لا يُحفظ الرمز كنص مكشوف.</span></label>}
        <button className="gold-button sm:col-span-2">إضافة مشرف عمال وحفظ بيانات الدخول</button>
      </form>
      <div className="space-y-2">{workers.map(w => <div key={w.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-[#0A0A0A] p-3">
        <input className="field w-full min-w-0 basis-full flex-none" aria-label="اسم العامل" value={workerEdits[w.id]?.name ?? w.name} onChange={e => setWorkerEdits(current => ({ ...current, [w.id]: { name: e.target.value, phone: current[w.id]?.phone ?? w.phone ?? '', machineNumber: current[w.id]?.machineNumber ?? String(w.machineNumber || ''), shift: current[w.id]?.shift ?? w.shift ?? 'day' } }))} />
        {!isResponsible && <input className="field w-32" aria-label="هاتف العامل" value={workerEdits[w.id]?.phone ?? w.phone ?? ''} onChange={e => setWorkerEdits(current => ({ ...current, [w.id]: { name: current[w.id]?.name ?? w.name, phone: e.target.value, machineNumber: current[w.id]?.machineNumber ?? String(w.machineNumber || ''), shift: current[w.id]?.shift ?? w.shift ?? 'day' } }))} />}
        <span className="text-xs text-[#F5D77F]">المكينة {w.machineNumber ?? 'غير محددة'} · {w.shift === 'day' ? 'نهار' : w.shift === 'night' ? 'ليل' : 'وردية غير محددة'}</span><span className="text-xs text-gray-500 font-mono">المعرّف: {w.id}</span>
        <span className="text-xs text-gray-400">{w.status}</span>
        <><select className="field w-28" aria-label="المكينة" value={workerEdits[w.id]?.machineNumber ?? String(w.machineNumber || '')} onChange={e => setWorkerEdits(current => ({ ...current, [w.id]: { name: current[w.id]?.name ?? w.name, phone: current[w.id]?.phone ?? w.phone ?? '', machineNumber: e.target.value, shift: current[w.id]?.shift ?? w.shift ?? 'day' } }))}><option value="">المكينة</option><option value="1">مكينة 1</option><option value="2">مكينة 2</option><option value="3">مكينة 3</option></select>
        <select className="field w-28" aria-label="الوردية" value={workerEdits[w.id]?.shift ?? w.shift ?? 'day'} onChange={e => setWorkerEdits(current => ({ ...current, [w.id]: { name: current[w.id]?.name ?? w.name, phone: current[w.id]?.phone ?? w.phone ?? '', machineNumber: current[w.id]?.machineNumber ?? String(w.machineNumber || ''), shift: e.target.value as 'day' | 'night' } }))}><option value="day">نهار</option><option value="night">ليل</option></select></>
        <button className="secondary-button" onClick={() => { if (!workerEdits[w.id]?.machineNumber && !w.machineNumber) { setError('حدد المكينة والوردية أولاً.'); return; } const edit = workerEdits[w.id] || { name: w.name, phone: w.phone || '', machineNumber: String(w.machineNumber || ''), shift: w.shift || 'day' }; const changes = { name: edit.name, machineNumber: Number(edit.machineNumber) as 1 | 2 | 3, shift: edit.shift }; void runMutation(() => updateWorker(w.id, changes), { path: '/api/workers/' + encodeURIComponent(w.id), init: { method: 'PUT', body: JSON.stringify(changes) } }); }}>حفظ البيانات</button>
        {isSupervisor && <>
          <input className="field w-28" inputMode="numeric" maxLength={6} placeholder="PIN جديد" value={pinId === w.id ? pin : ''} onChange={e => { setPinId(w.id); setPin(e.target.value.replace(/\D/g, '')); }} />
          <button className="secondary-button" onClick={() => {
            if (pinId !== w.id || !/^\d{6}$/.test(pin)) { setError('PIN يجب أن يتكون من 6 أرقام بالضبط.'); return; }
            void runMutation(() => setWorkerPin(w.id, pin)); setPin(''); setPinId('');
          }}>حفظ PIN</button>
        </>}
        {canFreezeWorkers && <button className={w.status === 'active' ? 'danger-button' : 'secondary-button'} onClick={() => { const changes = { status: (w.status === 'active' ? 'inactive' : 'active') as 'active' | 'inactive' }; void runMutation(() => updateWorker(w.id, changes), { path: '/api/workers/' + encodeURIComponent(w.id), init: { method: 'PUT', body: JSON.stringify(changes) } }); }}>{w.status === 'active' ? 'تجميد الحساب' : 'إعادة التفعيل'}</button>}
      </div>)}</div>
    </div>}

    {section === 'tasks' && <div className="space-y-5">\n      {modelsError && <div role="alert" className="rounded-lg border border-amber-500/40 bg-amber-950/30 p-3 text-sm text-amber-200">تعذر تحديث قائمة الموديلات؛ تُعرض آخر نسخة محفوظة إن وُجدت. {modelsError}</div>}
      <div className="rounded-xl border border-[#D4AF37]/25 bg-[#0A0A0A] p-4 space-y-3">
        <h3 className="font-bold text-[#F5D77F]">{editingTaskId ? 'تعديل أمر الإنتاج' : 'إصدار أمر إنتاج جديد'}</h3>
        <form onSubmit={addTask} className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <select className="field" value={modelId} onChange={e => setModelId(e.target.value)}>
            <option value="">اختر نوع المودال</option>
            {models.map(model => <option key={model.id} value={model.id}>{model.name} — {model.category}</option>)}
          </select>
          <select className="field" value={assignedWorkerId} onChange={e => setAssignedWorkerId(e.target.value)}>
            <option value="">اختر العامل</option>
            {workers.filter(w => w.status === 'active' && (!isResponsible || !admin.shift || w.shift === admin.shift)).map(w => <option key={w.id} value={w.id}>{w.name} — مكينة {w.machineNumber ?? '?'} — {w.shift === 'day' ? 'نهار' : w.shift === 'night' ? 'ليل' : 'غير محدد'}</option>)}
          </select>
          <input className="field" type="number" min="1" step="1" placeholder="الكمية المطلوبة" value={targetQuantity} onChange={e => setTargetQuantity(e.target.value)} />
          <input className="field" placeholder="ملاحظة أو تعليمات (اختياري)" value={description} onChange={e => setDescription(e.target.value)} />
          <div className="sm:col-span-2 flex gap-2"><button className="gold-button flex-1">{editingTaskId ? 'حفظ تعديل أمر الإنتاج' : 'إرسال أمر الإنتاج للعامل'}</button>{editingTaskId && <button type="button" className="secondary-button" onClick={() => { setEditingTaskId(null); setModelId(''); setAssignedWorkerId(''); setTargetQuantity(''); setDescription(''); }}>إلغاء التعديل</button>}</div>
        </form>
      </div>

      <div className="rounded-xl border border-white/10 bg-[#0A0A0A] p-4">
        <h4 className="font-bold mb-3">تسجيل كمية منجزة</h4>
        <form onSubmit={addProgress} className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <select className="field" value={progressId} onChange={e => setProgressId(e.target.value)}>
            <option value="">اختر المهمة</option>
            {tasks.filter(t => t.status !== 'completed' && t.status !== 'cancelled').map(t => <option key={t.id} value={t.id}>{t.modelName || t.title} ({t.completedQuantity}/{t.targetQuantity})</option>)}
          </select>
          <input className="field" type="number" min="1" step="1" placeholder="الكمية المنجزة" value={progressQuantity} onChange={e => setProgressQuantity(e.target.value)} />
          <button className="gold-button">تسجيل الإنجاز</button>
        </form>
      </div>
      <div className="space-y-2">{tasks.map(t => <article id={`admin-task-${t.id}`} key={t.id} className="rounded-xl border border-white/10 bg-[#0A0A0A] p-3">
        <div className="flex justify-between gap-2"><b>{t.modelName || t.title}</b><span className="text-xs text-[#F5D77F]">{taskStatusLabel(t.status)}</span></div>
        {t.description && <p className="text-sm text-gray-400 mt-1">{t.description}</p>}
        <p className="text-xs text-gray-400 mt-1">المكينة: {t.machineNumber ?? '—'} · الوردية: {t.shift === 'day' ? 'نهار' : t.shift === 'night' ? 'ليل' : '—'} · مشرف العمال: {t.assignedWorkerName || t.assignedWorkerId} · المطلوب: {t.targetQuantity} · المنجز: {t.completedQuantity} · المتبقي: {Math.max(0, t.targetQuantity - t.completedQuantity)}</p>
        <div className="mt-2 h-2 rounded-full bg-white/10"><div className="h-2 rounded-full bg-[#D4AF37]" style={{ width: Math.min(100, t.completedQuantity / Math.max(1, t.targetQuantity) * 100) + '%' }} /></div>
        <div className="mt-3 flex justify-end"><button className="secondary-button" disabled={t.status === 'completed' || t.status === 'cancelled'} onClick={() => { setEditingTaskId(t.id); setModelId(t.modelId || ''); setAssignedWorkerId(t.assignedWorkerId); setTargetQuantity(String(t.targetQuantity)); setDescription(t.description || ''); setSection('tasks'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>تعديل أمر الإنتاج</button></div>
      </article>)}</div>
    </div>}

    {section === 'cycles' && <div className="space-y-3">
      <div className="flex items-center gap-2"><Gauge className="h-5 w-5 text-[#D4AF37]" /><h3 className="font-bold text-[#F5D77F]">تقارير عدد دورات المكائن</h3></div>
      <p className="text-xs leading-6 text-gray-400">تُعرض تقارير كل مكينة ووردية بصورة مستقلة. لا يتم جمع دورات النهار مع الليل.</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <select aria-label="تصفية حسب المكينة" className="field" value={cycleMachineFilter} onChange={e => setCycleMachineFilter(e.target.value)}><option value="">كل المكائن</option><option value="1">المكينة 1</option><option value="2">المكينة 2</option><option value="3">المكينة 3</option></select>
        <select aria-label="تصفية حسب الوردية" className="field" value={cycleShiftFilter} onChange={e => setCycleShiftFilter(e.target.value)}><option value="">كل الورديات</option><option value="day">النهار</option><option value="night">الليل</option></select>
        <input aria-label="تصفية حسب التاريخ" className="field" type="date" value={cycleDateFilter} onChange={e => setCycleDateFilter(e.target.value)} />
      </div>
      <p className="text-xs text-gray-500">عدد التقارير المعروضة: {filteredCycles.length}{cycleNextPageToken ? ' · توجد تقارير أقدم' : ''}</p>
      {!filteredCycles.length && <p className="rounded-xl border border-white/10 bg-[#080808] p-6 text-center text-sm text-gray-500">لا توجد تقارير تطابق عوامل التصفية في الصفحات المحمّلة.</p>}
      {filteredCycles.map(report => <article key={report.id} className="rounded-xl border border-white/10 bg-[#080808] p-3"><div className="flex flex-wrap items-center justify-between gap-2"><b>المكينة {report.machineNumber} · {report.shift === 'day' ? 'النهار' : 'الليل'}</b><strong className="text-[#F5D77F]">{report.count.toLocaleString('ar-TN')} دورة</strong></div><p className="mt-1 text-xs text-gray-400">{report.date}{report.recordedAt ? ` · ${new Date(report.recordedAt).toLocaleString('ar-TN', { timeZone: 'Africa/Tunis' })}` : ''} · {report.workerName}</p><p className="mt-1 text-xs text-gray-500">{report.hasPhoto ? <CycleReportPhoto reportId={report.id} loadPhoto={getMachineCyclePhoto} onOpen={setSelectedCyclePhoto} /> : <p className="mt-2 text-xs text-gray-500">لا توجد صورة مرفقة</p>}</p></article>)}
      {cycleNextPageToken && <button className="secondary-button w-full" disabled={loadingMoreCycles} onClick={() => void loadMoreCycles()}>{loadingMoreCycles ? 'جارٍ تحميل التقارير...' : 'تحميل التقارير الأقدم'}</button>}
    </div>}

    {selectedCyclePhoto && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4" role="dialog" aria-modal="true" aria-label="صورة عداد المكينة" onClick={() => setSelectedCyclePhoto(null)}><div className="max-h-[90vh] max-w-3xl rounded-xl border border-[#D4AF37]/40 bg-[#111] p-3" onClick={e => e.stopPropagation()}><div className="mb-2 flex justify-between"><b className="text-[#F5D77F]">صورة عداد المكينة</b><button className="secondary-button" onClick={() => setSelectedCyclePhoto(null)}>إغلاق</button></div><img src={selectedCyclePhoto.photo} alt="صورة عداد المكينة" className="max-h-[78vh] w-auto rounded-lg object-contain" /></div></div>}

    {section === 'messages' && <PrivateMessagesPanel />}
  </section>;
};
