import React, { useEffect, useRef, useState } from 'react';

interface Props {
  reportId: string;
  loadPhoto: (id: string) => Promise<{ data: { id: string; photo: string } }>;
  onOpen: (photo: { id: string; photo: string }) => void;
  alt?: string;
}

/** Fetches a report photo only when its card approaches the viewport. */
export const CycleReportPhoto: React.FC<Props> = ({ reportId, loadPhoto, onOpen, alt = 'صورة عداد المكينة' }) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || photo || error) return;
    let active = true;
    let requested = false;
    const fetchPhoto = async () => {
      if (requested) return;
      requested = true;
      try {
        const result = await loadPhoto(reportId);
        if (active && result?.data?.photo) setPhoto(result.data.photo);
        else if (active) setError(true);
      } catch {
        if (active) setError(true);
      }
    };
    if (typeof IntersectionObserver === 'undefined') {
      void fetchPhoto();
      return () => { active = false; };
    }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        observer.disconnect();
        void fetchPhoto();
      }
    }, { rootMargin: '220px 0px' });
    observer.observe(host);
    return () => { active = false; observer.disconnect(); };
  }, [reportId, loadPhoto, photo, error]);

  return <div ref={hostRef} className="mt-3 min-h-24 overflow-hidden rounded-lg border border-white/10 bg-black/40">
    {photo
      ? <button type="button" className="block w-full" onClick={() => onOpen({ id: reportId, photo })} aria-label="تكبير صورة العداد">
          <img src={photo} alt={alt} loading="lazy" decoding="async" className="max-h-64 w-full object-contain" />
        </button>
      : <p className="p-3 text-center text-xs text-gray-500">{error ? 'تعذر تحميل صورة العداد' : 'جارٍ تحميل صورة العداد عند ظهور التقرير...'}</p>}
  </div>;
};
