import React from 'react';
import {
  ShieldCheck,
  LogOut,
  Crown,
  Package,
  ShoppingBag,
  Sliders,
  Sparkles,
  KeyRound,
  CheckCircle2,
  Lock,
} from 'lucide-react';
import { UserProfile } from '../lib/firebase';

interface AdminDashboardProps {
  admin: UserProfile;
  onLogout: () => Promise<void>;
  isLoggingOut: boolean;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  admin,
  onLogout,
  isLoggingOut,
}) => {
  return (
    <div className="w-full max-w-4xl mx-auto space-y-6">
      {/* Top Banner: Verification Success & Security Seal */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#17150E] via-[#1F1C12] to-[#121212] border border-[#D4AF37]/40 p-4 sm:p-6 shadow-2xl gold-glow">
        <div className="absolute top-0 right-0 w-32 h-32 bg-[#D4AF37]/10 rounded-full blur-3xl pointer-events-none"></div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-[#0A0A0A] border border-[#D4AF37]/50 flex items-center justify-center shrink-0 shadow-md">
              <Crown className="w-6 h-6 sm:w-7 sm:h-7 text-[#D4AF37]" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg sm:text-xl font-bold text-white font-['Cairo']">
                  لوحة الإدارة الرئيسية
                </h2>
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 text-[11px] font-semibold">
                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                  <span>موثّق في Firestore</span>
                </span>
              </div>
              <p className="text-xs sm:text-sm text-gray-400 mt-0.5">
                مرحباً بك، <span className="text-[#F5D77F] font-semibold">{admin.displayName || admin.email}</span>
              </p>
            </div>
          </div>

          {/* Logout Button */}
          <button
            onClick={onLogout}
            disabled={isLoggingOut}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#261515] hover:bg-[#381B1B] border border-red-500/40 text-red-200 text-xs sm:text-sm font-semibold transition-all active:scale-95 disabled:opacity-50"
            title="تسجيل الخروج الآمن وإنهاء الجلسة"
          >
            <LogOut className="w-4 h-4 text-red-400" />
            <span>{isLoggingOut ? 'جاري تسجيل الخروج...' : 'تسجيل الخروج الآمن'}</span>
          </button>
        </div>
      </div>

      {/* Verified Permissions & Identity Card (Strictly Read-Only) */}
      <div className="rounded-2xl bg-[#111111] border border-white/10 p-5 sm:p-6 shadow-xl space-y-4">
        <div className="flex items-center justify-between border-b border-white/5 pb-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-[#D4AF37]" />
            <h3 className="text-sm sm:text-base font-bold text-white font-['Cairo']">
              بيانات الصلاحية والهوية المشفرة
            </h3>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-gray-400 bg-black/40 px-2.5 py-1 rounded-lg border border-white/5">
            <Lock className="w-3 h-3 text-[#D4AF37]" />
            <span>صلاحيات للقراءة فقط غير قابلة للتعديل</span>
          </div>
        </div>

        {/* 4 Identity Grid Points */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-right">
          {/* Role */}
          <div className="p-3.5 rounded-xl bg-[#0B0B0B] border border-white/5 flex flex-col gap-1">
            <span className="text-[11px] text-gray-500 font-medium">الدور الأمني (Role)</span>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="inline-flex px-2 py-0.5 rounded-md bg-[#251E10] border border-[#D4AF37]/40 text-[#F5D77F] text-xs font-mono font-bold">
                {admin.role}
              </span>
              <span className="text-[11px] text-emerald-400 font-medium">(مسؤول رئيسي)</span>
            </div>
          </div>

          {/* Status */}
          <div className="p-3.5 rounded-xl bg-[#0B0B0B] border border-white/5 flex flex-col gap-1">
            <span className="text-[11px] text-gray-500 font-medium">حالة الحساب (Status)</span>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 text-xs font-mono font-bold">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                {admin.status}
              </span>
              <span className="text-[11px] text-gray-400 font-medium">(مفعّل ونشط)</span>
            </div>
          </div>

          {/* Email */}
          <div className="p-3.5 rounded-xl bg-[#0B0B0B] border border-white/5 flex flex-col gap-1">
            <span className="text-[11px] text-gray-500 font-medium">البريد الإلكتروني المعتمد</span>
            <span className="text-xs text-white font-mono truncate" dir="ltr" title={admin.email}>
              {admin.email}
            </span>
          </div>

          {/* UID */}
          <div className="p-3.5 rounded-xl bg-[#0B0B0B] border border-white/5 flex flex-col gap-1">
            <span className="text-[11px] text-gray-500 font-medium">المعرّف الأمني (UID)</span>
            <span className="text-[11px] text-gray-400 font-mono truncate" dir="ltr" title={admin.uid}>
              {admin.uid}
            </span>
          </div>
        </div>

        {/* Security Path Note */}
        <div className="pt-2 flex items-center justify-between text-[11px] text-gray-500">
          <span>مسار التحقق الموثّق: <code className="text-[#D4AF37] font-mono bg-black/50 px-1.5 py-0.5 rounded">users/{admin.uid}</code></span>
          <span className="text-gray-400">مشروع: <strong className="text-white font-mono">fc-founoun</strong></span>
        </div>
      </div>

      {/* Main Operational Modules Preview for FC.FOUNOUN */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Module 1: Luxury Footwear Inventory */}
        <div className="p-5 rounded-2xl bg-[#111111] border border-white/10 hover:border-[#D4AF37]/30 transition group">
          <div className="w-10 h-10 rounded-xl bg-[#1A1813] border border-[#D4AF37]/30 flex items-center justify-center mb-3">
            <Package className="w-5 h-5 text-[#D4AF37]" />
          </div>
          <h4 className="text-sm font-bold text-white group-hover:text-[#F5D77F] transition">
            كتالوج ومخزون الأحذية
          </h4>
          <p className="text-xs text-gray-400 mt-1 leading-relaxed">
            إدارة مجموعات أحذية فنون الرجالية والنسائية، المقاسات، والألوان والأسعار.
          </p>
          <div className="mt-3 pt-3 border-t border-white/5 text-[11px] text-[#D4AF37]/80 flex items-center gap-1">
            <Sparkles className="w-3 h-3" />
            <span>نظام الإدارة مهيأ ومخوّل</span>
          </div>
        </div>

        {/* Module 2: Orders & Sales */}
        <div className="p-5 rounded-2xl bg-[#111111] border border-white/10 hover:border-[#D4AF37]/30 transition group">
          <div className="w-10 h-10 rounded-xl bg-[#1A1813] border border-[#D4AF37]/30 flex items-center justify-center mb-3">
            <ShoppingBag className="w-5 h-5 text-[#D4AF37]" />
          </div>
          <h4 className="text-sm font-bold text-white group-hover:text-[#F5D77F] transition">
            الطلبات والعمليات
          </h4>
          <p className="text-xs text-gray-400 mt-1 leading-relaxed">
            متابعة طلبات العملاء الفورية، حالات الشحن والتوصيل، والفواتير الصادرة.
          </p>
          <div className="mt-3 pt-3 border-t border-white/5 text-[11px] text-[#D4AF37]/80 flex items-center gap-1">
            <Sparkles className="w-3 h-3" />
            <span>جلسة نشطة للمسؤول</span>
          </div>
        </div>

        {/* Module 3: Security & Store Settings */}
        <div className="p-5 rounded-2xl bg-[#111111] border border-white/10 hover:border-[#D4AF37]/30 transition group">
          <div className="w-10 h-10 rounded-xl bg-[#1A1813] border border-[#D4AF37]/30 flex items-center justify-center mb-3">
            <Sliders className="w-5 h-5 text-[#D4AF37]" />
          </div>
          <h4 className="text-sm font-bold text-white group-hover:text-[#F5D77F] transition">
            إعدادات النظام والأمان
          </h4>
          <p className="text-xs text-gray-400 mt-1 leading-relaxed">
            التحكم في سياسات المتجر، أوقات التسليم، والتوافق مع معايير PWA.
          </p>
          <div className="mt-3 pt-3 border-t border-white/5 text-[11px] text-[#D4AF37]/80 flex items-center gap-1">
            <KeyRound className="w-3 h-3" />
            <span>مستوى الأمان: Super Admin</span>
          </div>
        </div>
      </div>
    </div>
  );
};
