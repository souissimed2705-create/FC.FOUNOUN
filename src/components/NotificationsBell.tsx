import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Bell, Check, X, Volume2 } from 'lucide-react';
import { listNotifications, markNotificationRead } from '../lib/operationsApi';
import type { NotificationRecord } from '../types/operations';

export const NotificationsBell: React.FC = () => {
  const [items, setItems] = useState<NotificationRecord[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [soundMode, setSoundMode] = useState<'soft' | 'bright' | 'silent'>(() => {
    try {
      const saved = localStorage.getItem('fc-message-sound-mode');
      return saved === 'bright' || saved === 'silent' ? saved : 'soft';
    } catch { return 'soft'; }
  });
  const seenNotificationIds = useRef<Set<string> | null>(null);

  const playMessageSound = (mode: 'soft' | 'bright' = soundMode) => {
    if (mode === 'silent') return;
    try {
      const AudioContextClass = window.AudioContext;
      if (!AudioContextClass) return;
      const context = new AudioContextClass();
      const notes = mode === 'bright' ? [880, 1175] : [660, 784];
      notes.forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const start = context.currentTime + index * 0.16;
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.12, start + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.14);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(start);
        oscillator.stop(start + 0.15);
      });
      window.setTimeout(() => void context.close(), 700);
    } catch (e) { console.warn('Message sound unavailable:', e); }
  };

  const changeSoundMode = (mode: 'soft' | 'bright' | 'silent') => {
    setSoundMode(mode);
    try { localStorage.setItem('fc-message-sound-mode', mode); } catch { /* device storage unavailable */ }
    if (mode !== 'silent') playMessageSound(mode);
  };

  const refresh = async () => {
    try {
      const result = await listNotifications();
      const nextItems = result.data || [];
      const nextIds = new Set(nextItems.map(item => item.id));
      if (seenNotificationIds.current) {
        const hasNewMessage = nextItems.some(item => item.type === 'direct_message' && !seenNotificationIds.current?.has(item.id));
        if (hasNewMessage) playMessageSound();
      }
      seenNotificationIds.current = nextIds;
      setItems(nextItems);
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
              <div><h2 id="notifications-title" className="text-base font-bold text-[#F5D77F]">الإشعارات</h2><div className="mt-2 flex flex-wrap items-center gap-2 text-xs"><Volume2 className="h-4 w-4 text-[#D4AF37]" /><label htmlFor="message-sound-mode" className="text-gray-300">نغمة الرسائل:</label><select id="message-sound-mode" value={soundMode} onChange={event => changeSoundMode(event.target.value as 'soft' | 'bright' | 'silent')} className="rounded-lg border border-white/15 bg-[#181818] px-2 py-1 text-gray-100"><option value="soft">هادئة</option><option value="bright">واضحة</option><option value="silent">صامت</option></select><button type="button" onClick={() => playMessageSound(soundMode === 'silent' ? 'soft' : soundMode)} className="rounded-lg border border-[#D4AF37]/30 px-2 py-1 text-[#F5D77F]">تجربة</button></div></div>
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
