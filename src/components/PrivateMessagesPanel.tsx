import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MessageCircle, Send, RefreshCw, Volume2 } from 'lucide-react';
import { auth } from '../lib/firebase';
import { listContacts, listDirectMessages, sendDirectMessage } from '../lib/operationsApi';
import type { ChatMessage, ContactRecord } from '../types/operations';

const roleLabel: Record<ContactRecord['role'], string> = {
  super_admin: 'المشرف العام',
  admin: 'المدير العام',
  responsible: 'المسؤول',
  worker: 'مشرف العمال'
};

export const PrivateMessagesPanel: React.FC<{ initialContactUid?: string }> = ({ initialContactUid }) => {
  const [contacts, setContacts] = useState<ContactRecord[]>([]);
  const [selectedUid, setSelectedUid] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [soundMode, setSoundMode] = useState<'soft' | 'bright' | 'strong' | 'silent'>(() => {
    try {
      const saved = localStorage.getItem('fc-message-sound-mode');
      return saved === 'soft' || saved === 'bright' || saved === 'strong' || saved === 'silent' ? saved : 'strong';
    } catch { return 'strong'; }
  });
  const seenMessageIds = useRef<Set<string> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const unlockMessageAudio = async () => {
    try {
      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        audioContextRef.current = new window.AudioContext();
      }
      if (audioContextRef.current.state !== 'running') await audioContextRef.current.resume();
    } catch (err) { console.warn('Private message audio could not be unlocked:', err); }
  };

  const playIncomingMessageSound = async () => {
    try {
      let mode = 'strong';
      try { mode = localStorage.getItem('fc-message-sound-mode') || 'strong'; } catch { /* storage unavailable */ }
      if (mode === 'silent') return;
      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        audioContextRef.current = new window.AudioContext();
      }
      const context = audioContextRef.current;
      if (context.state !== 'running') await context.resume();
      if (context.state !== 'running') return;
      const notes = mode === 'soft' ? [660, 784] : mode === 'bright' ? [880, 1175, 1397] : [784, 988, 1175, 988, 1568];
      const noteGap = mode === 'strong' ? 0.19 : 0.16;
      const duration = mode === 'strong' ? 0.28 : 0.18;
      const melodyDuration = (notes.length - 1) * noteGap + duration;
      for (let repeat = 0; repeat < 3; repeat++) {
        const repeatStart = context.currentTime + repeat * (melodyDuration + 0.35);
        notes.forEach((frequency, index) => {
          const oscillator = context.createOscillator();
          const gain = context.createGain();
          const start = repeatStart + index * noteGap;
          oscillator.type = mode === 'strong' ? 'square' : 'sine';
          oscillator.frequency.setValueAtTime(frequency, start);
          gain.gain.setValueAtTime(0.0001, start);
          gain.gain.exponentialRampToValueAtTime(mode === 'strong' ? 0.82 : 0.32, start + 0.025);
          gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
          oscillator.connect(gain); gain.connect(context.destination);
          oscillator.start(start); oscillator.stop(start + duration + 0.01);
        });
      }
      if (mode === 'strong' && typeof navigator.vibrate === 'function') {
        navigator.vibrate([220, 80, 220, 80, 320, 350, 220, 80, 220, 80, 320, 350, 220, 80, 220, 80, 320]);
      }
    } catch (err) { console.warn('Private message sound unavailable:', err); }
  };

  const changeSoundMode = (mode: 'soft' | 'bright' | 'strong' | 'silent') => {
    setSoundMode(mode);
    try { localStorage.setItem('fc-message-sound-mode', mode); } catch { /* storage unavailable */ }
    if (mode !== 'silent') {
      void unlockMessageAudio().then(() => playIncomingMessageSound());
    }
  };

  const refreshContacts = useCallback(async () => {
    try {
      const result = await listContacts();
      const nextContacts = result.data || [];
      setContacts(nextContacts);
      setSelectedUid(current => (
        initialContactUid && nextContacts.some(contact => contact.uid === initialContactUid)
          ? initialContactUid
          : current || nextContacts[0]?.uid || ''
      ));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل قائمة المستخدمين.');
    }
  }, [initialContactUid]);

  const refreshMessages = useCallback(async () => {
    if (!selectedUid) { setMessages([]); return; }
    try {
      const result = await listDirectMessages(selectedUid);
      const nextMessages = result.data || [];
      const nextIds = new Set(nextMessages.map(message => message.id));
      if (seenMessageIds.current) {
        const hasIncoming = nextMessages.some(message =>
          !seenMessageIds.current?.has(message.id) && message.senderUid !== auth.currentUser?.uid
        );
        if (hasIncoming) void playIncomingMessageSound();
      }
      seenMessageIds.current = nextIds;
      setMessages(nextMessages);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل المحادثة الخاصة.');
    }
  }, [selectedUid]);

  useEffect(() => { void refreshContacts(); }, [refreshContacts]);
  useEffect(() => {
    const unlockOnce = () => { void unlockMessageAudio(); };
    window.addEventListener('pointerdown', unlockOnce, { once: true, passive: true });
    window.addEventListener('keydown', unlockOnce, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlockOnce);
      window.removeEventListener('keydown', unlockOnce);
    };
  }, []);
  useEffect(() => { seenMessageIds.current = null; }, [selectedUid]);
  useEffect(() => {
    void refreshMessages();
    if (!selectedUid) return;
    const timer = window.setInterval(() => void refreshMessages(), 7000);
    return () => window.clearInterval(timer);
  }, [selectedUid, refreshMessages]);

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedUid || !draft.trim()) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await sendDirectMessage(selectedUid, draft.trim());
      setDraft('');
      await refreshMessages();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إرسال الرسالة.');
    } finally { setBusy(false); }
  };

  const selected = contacts.find(contact => contact.uid === selectedUid);
  return <section dir="rtl" className="space-y-3 rounded-2xl border border-white/10 bg-[#111] p-4">
    <div className="flex items-center gap-2"><MessageCircle className="h-5 w-5 text-[#D4AF37]" /><div><h3 className="font-bold text-[#F5D77F]">المراسلات الخاصة</h3><p className="text-xs text-gray-400">كل محادثة لا يراها إلا طرفاها.</p></div></div>
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#D4AF37]/25 bg-[#18140B] p-3">
      <Volume2 className="h-4 w-4 text-[#D4AF37]" />
      <label htmlFor="private-message-sound-mode" className="text-xs text-gray-300">نغمة الرسائل الخاصة:</label>
      <select id="private-message-sound-mode" value={soundMode} onChange={e => changeSoundMode(e.target.value as 'soft' | 'bright' | 'strong' | 'silent')} className="rounded-lg border border-white/15 bg-[#181818] px-2 py-1 text-sm text-gray-100">
        <option value="strong">قوية جداً</option>
        <option value="bright">واضحة</option>
        <option value="soft">هادئة</option>
        <option value="silent">صامتة</option>
      </select>
      <button type="button" onClick={() => { if (soundMode !== 'silent') void unlockMessageAudio().then(() => playIncomingMessageSound()); else { try { localStorage.setItem('fc-message-sound-mode', 'strong'); } catch {} void unlockMessageAudio().then(() => playIncomingMessageSound()); } }} className="rounded-lg border border-[#D4AF37]/30 px-3 py-1 text-xs text-[#F5D77F]">تجربة النغمة</button>
    </div>
    <div className="flex gap-2">
      <select className="field min-w-0 flex-1" value={selectedUid} onChange={e => { setSelectedUid(e.target.value); setMessages([]); setError(''); }}>
        <option value="">اختر مستخدماً لبدء محادثة خاصة</option>
        {contacts.map(contact => <option key={contact.uid} value={contact.uid}>{contact.name} — {roleLabel[contact.role]}</option>)}
      </select>
      <button className="secondary-button" onClick={() => void refreshContacts()} aria-label="تحديث قائمة المستخدمين"><RefreshCw className="h-4 w-4" /></button>
    </div>
    {error && <p role="alert" className="rounded-lg bg-red-950/40 p-3 text-sm text-red-200">{error}</p>}
    {notice && <p className="rounded-lg bg-emerald-950/30 p-3 text-sm text-emerald-200">{notice}</p>}
    {selected && <p className="text-xs text-[#F5D77F]">محادثة خاصة مع {selected.name} · {roleLabel[selected.role]}</p>}
    <div className="min-h-48 max-h-80 space-y-2 overflow-y-auto rounded-xl border border-white/10 bg-[#080808] p-3">
      {!messages.length && <p className="py-8 text-center text-sm text-gray-500">{selected ? 'لا توجد رسائل بعد. ابدأ المحادثة.' : 'اختر مستخدماً لعرض محادثتكما.'}</p>}
      {messages.map(message => {
        const mine = message.senderUid === auth.currentUser?.uid;
        return <div key={message.id} className={'max-w-[88%] rounded-xl p-3 ' + (mine ? 'mr-auto bg-[#3A2E12]' : 'ml-auto bg-white/10')}>
          <div className="mb-1 text-[11px] text-[#F5D77F]">{mine ? 'أنت' : message.senderName} · {new Date(message.createdAt).toLocaleString('ar-TN', { timeZone: 'Africa/Tunis' })}</div>
          <p className="break-words whitespace-pre-wrap text-sm">{message.text}</p>
        </div>;
      })}
    </div>
    <form onSubmit={send} className="flex gap-2">
      <input className="field min-w-0 flex-1" placeholder={selected ? 'اكتب رسالة خاصة...' : 'اختر مستخدماً أولاً'} value={draft} onChange={e => setDraft(e.target.value)} disabled={!selectedUid || busy} />
      <button className="gold-button" disabled={!selectedUid || busy || !draft.trim()}><Send className="h-4 w-4" /> إرسال</button>
    </form>
  </section>;
};
