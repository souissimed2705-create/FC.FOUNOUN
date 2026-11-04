import React, { useEffect, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { createTask, createWorker, flushQueuedMutations, listConversation, listTasks, listWorkers, queuedMutationCount, recordProgress, sendManagementMessage, setWorkerPin, updateWorker } from '../lib/operationsApi';
import { listShoeModels } from '../lib/modelsApi';
import type { ShoeModel } from '../types/models';
import type { ChatMessage, TaskRecord, WorkerRecord } from '../types/operations';
import type { UserProfile } from '../lib/firebase';

type Section = 'workers' | 'tasks' | 'messages';
interface Props { initialSection: 'workers' | 'tasks'; admin: UserProfile; }

export const OperationsPanel: React.FC<Props> = ({ initialSection, admin }) => {
  const isSupervisor = admin.role === 'super_admin';
  const [section, setSection] = useState<Section>(initialSection);
  const [workers, setWorkers] = useState<WorkerRecord[]>([]);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [models, setModels] = useState<ShoeModel[]>([]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [workerEdits, setWorkerEdits] = useState<Record<string, { name: string; phone: string }>>({});
  const [pinId, setPinId] = useState('');
  const [pin, setPin] = useState('');
  const [modelId, setModelId] = useState('');
  const [assignedWorkerId, setAssignedWorkerId] = useState('');
  const [targetQuantity, setTargetQuantity] = useState('');
  const [description, setDescription] = useState('');
  const [progressId, setProgressId] = useState('');
  const [progressQuantity, setProgressQuantity] = useState('');
  const [selectedWorkerId, setSelectedWorkerId] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(queuedMutationCount());
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setError(null);
    try {
      const [w, t, m] = await Promise.all([listWorkers(), listTasks(), listShoeModels({ pageSize: 100 })]);
      setWorkers(w.data || []);
      setWorkerEdits(current => Object.fromEntries((w.data || []).map(worker => [worker.id, current[worker.id] || { name: worker.name, phone: worker.phone || '' }])));
      setTasks(t.data || []);
      setModels(m.models || []);
      setSelectedWorkerId(current => current || w.data?.[0]?.id || '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تحميل البيانات.');
    }
  };

  const refreshConversation = async (workerId = selectedWorkerId) => {
    if (!workerId) { setMessages([]); return; }
    try {
      const result = await listConversation(workerId);
      setMessages(result.data || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تحميل المحادثة.');
    }
  };

  useEffect(() => {
    void refresh();
    const handler = async () => { await flushQueuedMutations(); setPending(queuedMutationCount()); void refresh(); };
    window.addEventListener('online', handler);
    return () => window.removeEventListener('online', handler);
  }, []);

  useEffect(() => {
    if (section !== 'messages' || !selectedWorkerId) return;
    void refreshConversation(selectedWorkerId);
    const timer = window.setInterval(() => void refreshConversation(selectedWorkerId), 7000);
    return () => window.clearInterval(timer);
  }, [section, selectedWorkerId]);

  const runMutation = async (fn: () => Promise<unknown>, fallback?: { path: string; init: RequestInit }) => {
    setError(null); setNotice(null);
    try {
      if (!navigator.onLine && fallback) {
        const { queueMutation } = await import('../lib/operationsApi');
        queueMutation(fallback.path, fallback.init);
        setPending(queuedMutationCount());
        setNotice('لا يوجد اتصال؛ حُفظت العملية وستتم مزامنتها عند عودة الاتصال.');
        return;
      }
      await fn();
      setNotice('تم الحفظ بنجاح.');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'فشلت العملية.');
    }
  };

  const addWorker = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('اسم العامل مطلوب.'); return; }
    void runMutation(() => createWorker({ name: name.trim(), phone: phone.trim() }), { path: '/api/workers', init: { method: 'POST', body: JSON.stringify({ name: name.trim(), phone: phone.trim() }) } });
    setName(''); setPhone('');
  };

  const addTask = (e: React.FormEvent) => {
    e.preventDefault();
    const model = models.find(item => item.id === modelId);
    const qty = Number(targetQuantity);
    if (!model || !assignedWorkerId || !Number.isSafeInteger(qty) || qty < 1) {
      setError('اختر المودال والعامل وأدخل الكمية المطلوبة بصورة صحيحة.');
      return;
    }
    const payload = { title: 'إنتاج مودال ' + model.name, description: description.trim(), modelId: model.id, modelName: model.name, assignedWorkerId, targetQuantity: qty };
    void runMutation(() => createTask(payload), { path: '/api/tasks', init: { method: 'POST', body: JSON.stringify(payload) } });
    setModelId(''); setTargetQuantity(''); setDescription('');
  };

  const addProgress = (e: React.FormEvent) => {
    e.preventDefault();
    const qty = Number(progressQuantity);
    if (!progressId || !Number.isSafeInteger(qty) || qty < 1) { setError('اختر مهمة وأدخل كمية صحيحة.'); return; }
    const body = { quantity: qty, clientMutationId: crypto.randomUUID() };
    void runMutation(() => recordProgress(progressId, body), { path: '/api/tasks/' + encodeURIComponent(progressId) + '/progress', init: { method: 'POST', body: JSON.stringify(body) } });
    setProgressQuantity('');
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedWorkerId || !draft.trim()) return;
    setBusy(true); setError(null);
    try {
      await sendManagementMessage(selectedWorkerId, draft.trim());
      setDraft('');
      await refreshConversation(selectedWorkerId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر إرسال الرسالة.');
    } finally { setBusy(false); }
  };

  const tabs: { id: Section; label: string }[] = [
    ...(isSupervisor ? [{ id: 'workers' as const, label: 'إدارة العمال' }] : []),
    { id: 'tasks', label: 'أوامر الإنتاج' },
    { id: 'messages', label: 'المحادثة' },
  ];

  return <section className="w-full rounded-2xl border border-white/10 bg-[#111] p-5 space-y-4" dir="rtl">
    <div className="flex flex-wrap gap-2 mb-2">
      {tabs.map(tab => <button key={tab.id} className={'tab-button ' + (section === tab.id ? 'tab-active' : '')} onClick={() => setSection(tab.id)}>{tab.id === 'messages' && <MessageCircle className="w-4 h-4" />}{tab.label}</button>)}
      <button className="secondary-button mr-auto" onClick={() => void refresh()}>تحديث</button>
    </div>
    {pending > 0 && <div className="rounded-lg border border-amber-500/40 bg-amber-950/30 p-3 text-xs text-amber-200">عمليات تنتظر المزامنة: {pending}</div>}
    {error && <div role="alert" className="rounded-lg border border-red-500/40 bg-red-950/40 p-3 text-sm text-red-200">{error}</div>}
    {notice && <div className="rounded-lg border border-emerald-500/40 bg-emerald-950/30 p-3 text-sm text-emerald-200">{notice}</div>}

    {section === 'workers' && isSupervisor && <div className="space-y-4">
      <h3 className="font-bold text-[#F5D77F]">إدارة العمال ورموز الدخول</h3>
      <form onSubmit={addWorker} className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <input className="field" placeholder="اسم العامل" value={name} onChange={e => setName(e.target.value)} />
        <input className="field" placeholder="الهاتف (اختياري)" value={phone} onChange={e => setPhone(e.target.value)} />
        <button className="gold-button">إضافة عامل</button>
      </form>
      <div className="space-y-2">{workers.map(w => <div key={w.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-[#0A0A0A] p-3">
        <input className="field min-w-0 flex-1" aria-label="اسم العامل" value={workerEdits[w.id]?.name ?? w.name} onChange={e => setWorkerEdits(current => ({ ...current, [w.id]: { name: e.target.value, phone: current[w.id]?.phone ?? w.phone ?? '' } }))} />
        <input className="field w-32" aria-label="هاتف العامل" value={workerEdits[w.id]?.phone ?? w.phone ?? ''} onChange={e => setWorkerEdits(current => ({ ...current, [w.id]: { name: current[w.id]?.name ?? w.name, phone: e.target.value } }))} />
        <span className="text-xs text-[#F5D77F] font-mono">الرمز: {w.id}</span>
        <span className="text-xs text-gray-400">{w.status}</span>
        <button className="secondary-button" onClick={() => void runMutation(() => updateWorker(w.id, workerEdits[w.id] || { name: w.name, phone: w.phone || '' }))}>حفظ البيانات</button>
        <input className="field w-28" inputMode="numeric" maxLength={6} placeholder="PIN جديد" value={pinId === w.id ? pin : ''} onChange={e => { setPinId(w.id); setPin(e.target.value.replace(/\D/g, '')); }} />
        <button className="secondary-button" onClick={() => {
          if (pinId !== w.id || !/^\d{6}$/.test(pin)) { setError('PIN يجب أن يتكون من 6 أرقام بالضبط.'); return; }
          void runMutation(() => setWorkerPin(w.id, pin)); setPin(''); setPinId('');
        }}>حفظ PIN</button>
        <button className={w.status === 'active' ? 'danger-button' : 'secondary-button'} onClick={() => void runMutation(() => updateWorker(w.id, { status: w.status === 'active' ? 'inactive' : 'active' }))}>{w.status === 'active' ? 'تجميد العامل' : 'إعادة التفعيل'}</button>
      </div>)}</div>
    </div>}

    {section === 'tasks' && <div className="space-y-5">
      <div className="rounded-xl border border-[#D4AF37]/25 bg-[#0A0A0A] p-4 space-y-3">
        <h3 className="font-bold text-[#F5D77F]">إصدار أمر إنتاج جديد</h3>
        <form onSubmit={addTask} className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <select className="field" value={modelId} onChange={e => setModelId(e.target.value)}>
            <option value="">اختر نوع المودال</option>
            {models.map(model => <option key={model.id} value={model.id}>{model.name} — {model.category}</option>)}
          </select>
          <select className="field" value={assignedWorkerId} onChange={e => setAssignedWorkerId(e.target.value)}>
            <option value="">اختر العامل</option>
            {workers.filter(w => w.status === 'active').map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <input className="field" type="number" min="1" step="1" placeholder="الكمية المطلوبة" value={targetQuantity} onChange={e => setTargetQuantity(e.target.value)} />
          <input className="field" placeholder="ملاحظة أو تعليمات (اختياري)" value={description} onChange={e => setDescription(e.target.value)} />
          <button className="gold-button sm:col-span-2">إرسال أمر الإنتاج للعامل</button>
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
      <div className="space-y-2">{tasks.map(t => <article key={t.id} className="rounded-xl border border-white/10 bg-[#0A0A0A] p-3">
        <div className="flex justify-between gap-2"><b>{t.modelName || t.title}</b><span className="text-xs text-[#F5D77F]">{t.status}</span></div>
        {t.description && <p className="text-sm text-gray-400 mt-1">{t.description}</p>}
        <p className="text-xs text-gray-400 mt-1">العامل: {t.assignedWorkerName || t.assignedWorkerId} · المطلوب: {t.targetQuantity} · المنجز: {t.completedQuantity} · المتبقي: {Math.max(0, t.targetQuantity - t.completedQuantity)}</p>
        <div className="mt-2 h-2 rounded-full bg-white/10"><div className="h-2 rounded-full bg-[#D4AF37]" style={{ width: Math.min(100, t.completedQuantity / Math.max(1, t.targetQuantity) * 100) + '%' }} /></div>
      </article>)}</div>
    </div>}

    {section === 'messages' && <div className="space-y-3">
      <h3 className="font-bold text-[#F5D77F]">المحادثات الخاصة مع العمال</h3>
      <select className="field w-full" value={selectedWorkerId} onChange={e => setSelectedWorkerId(e.target.value)}>
        <option value="">اختر العامل لفتح المحادثة</option>
        {workers.map(w => <option key={w.id} value={w.id}>{w.name} {w.status === 'inactive' ? '(مجمّد)' : ''}</option>)}
      </select>
      <div className="min-h-48 max-h-80 overflow-y-auto space-y-2 rounded-xl border border-white/10 bg-[#080808] p-3">
        {!messages.length && <p className="text-center text-sm text-gray-500 py-8">لا توجد رسائل بعد.</p>}
        {messages.map(msg => <div key={msg.id} className={'max-w-[88%] rounded-xl p-3 ' + (msg.senderRole === 'worker' ? 'ml-auto bg-white/10' : 'mr-auto bg-[#3A2E12]')}>
          <div className="text-[11px] text-[#F5D77F] mb-1">{msg.senderName} · {new Date(msg.createdAt).toLocaleString('ar-TN')}</div>
          <p className="text-sm whitespace-pre-wrap break-words">{msg.text}</p>
        </div>)}
      </div>
      <form onSubmit={sendMessage} className="flex gap-2">
        <input className="field min-w-0 flex-1" placeholder="اكتب رسالة للعامل..." value={draft} onChange={e => setDraft(e.target.value)} disabled={!selectedWorkerId || busy} />
        <button className="gold-button" disabled={!selectedWorkerId || busy || !draft.trim()}>إرسال</button>
      </form>
    </div>}
  </section>;
};
