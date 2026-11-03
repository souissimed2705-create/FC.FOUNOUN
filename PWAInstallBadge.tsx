import React, { useState } from 'react';
import { Download, Smartphone, X, Check } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallBadge: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSModal, setShowIOSModal] = useState(false);

  // If already installed in standalone mode, do not display
  if (isInstalled) {
    return (
      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-950/60 border border-emerald-500/30 text-emerald-400 text-[11px] font-medium">
        <Check className="w-3 h-3" />
        <span>تطبيق مثبت (PWA)</span>
      </div>
    );
  }

  // Chromium / Android / Desktop flow
  if (isInstallable) {
    return (
      <button
        onClick={install}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#1A1813] hover:bg-[#252219] border border-[#D4AF37]/40 text-[#F5D77F] text-xs font-medium transition-all shadow-sm active:scale-95"
        title="تثبيت التطبيق على الشاشة الرئيسية للهاتف"
      >
        <Download className="w-3.5 h-3.5 text-[#D4AF37]" />
        <span>تثبيت التطبيق</span>
      </button>
    );
  }

  // iOS Safari flow
  if (isIOS) {
    return (
      <>
        <button
          onClick={() => setShowIOSModal(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#1A1813] hover:bg-[#252219] border border-[#D4AF37]/30 text-[#F5D77F] text-xs font-medium transition-all"
        >
          <Smartphone className="w-3.5 h-3.5 text-[#D4AF37]" />
          <span>تثبيت على الهاتف</span>
        </button>

        {showIOSModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="w-full max-w-sm rounded-2xl bg-[#141414] border border-[#D4AF37]/40 p-5 shadow-2xl text-right">
              <div className="flex items-center justify-between pb-3 border-b border-white/10">
                <button
                  onClick={() => setShowIOSModal(false)}
                  className="text-gray-400 hover:text-white p-1 rounded-lg"
                >
                  <X className="w-4 h-4" />
                </button>
                <h3 className="font-bold text-sm text-[#F5D77F] font-['Cairo']">
                  تثبيت تطبيق FC.FOUNOUN على الهاتف
                </h3>
              </div>

              <div className="py-4 space-y-3 text-xs text-gray-300">
                <div className="flex items-start gap-2.5 bg-black/40 p-2.5 rounded-xl border border-white/5">
                  <span className="w-5 h-5 rounded-full bg-[#D4AF37]/20 text-[#D4AF37] flex items-center justify-center font-bold text-[11px] shrink-0">
                    1
                  </span>
                  <p>
                    اضغط على أيقونة <strong>المشاركة (Share)</strong> أسفل شاشة متصفح Safari.
                  </p>
                </div>
                <div className="flex items-start gap-2.5 bg-black/40 p-2.5 rounded-xl border border-white/5">
                  <span className="w-5 h-5 rounded-full bg-[#D4AF37]/20 text-[#D4AF37] flex items-center justify-center font-bold text-[11px] shrink-0">
                    2
                  </span>
                  <p>
                    مرر لأسفل واختر <strong>إضافة إلى الصفحة الرئيسية (Add to Home Screen)</strong>.
                  </p>
                </div>
              </div>

              <button
                onClick={() => setShowIOSModal(false)}
                className="w-full py-2.5 rounded-xl bg-[#201D16] hover:bg-[#2B271F] border border-[#D4AF37]/30 text-white font-medium text-xs transition"
              >
                إغلاق
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
