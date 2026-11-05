import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Bell, Check, X } from 'lucide-react';
import { listNotifications, markNotificationRead } from '../lib/operationsApi';
import type { NotificationRecord } from '../types/operations';

export const NotificationsBell: React.FC = () => {
  const [items, setItems] = useState<NotificationRecord[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');

  const refresh = async () => {
    try {
      const result = await listNotifications();
      setItems(result.data || []);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تحميل الإشعارات.');
    }
  };

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [open]);

  const markRead = async (id: string) => {
    try {
      await markNotificationRead(id);
      setItems(old => old.map(x => x.id === id ? { ...x, readAt: new Date().toISOString() } : x));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تحديث الإشعار.');
    }
  };

  const unread = items.filter(x => !x.readAt).length;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          void refresh();
        }}
        className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-[#D4AF37]/30 bg-[#17140D] text-[#F5D77F]"
        aria-label="الإشعارات"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-red-600 px-1.5 text-[10px] text-white">{unread}</span>}
      </button>

      {open && createPortal(
        <div
          dir="rtl"
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="notifications-title"
            className="flex w-full max-w-md flex-col overflow-hidden rounded-2xl border border-[#D4AF37]/45 bg-[#101010] shadow-[0_20px_80px_rgba(0,0,0,0.8)]"
            style={{ maxHeight: 'min(82dvh, 680px)' }}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-white/10 p-4">
              <h2 id="notifications-title" className="text-base font-bold text-[#F5D77F]">الإشعارات</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-300 hover:bg-white/10"
                aria-label="إغلاق الإشعارات"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {error && <p className="shrink-0 p-3 text-xs text-red-300">{error}</p>}
            {!items.length && !error && <p className="p-8 text-center text-sm text-gray-500">لا توجد إشعارات حتى الآن.</p>}

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {items.map(item => (
                <article key={item.id} className="border-b border-white/5 p-4">
                  <b className="block text-sm text-white">{item.title}</b>
                  <p className="mt-1 text-sm leading-6 text-gray-300">{item.body}</p>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <time className="text-[10px] text-gray-500">
                      {new Date(item.createdAt).toLocaleString('ar-TN', { timeZone: 'Africa/Tunis' })}
                    </time>
                    {!item.readAt && (
                      <button
                        type="button"
                        onClick={() => void markRead(item.id)}
                        className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-[#F5D77F] hover:bg-[#D4AF37]/10"
                        aria-label="تعليم كمقروء"
                      >
                        <Check className="h-4 w-4" />
                        مقروء
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>,
        document.body
      )}
    </>
  );
};
