import React, { useEffect, useMemo, useState } from 'react';
import { createShoeModel, deleteShoeModel, listShoeModels, updateShoeModel } from '../lib/modelsApi';
import type { CreateModelPayload, ShoeCategory, ShoeModel } from '../types/models';
import { optimizeAndEncodeImage, validateDualImageLimits } from '../utils/imageOptimizer';
import { readOfflineSnapshot, saveOfflineSnapshot } from '../utils/offlineCache';

const categories: ShoeCategory[] = ['سومال', 'صيافي', 'شتاوي'];

type FormState = CreateModelPayload;
interface ModelsPanelProps { readOnly?: boolean; }
const emptyForm: FormState = { name: '', category: 'سومال', image1: '', image2: '' };

export const ModelsPanel: React.FC<ModelsPanelProps> = ({ readOnly = false }) => {
  const [models, setModels] = useState<ShoeModel[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<ShoeCategory | ''>('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState<string | null>(null);

  const loadModels = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listShoeModels({ search, category: category || undefined, pageSize: 100 });
      setModels(result.models);
      setMessage(null);
      void saveOfflineSnapshot('model-catalog', result.models).catch(() => undefined);
    } catch (err) {
      const cached = await readOfflineSnapshot<ShoeModel[]>('model-catalog').catch(() => null);
      if (cached) {
        const normalizedSearch = search.trim().toLocaleLowerCase();
        setModels(cached.filter(model => (!category || model.category === category) && (!normalizedSearch || model.name.toLocaleLowerCase().includes(normalizedSearch))));
        setMessage('الاتصال غير متاح؛ تعرض الآن آخر نسخة محفوظة من كتالوج الموديلات على هذا الهاتف.');
        setError(null);
      } else {
        setError(err instanceof Error ? err.message : 'تعذر تحميل الموديلات، ولا توجد نسخة محفوظة.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadModels(); }, [search, category]);

  const totalImageChars = useMemo(() => (form.image1.length + form.image2.length), [form.image1, form.image2]);

  const chooseImage = async (field: 'image1' | 'image2', file?: File) => {
    if (!file) return;
    setError(null);
    try {
      const image = await optimizeAndEncodeImage(file, { maxChars: 320000 });
      setForm((current) => ({ ...current, [field]: image.dataUrl }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تجهيز الصورة.');
    }
  };

  const saveModel = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setMessage(null);
    if (!form.name.trim() || !form.image1 || !form.image2) {
      setError('أدخل اسم الموديل واختر الصورتين قبل الحفظ.');
      return;
    }
    const limits = validateDualImageLimits(form.image1.length, form.image2.length);
    if (!limits.valid) { setError(limits.error || 'حجم الصور غير صالح.'); return; }
    setSaving(true);
    try {
      if (editingId) {
        await updateShoeModel(editingId, form);
        setMessage('تم تعديل الموديل بنجاح.');
      } else {
        await createShoeModel(form);
        setMessage('تمت إضافة الموديل بنجاح.');
      }
      setForm(emptyForm);
      setEditingId(null);
      await loadModels();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حفظ الموديل.');
    } finally { setSaving(false); }
  };

  const editModel = (model: ShoeModel) => {
    setEditingId(model.id);
    setForm({ name: model.name, category: model.category, image1: model.image1, image2: model.image2, weightMg: model.weightMg, firstPositionMm: model.firstPositionMm, lastPositionMm: model.lastPositionMm });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const removeModel = async (model: ShoeModel) => {
    if (!window.confirm(`حذف الموديل «${model.name}»؟ لا يمكن التراجع عن هذا الإجراء.`)) return;
    setError(null);
    try {
      await deleteShoeModel(model.id);
      setMessage('تم حذف الموديل وتحرير اسمه.');
      await loadModels();
    } catch (err) { setError(err instanceof Error ? err.message : 'تعذر حذف الموديل.'); }
  };

  const updateNumber = (key: keyof FormState, value: string) => setForm((current) => ({ ...current, [key]: value === '' ? undefined : Number(value) }));

  return <section className="w-full space-y-5" dir="rtl">
    <div className="rounded-2xl border border-[#D4AF37]/30 bg-[#111] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div><h3 className="text-lg font-bold text-[#F5D77F]">كتالوج الموديلات</h3><p className="text-xs text-gray-400 mt-1">إضافة الصور والقياسات، البحث، التعديل والحذف عبر Worker وFirestore.</p></div>
        <span className="text-xs text-gray-400">{models.length} موديل</span>
      </div>
      {error && <div className="mb-3 rounded-lg border border-red-500/40 bg-red-950/40 p-3 text-sm text-red-200">{error}</div>}
      {message && <div className="mb-3 rounded-lg border border-emerald-500/40 bg-emerald-950/30 p-3 text-sm text-emerald-200">{message}</div>}
      {!readOnly && <form onSubmit={saveModel} className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="اسم الموديل" className="field" />
        <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as ShoeCategory })} className="field">{categories.map((item) => <option key={item}>{item}</option>)}</select>
        <label className="field cursor-pointer">الصورة الأولى<input type="file" accept="image/*" className="block w-full text-xs mt-2" onChange={(e) => void chooseImage('image1', e.target.files?.[0])} /></label>
        <label className="field cursor-pointer">الصورة الثانية<input type="file" accept="image/*" className="block w-full text-xs mt-2" onChange={(e) => void chooseImage('image2', e.target.files?.[0])} /></label>
        <input type="number" min="1" value={form.weightMg ?? ''} onChange={(e) => updateNumber('weightMg', e.target.value)} placeholder="الوزن بالميليغرام (اختياري)" className="field" />
        <input type="number" min="1" value={form.firstPositionMm ?? ''} onChange={(e) => updateNumber('firstPositionMm', e.target.value)} placeholder="قياس الموضع الأول mm" className="field" />
        <input type="number" min="1" value={form.lastPositionMm ?? ''} onChange={(e) => updateNumber('lastPositionMm', e.target.value)} placeholder="قياس الموضع الأخير mm" className="field" />
        <div className="flex items-center gap-2 text-xs text-gray-400">حجم الصور: {totalImageChars.toLocaleString('ar-EG')} محرف / 600,000</div>
        <div className="md:col-span-2 flex gap-2"><button disabled={saving} className="gold-button">{saving ? 'جاري الحفظ...' : editingId ? 'حفظ التعديل' : 'إضافة الموديل'}</button>{editingId && <button type="button" onClick={() => { setEditingId(null); setForm(emptyForm); }} className="secondary-button">إلغاء</button>}</div>
      </form>}
    </div>
    <div className="rounded-2xl border border-white/10 bg-[#111] p-4">
      <div className="flex flex-col sm:flex-row gap-2 mb-4"><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث باسم الموديل..." className="field flex-1" /><select value={category} onChange={(e) => setCategory(e.target.value as ShoeCategory | '')} className="field sm:w-40"><option value="">كل التصنيفات</option>{categories.map((item) => <option key={item}>{item}</option>)}</select><button onClick={() => void loadModels()} className="secondary-button">تحديث</button></div>
      {loading ? <p className="text-center text-sm text-gray-400 py-8">جاري تحميل الموديلات...</p> : models.length === 0 ? <p className="text-center text-sm text-gray-500 py-8">لا توجد موديلات مطابقة.</p> : <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">{models.map((model) => <article key={model.id} className="rounded-xl border border-white/10 bg-[#0A0A0A] p-3"><div className="grid grid-cols-2 gap-2"><img src={model.image1} alt={model.name} onClick={() => setZoomed(model.image1)} className="h-32 w-full object-cover rounded-lg cursor-zoom-in" /><img src={model.image2} alt={model.name} onClick={() => setZoomed(model.image2)} className="h-32 w-full object-cover rounded-lg cursor-zoom-in" /></div><h4 className="mt-3 font-bold text-white">{model.name}</h4><p className="text-xs text-[#D4AF37] mt-1">{model.category}</p><p className="text-xs text-gray-500 mt-1">{model.weightMg ? `${model.weightMg} mg` : 'بدون وزن'} · {model.firstPositionMm ?? '-'} / {model.lastPositionMm ?? '-'} mm</p>{!readOnly && <div className="flex gap-2 mt-3"><button onClick={() => editModel(model)} className="secondary-button flex-1">تعديل</button><button onClick={() => void removeModel(model)} className="danger-button flex-1">حذف</button></div>}</article>)}</div>}
    </div>
    {zoomed && <button aria-label="إغلاق التكبير" onClick={() => setZoomed(null)} className="fixed inset-0 z-50 bg-black/90 p-6 flex items-center justify-center cursor-zoom-out"><img src={zoomed} alt="صورة مكبرة" className="max-h-full max-w-full object-contain" /></button>}
  </section>;
};
