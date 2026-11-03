# FC.FOUNOUN – فنون للأحذية (Luxury Footwear Platform)

تطبيق ويب تقدمي (PWA) فاخر لإدارة وتسجيل الدخول واستعراض موديلات الأحذية لعلامة **FC.FOUNOUN (فنون للأحذية)**، متصل ببوابة خلفية آمنة عبر **Cloudflare Worker** وقاعدة بيانات **Firebase Firestore** مع نظام تحكم بالصلاحيات قائم على الأدوار (RBAC).

---

## 📁 بنية المشروع (Project Structure)

```text
fc-founoun/
├── public/                       # الأصول العامة وأيقونات الـ PWA
│   ├── favicon.png
│   ├── icon.svg
│   ├── apple-touch-icon.png
│   └── manifest.webmanifest
├── src/                          # كود الواجهة الأمامية (Frontend React + TypeScript)
│   ├── components/               # مكونات الواجهة (تسجيل الدخول، إدارة الموديلات، الإحصائيات)
│   ├── context/                  # سياق المصادقة وإدارة الجلسات (AuthContext)
│   ├── lib/                      # عملاء الاتصال (firebase.ts, modelsApi.ts)
│   ├── types/                    # تعريفات النماذج والأنماط (models.ts, auth.ts)
│   ├── utils/                    # أدوات المعالجة والتحقق الصارم
│   │   ├── imageOptimizer.ts     # تحسين الصور وحساب حدود أطوال Data URL
│   │   ├── imageValidator.ts     # فحص Base64 (RFC 4648) و WebP و JPEG وحجم الوثيقة
│   │   └── modelNormalization.ts # توحيد أسماء الموديلات واشتقاق SHA-256 (بدون NFKC)
│   ├── App.tsx                   # المكون الجذري للتطبيق
│   ├── main.tsx                  # نقطة انطلاق التطبيق
│   └── index.css                 # التنسيقات العامة (Tailwind CSS)
├── worker/                       # خادم Cloudflare Worker الخلفي
│   ├── worker.js                 # كود المعالجة الذرية، التحقق من JWT، وعمليات REST
│   ├── wrangler.toml             # إعدادات نشر Worker على Cloudflare
│   └── README.md                 # دليل نشر وإعداد الخادم السحابي
├── tests/                        # حزمة الاختبارات الآلية الشاملة
│   └── run_tests.ts              # اختبارات مؤكدة تستورد الدوال الفعلية للإنتاج
├── firestore.rules               # قواعد الأمان الصارمة لقاعدة بيانات Firestore
├── index.html                    # صفحة HTML الرئيسية وتنسيقات العلامة الفاخرة
├── metadata.json                 # بيانات التعريف الوصفية للتطبيق
├── package.json                  # الاعتماديات وأوامر التشغيل
├── package-lock.json             # ملف قفل الاعتماديات (npm)
├── bun.lock                      # ملف قفل الاعتماديات (bun)
├── tsconfig.json                 # إعدادات مترجم TypeScript
├── vite.config.ts                # إعدادات Vite وحزمة PWA
└── .env.example                  # نموذج المتغيرات البيئية الخالي من الأسرار
```

---

## 🚀 التثبيت والتشغيل المحلي (Getting Started)

### 1. تثبيت الحزم:
```bash
npm install
```

### 2. تشغيل بيئة التطوير المحلية (Dev Server):
```bash
npm run dev
```
يعمل التطبيق افتراضيًا على الرابط: `http://localhost:3000`.

### 3. تشغيل حزمة الاختبارات الآلية المؤكدة (40 اختباراً):
```bash
npm test
```

### 4. الفحص اللغوي للأنماط (TypeScript Linting):
```bash
npm run lint
```

### 5. بناء نسخة الإنتاج (Production Build):
```bash
npm run build
```

---

## 🛡️ إعدادات Firebase وقواعد الأمان

1. أنشئ مشروع Firebase بالمعرّف `fc-founoun`.
2. انسخ المتغيرات من `.env.example` إلى ملف `.env.local` وضع مفاتيح مشروعك العامة.
3. لنشر قواعد الأمان الموجودة في `firestore.rules`:
```bash
firebase deploy --only firestore:rules
```

---

## ☁️ نشر Cloudflare Worker

يقع كود الخادم الخلفي داخل مجلد `worker/`:
1. انتقل إلى مجلد الـ Worker: `cd worker`.
2. راجع ملف `worker/README.md` للاطلاع على المتغيرات السرية المطلوبة (`FIREBASE_SERVICE_ACCOUNT` و `APP_URL`).
3. عند الرغبة بالنشر: `npx wrangler deploy`.

---

## 🔒 الأمان والخصوصية

- تم استبعاد وتجريد المشروع تمامًا من أي مفاتيح خاصة أو كلمات مرور أو أسرار تشغيلية.
- يتم تعيين الأسرار عبر لوحة تحكم Cloudflare و Firebase بشكل آمن ومستقل.
