/**
 * FC.FOUNOUN – Luxury Footwear
 * Model Name Normalization & SHA-256 Key Derivation
 *
 * Rules:
 * 1. Normalizes casing and whitespace only (trim, collapse internal repeated spaces, toLowerCase).
 * 2. Does NOT apply Unicode NFKC (to avoid mutating distinct character forms).
 * 3. Does NOT strip Arabic diacritics (Tashkeel) or Tatweel (Kashida).
 * 4. Browser-safe: Uses standard Web Crypto API (crypto.subtle) without Node.js dependencies.
 */

export interface NormalizedNameResult {
  original: string;
  normalized: string;
  hash: string;
}

/**
 * Normalizes a shoe model name:
 * - Trims leading and trailing whitespace
 * - Collapses internal whitespace sequences into a single space
 * - Converts to lowercase for case-insensitivity
 * - Computes SHA-256 using standard Web Crypto API
 */
export async function normalizeModelName(rawName: string): Promise<NormalizedNameResult> {
  if (!rawName || typeof rawName !== 'string') {
    throw new Error('اسم الموديل فارغ أو غير صالح.');
  }

  const original = rawName.trim();
  if (original.length < 2 || original.length > 60) {
    throw new Error('طول اسم الموديل يجب أن يكون بين 2 و 60 حرفاً.');
  }

  // 1. Collapse internal whitespace into a single ASCII space and trim
  let canonical = original.replace(/\s+/g, ' ').trim();

  // 2. Lowercase (case-insensitivity only, without NFKC)
  canonical = canonical.toLowerCase();

  if (canonical.length < 2) {
    throw new Error('الاسم المطبّع قصير جداً بعد التنظيف.');
  }

  // 3. Compute SHA-256 via standard Web Crypto API
  const hash = await computeWebCryptoSha256(canonical);

  return { original, normalized: canonical, hash };
}

/**
 * Computes SHA-256 hex string using standard Web Crypto API.
 * Natively supported in all modern browsers, Cloudflare Workers, and Node.js.
 */
export async function computeWebCryptoSha256(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
