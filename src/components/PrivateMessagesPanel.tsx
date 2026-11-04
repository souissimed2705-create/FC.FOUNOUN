import React, { useCallback, useEffect, useState } from 'react';
import { MessageCircle, Send, RefreshCw } from 'lucide-react';
import { auth } from '../lib/firebase';
import { listContacts, listDirectMessages, sendDirectMessage } from '../lib/operationsApi';
import type { ChatMessage, ContactRecord } from '../types/operations';

const roleLabel: Record<ContactRecord['role'], string> = {
  super_admin: 'المشرف العام',
  admin: 'المدير العام',
  responsible: 'المسؤول',
  worker: 'مشرف العمال'
};

export const PrivateMessagesPanel: React.FC = () => {
  const [contacts, setContacts] = useState<ContactRecord[]>([]);
  const [selectedUid, setSelectedUid] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refreshContacts = useCallback(async () => {
    try {
      const result = await listContacts();
      setContacts(result.data || []);
      setSelectedUid(current => current || result.data?.[0]?.uid || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل قائمة المستخدمين.');
    }
  }, []);

  const refreshMessages = useCallback(async () => {
    if (!selectedUid) { setMessages([]); return; }
    try {
      const result = await listDirectMessages(selectedUid);
      setMessages(result.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل المحادثة الخاصة.');
    }
  }, [selectedUid]);

  useEffect(() => { void refreshContacts(); }, [refreshContacts]);
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
