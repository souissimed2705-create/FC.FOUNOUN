import React, { useState } from 'react';
import { CheckCircle2, Crown, KeyRound, LogOut, Package, ShieldCheck, Users, ClipboardList } from 'lucide-react';
import { UserProfile } from '../lib/firebase';
import { ModelsPanel } from './ModelsPanel';

interface AdminDashboardProps { admin: UserProfile; onLogout: () => Promise<void>; isLoggingOut: boolean; }
type Tab = 'models' | 'workers' | 'tasks';

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ admin, onLogout, isLoggingOut }) => {
  const [tab, setTab] = useState<Tab>('models');
  const tabs = [
    { id: 'models' as const, label: 'الموديلات', icon: Package },
    { id: 'workers' as const, label: 'العمال وPIN', icon: Users },
    { id: 'tasks' as const, label: 'المهام والإنجاز', icon: ClipboardList },
  ];
  return <div className="w-full max-w-5xl mx-auto space-y-5" dir="rtl">
    <header className="rounded-2xl bg-gradient-to-r from-[#17150E] via-[#1F1C12] to-[#121212] border border-[#D4AF37]/40 p-4 sm:p-6 shadow-2xl">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3"><div className="w-12 h-12 rounded-2xl bg-[#0A0A0A] border border-[#D4AF37]/50 flex items-center justify-center"><Crown className="w-6 h-6 text-[#D4AF37]" /></div><div><div className="flex items-center gap-2"><h2 className="text-lg font-bold text-white">لوحة الإدارة الرئيسية</h2><span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-950/80 px-2 py-0.5 text-[11px] text-emerald-300"><CheckCircle2 className="w-3 h-3" /> موثّق</span></div><p className="text-xs text-gray-400 mt-1">مرحباً، <span className="text-[#F5D77F]">{admin.displayName || admin.email}</span></p></div></div>
        <button onClick={onLogout} disabled={isLoggingOut} className="danger-button"><LogOut className="w-4 h-4" /> {isLoggingOut ? 'جاري الخروج...' : 'تسجيل الخروج'}</button>
      </div>
      <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs"><div className="stat"><ShieldCheck className="w-4 h-4 text-[#D4AF37]" /><span>{admin.role}</span></div><div className="stat"><KeyRound className="w-4 h-4 text-emerald-400" /><span>{admin.status}</span></div><div className="stat col-span-2"><span className="text-gray-400">المشروع:</span><span className="font-mono">fc-founoun</span></div></div>
    </header>
    <nav className="grid grid-cols-3 gap-2 rounded-2xl border border-white/10 bg-[#111] p-2">{tabs.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => setTab(id)} className={`tab-button ${tab === id ? 'tab-active' : ''}`}><Icon className="w-4 h-4" />{label}</button>)}</nav>
    {tab === 'models' && <ModelsPanel />}
    {tab === 'workers' && <UnavailablePanel title="إدارة العمال ورموز PIN" icon={<Users className="w-8 h-8" />} detail="هذه الواجهة تحتاج مسارات Worker وقواعد Firestore لمجموعتي workers وworker_pins. المشروع الحالي لا يحتوي هذه المسارات، ولن أضيف كتابة مباشرة أو قواعد جديدة دون موافقة أمنية." />}
    {tab === 'tasks' && <UnavailablePanel title="إنشاء المهام وتسجيل الإنجاز" icon={<ClipboardList className="w-8 h-8" />} detail="هذه الواجهة تحتاج مسارات Worker ومخطط Firestore لمجموعتي tasks وtask_progress، بما في ذلك المزامنة الآمنة بعد انقطاع الإنترنت. لا توجد هذه الخدمات في الإنتاج الحالي بعد." />}
  </div>;
};

const UnavailablePanel: React.FC<{ title: string; detail: string; icon: React.ReactNode }> = ({ title, detail, icon }) => <section className="rounded-2xl border border-amber-500/30 bg-[#17130A] p-8 text-center"><div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-[#D4AF37]/40 bg-[#241D0E] text-[#D4AF37]">{icon}</div><h3 className="text-lg font-bold text-[#F5D77F]">{title}</h3><p className="mx-auto mt-3 max-w-2xl text-sm leading-7 text-gray-300">{detail}</p><span className="mt-5 inline-block rounded-full border border-amber-500/40 bg-amber-950/30 px-4 py-2 text-xs text-amber-200">غير متاح حتى تكتمل خدمة الخادم</span></section>;
