import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';

const rootElement = document.getElementById('root');

function showStartupError(title: string, detail: string) {
  if (!rootElement) return;
  rootElement.innerHTML = '';
  const panel = document.createElement('main');
  panel.dir = 'rtl';
  panel.style.cssText = 'min-height:100vh;box-sizing:border-box;display:flex;align-items:center;justify-content:center;padding:24px;background:#080808;color:#f5d77f;font-family:Arial,sans-serif;text-align:center';
  const box = document.createElement('div');
  box.style.cssText = 'max-width:640px;width:100%;padding:24px;border:1px solid #8b722f;border-radius:16px;background:#111';
  const heading = document.createElement('h2');
  heading.textContent = title;
  heading.style.cssText = 'font-size:20px;margin:0 0 14px';
  const message = document.createElement('pre');
  message.textContent = detail || 'لم يقدّم المتصفح تفاصيل إضافية.';
  message.dir = 'ltr';
  message.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;text-align:left;color:#eee;font:12px/1.7 monospace';
  box.append(heading, message);
  panel.append(box);
  rootElement.append(panel);
}

window.addEventListener('error', (event) => {
  showStartupError('تعذّر تشغيل التطبيق', event.message || event.error?.stack || 'خطأ JavaScript غير معروف');
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  showStartupError('حدث خطأ أثناء بدء التطبيق', reason?.stack || reason?.message || String(reason));
});

if (!rootElement) {
  document.body.textContent = 'خطأ: لم يتم العثور على عنصر التطبيق root.';
} else {
  const root = createRoot(rootElement);
  import('./App.tsx')
    .then(({ default: App }) => root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    ))
    .catch((error: unknown) => {
      const detail = error instanceof Error ? (error.stack || error.message) : String(error);
      showStartupError('فشل تحميل مكوّنات التطبيق', detail);
    });
}
