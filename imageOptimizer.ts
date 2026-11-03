/**
 * FC.FOUNOUN – Luxury Footwear
 * Image Optimizer & Full Client-Side Decoder
 *
 * Provides complete client-side image decoding, resizing, and clean re-encoding
 * to guarantee that:
 * 1. Corrupted, truncated, or exploit-bearing files are rejected by the browser's full decoder.
 * 2. Unsanitized metadata, EXIF profiles, or steganographic payloads are stripped via Canvas.
 * 3. Full Data URL strings (including MIME prefix 'data:image/...;base64,') strictly respect
 *    the 320,000 characters per image and 600,000 characters combined limits.
 */

export interface OptimizedImageResult {
  dataUrl: string;
  mimeType: 'image/webp' | 'image/jpeg';
  width: number;
  height: number;
  charCount: number; // Full dataUrl character count including MIME prefix
  estimatedBytes: number;
}

export interface OptimizationOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number; // 0.1 to 1.0
  format?: 'image/webp' | 'image/jpeg';
  maxChars?: number; // Max characters for entire Data URL
}

export const MAX_IMAGE_CHARS = 320000;
export const MAX_COMBINED_CHARS = 600000;
export const DEFAULT_MAX_DIMENSION = 750;

/**
 * Checks if two optimized images together stay under the combined limit.
 * Evaluates the full Data URL length including the MIME prefix.
 */
export function validateDualImageLimits(
  image1Chars: number,
  image2Chars: number
): { valid: boolean; totalChars: number; error?: string } {
  const totalChars = image1Chars + image2Chars;
  if (image1Chars > MAX_IMAGE_CHARS) {
    return {
      valid: false,
      totalChars,
      error: `الصورة الأولى تجاوزت الحد الأقصى المسموح (${image1Chars.toLocaleString('ar-EG')} من ${MAX_IMAGE_CHARS.toLocaleString('ar-EG')} محرف يشمل ترويسة الترميز)`,
    };
  }
  if (image2Chars > MAX_IMAGE_CHARS) {
    return {
      valid: false,
      totalChars,
      error: `الصورة الثانية تجاوزت الحد الأقصى المسموح (${image2Chars.toLocaleString('ar-EG')} من ${MAX_IMAGE_CHARS.toLocaleString('ar-EG')} محرف يشمل ترويسة الترميز)`,
    };
  }
  if (totalChars > MAX_COMBINED_CHARS) {
    return {
      valid: false,
      totalChars,
      error: `المجموع الكلي للصورتين (${totalChars.toLocaleString('ar-EG')} محرف) يتجاوز الحد الأقصى المعتمد (${MAX_COMBINED_CHARS.toLocaleString('ar-EG')} محرف)`,
    };
  }
  return { valid: true, totalChars };
}

/**
 * Reads a File or Blob, fully decodes it via the browser rendering engine,
 * scales it to a max bounding box, and re-encodes it into WebP or JPEG.
 * The character ceiling is strictly enforced on the FULL dataUrl string.
 */
