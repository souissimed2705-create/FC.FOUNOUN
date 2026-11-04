# تقرير خطأ مفتاح Firebase في تطبيق FC.FOUNOUN

**التاريخ:** 2026-11-04
**المشروع:** `fc-founoun`
**النطاق:** تشخيص محلي فقط؛ لم يتم نشر أي تغيير إلى Firebase أو Firestore أو Cloudflare.

## الملخص التنفيذي

التنبيه الظاهر في التطبيق صحيح، وليس خطأً عشوائيًا في تسجيل الدخول. نسخة التطبيق التي تم بناؤها لا تحصل على قيمة صالحة للمتغير `VITE_FIREBASE_API_KEY`.

النتيجة: عند تحميل Firebase Web SDK، تكون قيمة `apiKey` فارغة، وعند محاولة تسجيل الدخول يرجع Firebase خطأ من نوع `auth/invalid-api-key` أو `auth/api-key-not-valid`، ثم يحوّله التطبيق إلى الرسالة العربية:

> مفتاح API الخاص بـ Firebase لمشروع fc-founoun غير صالح أو لم يتم ضبطه بعد في المتغيرات البيئية (`VITE_FIREBASE_API_KEY`).

## الأدلة التي تم فحصها

1. الملف `src/lib/firebase.ts` يقرأ:

   ```ts
   const rawApiKey = (import.meta.env.VITE_FIREBASE_API_KEY || '').trim();
   ```

2. ملف إعداد البيئة الوحيد الموجود في المشروع هو `.env.example`، وقيمته الحالية:

   ```env
   VITE_FIREBASE_API_KEY=""
   VITE_FIREBASE_PROJECT_ID="fc-founoun"
   VITE_FIREBASE_AUTH_DOMAIN="fc-founoun.firebaseapp.com"
   VITE_FIREBASE_STORAGE_BUCKET="fc-founoun.appspot.com"
   VITE_FIREBASE_MESSAGING_SENDER_ID=""
   VITE_FIREBASE_APP_ID=""
   ```

3. لا يوجد ملف `.env` فعلي في نسخة المشروع المفحوصة. وبذلك لا يحقن Vite مفتاح Firebase في نسخة الإنتاج.

4. التطبيق مضبوط على المشروع `fc-founoun` في `projectId`، لكن `messagingSenderId` و`appId` فارغان أيضًا في الإعداد النموذجي. قد لا يمنع ذلك كل عمليات Auth، لكنه يعني أن إعداد Firebase المنشور غير مكتمل ويجب تعبئة القيم الرسمية من إعدادات تطبيق الويب في Firebase.

5. الكود لا يحتوي على مفتاح احتياطي مخفي؛ وهذا سلوك أمني صحيح. لا ينبغي وضع مفاتيح عشوائية أو مفاتيح Admin/Service Account داخل تطبيق الويب.

## السبب الجذري

تم بناء أو نشر التطبيق دون توفير متغيرات Firebase العامة المطلوبة في بيئة البناء. وجود `.env.example` لا يكفي؛ Vite يقرأ عادةً ملف `.env`, `.env.local` أو متغيرات بيئة منصة النشر وقت البناء، وليس `.env.example` تلقائيًا.

## طريقة الإصلاح الصحيحة

1. من Firebase Console افتح المشروع `fc-founoun`.
2. اذهب إلى **Project settings → Your apps**.
3. اختر تطبيق الويب المسجل، أو أنشئ تطبيق Web إذا لم يكن موجودًا.
4. انسخ إعدادات Firebase Web العامة الرسمية، وبالأخص:
   - `apiKey`
   - `authDomain`
   - `projectId` ويجب أن يكون `fc-founoun`
   - `storageBucket`
   - `messagingSenderId`
   - `appId`
5. ضعها في متغيرات بيئة البناء، مثلًا في `.env.local` للتطوير المحلي أو في إعدادات منصة النشر للإنتاج:

   ```env
   VITE_FIREBASE_API_KEY=القيمة_الرسمية_من_Firebase
   VITE_FIREBASE_AUTH_DOMAIN=fc-founoun.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=fc-founoun
   VITE_FIREBASE_STORAGE_BUCKET=القيمة_الرسمية_من_Firebase
   VITE_FIREBASE_MESSAGING_SENDER_ID=القيمة_الرسمية_من_Firebase
   VITE_FIREBASE_APP_ID=القيمة_الرسمية_من_Firebase
   ```

6. أعد بناء التطبيق بعد ضبط المتغيرات؛ متغيرات `VITE_*` تُضمّن وقت البناء، لذلك تغييرها بعد البناء لا يكفي.
7. اختبر تسجيل الدخول بحساب فعلي مفعّل في Firebase Authentication.
8. اختبر قراءة ملف المستخدم `users/{uid}` في Firestore، مع التأكد من أن `role` يساوي `super_admin` وأن `status` يساوي `active`.
9. لا تضع مفتاح Service Account أو مفتاحًا سريًا في `.env` الخاص بالواجهة أو في المستودع. مفتاح Firebase Web `apiKey` ليس سرًا بحد ذاته، لكن يجب تقييده من Google Cloud/Firebase حسب HTTP referrers وواجهات API المطلوبة.

## ما يحتاج إلى قرار قبل الإصلاح

الإصلاح البرمجي الآمن هو جعل التطبيق يرفض التشغيل برسالة إعداد واضحة عندما تكون القيم ناقصة، بدل محاولة تهيئة Firebase بإعداد فارغ. أما تعبئة القيم الفعلية فتحتاج إلى أخذها من إعدادات Firebase الرسمية أو من متغيرات منصة النشر. لن أخمّن المفتاح ولن أضع قيمة وهمية.

## ما تم وما لم يتم

- تم فحص `src/lib/firebase.ts` و`vite.config.ts` وملفات البيئة.
- لم يتم كشف أي قيمة سرية في هذا التقرير.
- لم يتم تعديل Firebase أو Firestore أو Cloudflare.
- لم يتم تغيير قواعد Firestore.
- لم يتم دمج Pull Request في `main`.
- لم يتم اختبار تسجيل الدخول الحقيقي لأن نسخة المشروع الحالية لا تحتوي على إعداد Firebase صالح.

## الخلاصة

سبب عدم فتح التطبيق هو أن نسخة البناء تفتقد `VITE_FIREBASE_API_KEY`، مع نقص بقية قيم إعداد تطبيق Firebase أيضًا. الحل هو ضبط إعداد Web الرسمي لمشروع `fc-founoun` في بيئة البناء ثم إعادة البناء والنشر، مع إضافة تحقق برمجي واضح يمنع تشغيل التطبيق بإعداد ناقص.
