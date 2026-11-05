import React, { useState, useEffect } from 'react';
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  ShieldCheck,
  AlertCircle,
  Sparkles,
  ShieldAlert,
} from 'lucide-react';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import {
  auth,
  verifySuperAdmin,
  UserProfile,
  mapAuthErrorToArabic,
  mapAuthorizationErrorToArabic,
} from '../lib/firebase';

interface AdminLoginFormProps {
  onSuccess: (admin: UserProfile) => void;
  externalError?: string | null;
  onClearExternalError?: () => void;
}

interface FormErrors {
  email?: string;
  password?: string;
  general?: string;
}

export const AdminLoginForm: React.FC<AdminLoginFormProps> = ({
  onSuccess,
  externalError,
  onClearExternalError,
}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [isLoading, setIsLoading] = useState(false);

  // Sync external error if passed (e.g. session revocation or auth state error)
  useEffect(() => {
    if (externalError) {
      setErrors((prev) => ({ ...prev, general: externalError }));
    }
  }, [externalError]);

  // Email format validation regex
  const isValidEmail = (val: string) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val.trim());
  };

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {};

    // Validate Email
    if (!email.trim()) {
      newErrors.email = 'يرجى إدخال البريد الإلكتروني الخاص بالمشرف العام.';
    } else if (!isValidEmail(email)) {
      newErrors.email = 'صيغة البريد الإلكتروني غير صالحة. يرجى إدخال عنوان بريد إلكتروني صحيح.';
    }

    // Validate Password
    if (!password) {
      newErrors.password = 'يرجى إدخال كلمة المرور.';
    } else if (password.length < 6) {
      newErrors.password = 'كلمة المرور يجب ألا تقل عن 6 خانات.';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (onClearExternalError) {
      onClearExternalError();
    }
    setErrors({});

    const isValid = validateForm();
    if (!isValid) {
      return;
    }

    setIsLoading(true);

    try {
      // Step 1: Sign in with email and password via Firebase Authentication
      const userCredential = await signInWithEmailAndPassword(
        auth,
        email.trim(),
        password
      );

      // Obtain user UID
      const uid = userCredential.user.uid;

      // Step 2 & 3: Query Firestore doc: users/{uid} and verify role and status
      try {
        const verifiedAdmin = await verifySuperAdmin(uid);

        // Step 5: Authorization successful - grant dashboard entry
        setPassword('');
        onSuccess(verifiedAdmin);
      } catch (authzErr: unknown) {
        // Step 4: If doc not found, role != super_admin, or status != active:
        // Execute signOut directly and block access
        await signOut(auth);

        const errorObj = authzErr as { message?: string; code?: string };
        const detailedError = mapAuthorizationErrorToArabic(
          errorObj?.message || errorObj?.code || ''
        );

        setErrors({ general: detailedError });
      }
    } catch (authErr: unknown) {
      const firebaseError = authErr as { code?: string; message?: string };
      const errorMessage = mapAuthErrorToArabic(firebaseError?.code || '');
      setErrors({ general: errorMessage });
    } finally {
      setIsLoading(false);
    }
  };

  const handleInputChange = (field: 'email' | 'password', value: string) => {
    if (field === 'email') {
      setEmail(value);
      if (errors.email || errors.general) {
        setErrors((prev) => ({ ...prev, email: undefined, general: undefined }));
      }
    } else {
      setPassword(value);
      if (errors.password || errors.general) {
        setErrors((prev) => ({ ...prev, password: undefined, general: undefined }));
      }
    }
    if (externalError && onClearExternalError) {
      onClearExternalError();
    }
  };

  return (
    <div className="w-full max-w-md mx-auto">
      {/* Decorative Gold Header Pill */}
      <div className="flex items-center justify-center gap-2 mb-4">
        <span className="h-px w-8 bg-gradient-to-r from-transparent to-[#D4AF37]/60"></span>
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#1A1813] border border-[#D4AF37]/30 text-[#E5C158] text-[11px] sm:text-xs font-semibold tracking-wider">
          <ShieldCheck className="w-3.5 h-3.5 text-[#D4AF37]" />
          <span>بوابة الدخول المشفرة • Firebase RBAC</span>
        </div>
        <span className="h-px w-8 bg-gradient-to-l from-transparent to-[#D4AF37]/60"></span>
      </div>

      {/* Main Luxury Card */}
      <div className="relative rounded-2xl bg-[#111111] border border-[#D4AF37]/25 shadow-2xl p-5 sm:p-8 backdrop-blur-xl transition-all duration-300 hover:border-[#D4AF37]/40 gold-glow">
        {/* Subtle Ambient Gold Corner Accents */}
        <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-bl from-[#D4AF37]/15 to-transparent rounded-tr-2xl pointer-events-none"></div>
        <div className="absolute bottom-0 left-0 w-16 h-16 bg-gradient-to-tr from-[#D4AF37]/10 to-transparent rounded-bl-2xl pointer-events-none"></div>

        {/* Card Title & Subtitle */}
        <div className="text-center mb-6 sm:mb-8">
          <h2 className="text-xl sm:text-2xl font-bold text-white tracking-normal font-['Cairo']">
            دخول المشرف العام
          </h2>
          <p className="mt-1.5 text-xs sm:text-sm text-gray-400 font-normal leading-relaxed">
            التحقق الثنائي: مصادقة الحساب وفحص صلاحية الإدارة <span className="font-mono text-[#D4AF37]">super_admin</span> في Firestore
          </p>
        </div>

        {/* General / Authorization Error Alert */}
        {errors.general && (
          <div className="mb-5 p-3.5 rounded-xl bg-red-950/50 border border-red-500/50 text-red-200 text-xs sm:text-sm flex items-start gap-2.5">
            <ShieldAlert className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div className="flex-1 text-right">
              <span className="font-semibold text-red-300 block mb-0.5">تنبيه أمني</span>
              <span className="text-xs text-red-200/90 leading-relaxed">{errors.general}</span>
            </div>
          </div>
        )}

        {/* Login Form */}
        <form onSubmit={handleSubmit} noValidate className="space-y-4 sm:space-y-5">
          {/* Email Field */}
          <div>
            <label
              htmlFor="admin-email"
              className="block text-xs sm:text-sm font-medium text-gray-300 mb-1.5 text-right"
            >
              البريد الإلكتروني للمشرف العام
            </label>
            <div className="relative">
              <input
                id="admin-email"
                type="email"
                value={email}
                onChange={(e) => handleInputChange('email', e.target.value)}
                placeholder="admin@founoun.com"
                dir="ltr"
                autoComplete="email"
                inputMode="email"
                disabled={isLoading}
                className={`w-full px-3.5 py-3 pr-10 text-sm text-white bg-[#0A0A0A] rounded-xl border transition-all duration-200 outline-none placeholder:text-gray-600 disabled:opacity-50 text-left ${
                  errors.email
                    ? 'border-red-500/80 focus:border-red-500 focus:ring-2 focus:ring-red-500/20'
                    : 'border-white/10 hover:border-[#D4AF37]/40 focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20'
                }`}
              />
              <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-gray-500">
                <Mail className="w-4 h-4 text-[#D4AF37]/80" />
              </div>
            </div>
            {errors.email && (
              <p className="mt-1.5 text-xs text-red-400 flex items-center gap-1.5 text-right">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{errors.email}</span>
              </p>
            )}
          </div>

          {/* Password Field */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label
                htmlFor="admin-password"
                className="text-xs sm:text-sm font-medium text-gray-300 text-right"
              >
                كلمة المرور
              </label>
            </div>
            <div className="relative">
              <input
                id="admin-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => handleInputChange('password', e.target.value)}
                placeholder="••••••••••••"
                dir="ltr"
                autoComplete="current-password"
                disabled={isLoading}
                className={`w-full px-10 py-3 text-sm text-white bg-[#0A0A0A] rounded-xl border transition-all duration-200 outline-none placeholder:text-gray-600 disabled:opacity-50 text-left ${
                  errors.password
                    ? 'border-red-500/80 focus:border-red-500 focus:ring-2 focus:ring-red-500/20'
                    : 'border-white/10 hover:border-[#D4AF37]/40 focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20'
                }`}
              />
              {/* Right Lock Icon */}
              <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-gray-500">
                <Lock className="w-4 h-4 text-[#D4AF37]/80" />
              </div>

              {/* Left Eye Toggle Button */}
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={0}
                aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400 hover:text-[#D4AF37] transition-colors focus:outline-none"
              >
                {showPassword ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
            {errors.password && (
              <p className="mt-1.5 text-xs text-red-400 flex items-center gap-1.5 text-right">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{errors.password}</span>
              </p>
            )}
          </div>

          {/* Submit Button */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={isLoading}
              className="w-full relative group overflow-hidden rounded-xl font-bold py-3.5 px-4 text-sm sm:text-base transition-all duration-300 active:scale-[0.99] disabled:opacity-60 disabled:pointer-events-none shadow-lg shadow-[#D4AF37]/15 bg-gradient-to-r from-[#BF953F] via-[#FCF6BA] to-[#AA771C] text-[#0A0A0A] hover:brightness-105 hover:shadow-[#D4AF37]/25"
            >
              <div className="relative flex items-center justify-center gap-2">
                {isLoading ? (
                  <>
                    <svg
                      className="animate-spin h-5 w-5 text-black"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      ></circle>
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      ></path>
                    </svg>
                    <span>جاري التحقق من الصلاحيات...</span>
                  </>
                ) : (
                  <>
                    <span>تسجيل الدخول والتحقق</span>
                    <Sparkles className="w-4 h-4 text-black" />
                  </>
                )}
              </div>
            </button>
          </div>
        </form>

        {/* Security Policy Note */}
        <div className="mt-6 pt-5 border-t border-white/5 text-center">
          <p className="text-[11px] sm:text-xs text-gray-500 leading-normal">
            مشروع: <span className="font-mono text-gray-400">fc-founoun</span> • مسار الصلاحية: <span className="font-mono text-gray-400">users/{'{uid}'}</span>. الدخول مقتصر على حساب المشرف العام النشط فقط.
          </p>
        </div>
      </div>
    </div>
  );
};