export async function optimizeAndEncodeImage(
  file: File | Blob,
  options: OptimizationOptions = {}
): Promise<OptimizedImageResult> {
  const maxWidth = options.maxWidth ?? DEFAULT_MAX_DIMENSION;
  const maxHeight = options.maxHeight ?? DEFAULT_MAX_DIMENSION;
  const preferredFormat = options.format ?? 'image/webp';
  const maxChars = options.maxChars ?? MAX_IMAGE_CHARS;
  let quality = options.quality ?? 0.85;

  // Step 1: Full decode using ImageBitmap or Image element
  let sourceWidth = 0;
  let sourceHeight = 0;
  let canvasSource: CanvasImageSource;

  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      sourceWidth = bitmap.width;
      sourceHeight = bitmap.height;
      canvasSource = bitmap;
    } catch {
      const img = await loadHtmlImage(file);
      sourceWidth = img.naturalWidth || img.width;
      sourceHeight = img.naturalHeight || img.height;
      canvasSource = img;
    }
  } else {
    const img = await loadHtmlImage(file);
    sourceWidth = img.naturalWidth || img.width;
    sourceHeight = img.naturalHeight || img.height;
    canvasSource = img;
  }

  if (sourceWidth === 0 || sourceHeight === 0) {
    throw new Error('فشل فك الصورة: أبعاد الصورة غير صالحة أو الملف تالف.');
  }

  // Step 2: Compute scaled dimensions preserving aspect ratio
  let targetWidth = sourceWidth;
  let targetHeight = sourceHeight;

  if (targetWidth > maxWidth || targetHeight > maxHeight) {
    const ratio = Math.min(maxWidth / targetWidth, maxHeight / targetHeight);
    targetWidth = Math.round(targetWidth * ratio);
    targetHeight = Math.round(targetHeight * ratio);
  }

  // Step 3: Draw on canvas to strip arbitrary payloads and re-encode
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: false });

  if (!ctx) {
    throw new Error('تعذر إنشاء سياق الرسم ثنائي الأبعاد (Canvas 2D Context).');
  }

  // Fill white background for transparent PNG/WebP if exported as JPEG
  if (preferredFormat === 'image/jpeg') {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, targetWidth, targetHeight);
  }

  ctx.drawImage(canvasSource, 0, 0, targetWidth, targetHeight);

  // If source was ImageBitmap, close it to free GPU memory
  if ('close' in canvasSource && typeof canvasSource.close === 'function') {
    canvasSource.close();
  }

  // Step 4: Iterative compression loop to ensure strict character bounds on FULL dataUrl
  let mimeType: 'image/webp' | 'image/jpeg' = preferredFormat;
  let dataUrl = canvas.toDataURL(mimeType, quality);

  // Fallback to JPEG if browser gave back PNG
  if (preferredFormat === 'image/webp' && !dataUrl.startsWith('data:image/webp')) {
    mimeType = 'image/jpeg';
    dataUrl = canvas.toDataURL(mimeType, quality);
  }

  // Check FULL dataUrl length against maxChars (including 'data:image/...;base64,')
  while (dataUrl.length > maxChars && quality > 0.3) {
    quality -= 0.1;
    dataUrl = canvas.toDataURL(mimeType, quality);
  }

  if (dataUrl.length > maxChars) {
    // If still oversized, reduce canvas dimensions by 20% and retry
    const scaledCanvas = document.createElement('canvas');
    scaledCanvas.width = Math.round(targetWidth * 0.8);
    scaledCanvas.height = Math.round(targetHeight * 0.8);
    const scaledCtx = scaledCanvas.getContext('2d');
    if (scaledCtx) {
      if (mimeType === 'image/jpeg') {
        scaledCtx.fillStyle = '#FFFFFF';
        scaledCtx.fillRect(0, 0, scaledCanvas.width, scaledCanvas.height);
      }
      scaledCtx.drawImage(canvas, 0, 0, scaledCanvas.width, scaledCanvas.height);
      dataUrl = scaledCanvas.toDataURL(mimeType, 0.75);
    }
  }

  if (dataUrl.length > maxChars) {
    throw new Error(
      `حجم الصورة بالكامل (${dataUrl.length.toLocaleString('ar-EG')} محرف) يتجاوز الحد الأقصى المسموح (${maxChars.toLocaleString('ar-EG')} محرف شاملاً بادئة الترميز). يرجى اختيار صورة أصغر.`
    );
  }

  return {
    dataUrl,
    mimeType,
    width: targetWidth,
    height: targetHeight,
    charCount: dataUrl.length,
    estimatedBytes: Math.round(dataUrl.length * 0.75),
  };
}

/**
 * Helper to load an image via standard HTMLImageElement with error handling.
 */
function loadHtmlImage(file: File | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('فشل فك الصورة: الملف تالف أو لا يتطابق مع التنسيقات المدعومة.'));
    };
    img.src = url;
  });
}
