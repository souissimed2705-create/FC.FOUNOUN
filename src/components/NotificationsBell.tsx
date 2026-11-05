import React, { useState, useEffect } from 'react';
import { Bell, Check } from 'lucide-react';
import { listNotifications, markNotificationRead } from '../lib/operationsApi';
import type { NotificationRecord } from '../types/operations';

export const NotificationsBell: React.FC = () => {
  const [items, setItems] = useState<NotificationRecord[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const refresh = async () => {
    try { const result = await listNotifications(); setItems(result.data || []); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'تعذر تحميل الإشعارات.'); }
  };
  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 15000); return () => window.clearInterval(timer); }, []);
  const markRead = async (id: string) => {
    try { await markNotificationRead(id); setItems(old => old.map(x => x.id === id ? { ...x, readAt: new Date().toISOString() } : x)); }
    catch (e) { setError(e instanceof Error ? e.message : 'تعذر تحديث الإشعار.'); }
  };
  const unread = items.filter(x => !x.readAt).length;
  return <div className="relative">
    <button type="button" onClick={() => { setOpen(v => !v); if (!open) void refresh(); }} className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-[#D4AF37]/30 bg-[#17140D] text-[#F5D77F]" aria-label="الإشعارات">
      <Bell className="h-5 w-5" />
      {unread > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-red-600 px-1.5 text-[10px] text-white">{unread}</span>}
    </button>
    {open && <div dir="rtl" className="absolute left-0 top-12 z-[100] w-[min(92vw,360px)] overflow-hidden rounded-2xl border border-[#D4AF37]/35 bg-[#101010] shadow-2xl">
      <div className="border-b border-white/10 p-3 text-sm font-bold text-[#F5D77F]">الإشعارات</div>
      {error && <p className="p-3 text-xs text-red-300">{error}</p>}
      {!items.length && !error && <p className="p-6 text-center text-sm text-gray-500">لا توجد إشعارات حتى الآن.</p>}
      <div className="max-h-[60vh] overflow-y-auto">{items.map(item => <article key={item.id} className="border-b border-white/5 p-3">
        <b className="block text-sm text-white">{item.title}</b><p className="mt-1 text-xs leading-5 text-gray-300">{item.body}</p>
        <div className="mt-2 flex items-center justify-between"><time className="text-[10px] text-gray-500">{new Date(item.createdAt).toLocaleString('ar-TN', { timeZone: 'Africa/Tunis' })}</time>
        {!item.readAt && <button type="button" onClick={() => void markRead(item.id)} aria-label="تعليم كمقروء"><Check className="h-4 w-4 text-[#F5D77F]" /></button>}</div>
      </article>)}</div>
    </div>}
  </div>;
};
