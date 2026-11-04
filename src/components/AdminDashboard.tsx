import React, { useState } from 'react';
import { Home, ClipboardList, Crown, LogOut, Package, ShieldCheck, Users, UserCog } from 'lucide-react';
import { UserProfile } from '../lib/firebase';
import { ModelsPanel } from './ModelsPanel';
import { OperationsPanel } from './OperationsPanel';
import { ManagementAccountsPanel } from './ManagementAccountsPanel';

interface AdminDashboardProps { admin: UserProfile; onLogout: () => Promise<void>; isLoggingOut: boolean; }
type Page = 'home' | 'models' | 'tasks' | 'supervisor' | 'workers' | 'accounts';

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ admin, onLogout, isLoggingOut }) => {
  const [page, setPage] = useState<Page>('home');
  const isSupervisor = admin.role === 'super_admin';
  const canManageWorkers = ['super_admin', 'admin', 'responsible'].includes(admin.role);
  const roleName = isSupervisor ? 'المشرف العام' : admin.role === 'responsible' ? 'المسؤول' : 'المدير العام';
  const greeting = isSupervisor
    ? 'أهلاً بك. أشرف على العمال ورموز الدخول وتابع سير الإنتاج.'
    : admin.role === 'responsible' ? 'أهلاً بك. أنشئ أوامر الإنتاج وتابع تقارير دورات المكائن وتواصل مع مشرفي العمال.' : 'أهلاً بك. أشرف على سير الإنتاج وأدر العمليات المسموح بها.';

  const go = (next: Page) => setPage(next);
  const backHome = () => setPage('home');

  const pageTitle: Record<Page, string> = {
    home: 'الرئيسية',
    models: 'الموديلات والبحث',
    tasks: 'المهام وأوامر الإنتاج',
    supervisor: 'مركز المشرف',
    workers: 'إدارة العمال ورموز الدخول',
    accounts: 'حسابات المديرين والمسؤولين',
  };

  return <div className="w-full max-w-5xl mx-auto space-y-5" dir="rtl">
    <header className="rounded-2xl bg-gradient-to-r from-[#17150E] via-[#1F1C12] to-[#121212] border border-[#D4AF37]/40 p-4 sm:p-6 shadow-2xl">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-[#0A0A0A] border border-[#D4AF37]/50 flex items-center justify-center"><Crown className="w-6 h-6 text-[#D4AF37]" /></div>
          <div>
            <h2 className="text-lg font-bold text-white">{pageTitle[page]}</h2>
            <p className="text-xs text-gray-400 mt-1">{roleName}: <span className="text-[#F5D77F]">{admin.displayName || admin.email}</span></p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {page !== 'home' && <button type="button" onClick={backHome} aria-label="العودة إلى واجهة الاستقبال" title="العودة إلى واجهة الاستقبال" className="flex h-10 w-10 items-center justify-center rounded-full border border-[#D4AF37]/50 bg-[#D4AF37]/10 text-[#F5D77F] transition hover:bg-[#D4AF37]/20 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]"><Home className="h-5 w-5" /></button>}
          <button onClick={onLogout} disabled={isLoggingOut} className="danger-button"><LogOut className="w-4 h-4" /> {isLoggingOut ? 'جاري الخروج...' : 'تسجيل الخروج'}</button>
        </div>
      </div>
      {page === 'home' && <div className="mt-4 rounded-xl border border-[#D4AF37]/20 bg-black/20 px-4 py-3"><p className="text-sm leading-7 text-[#F5D77F]">{greeting}</p></div>}
      <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
        <div className="stat"><ShieldCheck className="w-4 h-4 text-[#D4AF37]" /><span>{roleName}</span></div>
        <div className="stat"><span className="text-gray-400">الحالة:</span><span>{admin.status === 'active' ? 'نشط' : admin.status}</span></div>
        <div className="stat col-span-2 sm:col-span-1"><span className="text-gray-400">المشروع:</span><span className="font-mono">fc-founoun</span></div>
      </div>
    </header>

    {page === 'home' && <>
      <div className="text-center space-y-1 py-1">
        <h3 className="text-base font-bold text-[#F5D77F]">مرحباً بك في FONOUN CHAUSSURES</h3>
        <p className="text-xs text-gray-400">منصة موحّدة للبحث عن الموديلات وتنظيم أوامر الإنتاج ومتابعة العمل.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button onClick={() => go('models')} className="group flex min-h-28 items-center gap-4 rounded-2xl border border-[#D4AF37]/35 bg-[#111] p-5 text-right transition hover:border-[#D4AF37] hover:bg-[#19160E]">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-[#D4AF37]/10 text-[#F5D77F]"><Package className="h-7 w-7" /></span>
          <span><strong className="block text-base text-white">الموديلات والبحث</strong><small className="mt-1 block text-xs leading-5 text-gray-400">عرض الموديلات والبحث عنها وإضافة بياناتها وتعديلها.</small></span>
        </button>
        <button onClick={() => go('tasks')} className="group flex min-h-28 items-center gap-4 rounded-2xl border border-[#D4AF37]/35 bg-[#111] p-5 text-right transition hover:border-[#D4AF37] hover:bg-[#19160E]">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-[#D4AF37]/10 text-[#F5D77F]"><ClipboardList className="h-7 w-7" /></span>
          <span><strong className="block text-base text-white">المهام وأوامر الإنتاج</strong><small className="mt-1 block text-xs leading-5 text-gray-400">إصدار الأوامر وتعيين العمال ومتابعة الإنجاز والتواصل.</small></span>
        </button>
        {isSupervisor && <button onClick={() => go('supervisor')} className="sm:col-span-2 flex min-h-24 items-center gap-4 rounded-2xl border border-[#D4AF37]/60 bg-gradient-to-l from-[#211B0B] to-[#111] p-5 text-right transition hover:border-[#F5D77F]">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-[#D4AF37]/15 text-[#F5D77F]"><Crown className="h-7 w-7" /></span>
          <span><strong className="block text-base text-[#F5D77F]">مركز المشرف</strong><small className="mt-1 block text-xs leading-5 text-gray-400">إدارة العمال ورموز PIN والتجميد وإعادة التفعيل وإعدادات الإشراف.</small></span>
        </button>}
        {!isSupervisor && canManageWorkers && <button onClick={() => go('workers')} className="group flex min-h-28 items-center gap-4 rounded-2xl border border-[#D4AF37]/35 bg-[#111] p-5 text-right transition hover:border-[#D4AF37] hover:bg-[#19160E]"><span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-[#D4AF37]/10 text-[#F5D77F]"><Users className="h-7 w-7" /></span><span><strong className="block text-base text-white">إدارة مشرفي العمال</strong><small className="mt-1 block text-xs leading-5 text-gray-400">تحديث الأسماء وأكواد الدخول وتوزيع المكائن حسب صلاحيتك.</small></span></button>}
      </div>
    </>}

    {page === 'models' && <ModelsPanel />}
    {page === 'tasks' && <OperationsPanel initialSection="tasks" admin={admin} />}
    {page === 'supervisor' && isSupervisor && <section className="space-y-3 rounded-2xl border border-[#D4AF37]/25 bg-[#111] p-4">
      <div><h3 className="font-bold text-[#F5D77F]">أدوات المشرف</h3><p className="mt-1 text-xs leading-6 text-gray-400">هذه الصفحة خاصة بحساب المشرف، ولا تظهر للمسؤول أو العامل.</p></div>
      <button onClick={() => go('workers')} className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-[#090909] p-4 text-right hover:border-[#D4AF37]/60">
        <Users className="h-6 w-6 text-[#F5D77F]" /><span><b className="block text-sm">إدارة العمال ورموز PIN</b><small className="text-xs text-gray-400">إضافة العمال وتعديل بياناتهم ورموزهم وتجميدهم وإعادة تفعيلهم.</small></span>
      </button>
      <button onClick={() => go('accounts')} className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-[#090909] p-4 text-right hover:border-[#D4AF37]/60">
        <UserCog className="h-6 w-6 text-[#F5D77F]" /><span><b className="block text-sm text-gray-200">إدارة حسابات المديرين والمسؤولين</b><small className="text-xs text-gray-400">إنشاء الحسابات وتعيين الأكواد السرية والتجميد وإعادة التفعيل.</small></span>
      </button>
    </section>}
    {page === 'workers' && canManageWorkers && <OperationsPanel initialSection="workers" admin={admin} />}
    {page === 'accounts' && isSupervisor && <ManagementAccountsPanel />}
  </div>;
};
