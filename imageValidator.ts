/**
 * FC.FOUNOUN – Luxury Footwear
 * Image & Document Strict Validators
 *
 * Provides:
 * 1. Strict RFC 4648 Base64 validator with unused bits verification.
 * 2. Strict WebP RIFF stream validator with chunk alignment and dimension extraction.
 * 3. Strict JPEG segment boundary validator with SOI/EOI and dimension extraction.
 * 4. Conservative Firestore document size calculator matching original fields.
 */

// ==========================================
// 1. Strict Base64 RFC 4648 Validator
// ==========================================
export interface Base64ValidationResult {
  valid: boolean;
  byteLength: number;
  error?: string;
}

export function validateStrictBase64(base64: string): Base64ValidationResult {
  if (typeof base64 !== 'string' || base64.length === 0) {
    return { valid: false, byteLength: 0, error: 'سلسلة Base64 فارغة' };
  }

  if (base64.length % 4 !== 0) {
    return { valid: false, byteLength: 0, error: 'طول Base64 يجب أن يكون مضاعفاً للرقم 4' };
  }

  // Check character set: only A-Z, a-z, 0-9, +, /, and = at end
  const b64Regex = /^[A-Za-z0-9+/]+={0,2}$/;
  if (!b64Regex.test(base64)) {
    return { valid: false, byteLength: 0, error: 'أحرف غير صالحة في سلسلة Base64' };
  }

  // Padding validation
  let padCount = 0;
  if (base64.endsWith('==')) {
    padCount = 2;
  } else if (base64.endsWith('=')) {
    padCount = 1;
  }

  // Ensure '=' does not appear elsewhere
  if (base64.slice(0, base64.length - padCount).includes('=')) {
    return { valid: false, byteLength: 0, error: 'حشو غير صحيح داخل سلسلة Base64' };
  }

  // RFC 4648 Section 3.5: Verify unused bits are strictly zero
  const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lastQuartet = base64.slice(-4);

  if (padCount === 2) {
    const val1 = B64_CHARS.indexOf(lastQuartet[1]);
    if (val1 < 0 || (val1 & 0x0f) !== 0) {
      return { valid: false, byteLength: 0, error: 'البتات غير المستخدمة في حشو Base64 ليست أصفاراً' };
    }
  } else if (padCount === 1) {
    const val2 = B64_CHARS.indexOf(lastQuartet[2]);
    if (val2 < 0 || (val2 & 0x03) !== 0) {
      return { valid: false, byteLength: 0, error: 'البتات غير المستخدمة في حشو Base64 ليست أصفاراً' };
    }
  }

  const rawBytes = (base64.length / 4) * 3 - padCount;
  return { valid: true, byteLength: rawBytes };
}

// ==========================================
// 2. Strict WebP RIFF Validator & Dimension Extractor
// ==========================================
export interface WebPValidationResult {
  valid: boolean;
  format: 'VP8' | 'VP8L' | 'VP8X';
  width: number;
  height: number;
  riffSize: number;
  totalLength: number;
  error?: string;
}

export function validateStrictWebP(buffer: Uint8Array): WebPValidationResult {
  if (buffer.length < 12) {
    return { valid: false, format: 'VP8', width: 0, height: 0, riffSize: 0, totalLength: buffer.length, error: 'حجم الملف أصغر من ترويسة RIFF' };
  }

  const readAscii = (buf: Uint8Array, start: number, end: number) => {
    let str = '';
    for (let i = start; i < end; i++) str += String.fromCharCode(buf[i]);
    return str;
  };

  const readUInt32LE = (buf: Uint8Array, offset: number) => {
    return (
      buf[offset] |
      (buf[offset + 1] << 8) |
      (buf[offset + 2] << 16) |
      ((buf[offset + 3] << 24) >>> 0)
    );
  };

  // 1. Signature 'RIFF'
  if (readAscii(buffer, 0, 4) !== 'RIFF') {
    return { valid: false, format: 'VP8', width: 0, height: 0, riffSize: 0, totalLength: buffer.length, error: 'توقيع RIFF غير موجود' };
  }

  // 2. Declared RIFF payload size (uint32 LE)
  const riffPayloadSize = readUInt32LE(buffer, 4);
  const expectedTotalSize = riffPayloadSize + 8;

  // Exact file length match: file MUST equal riffPayloadSize + 8
  if (buffer.length !== expectedTotalSize) {
    return {
      valid: false,
      format: 'VP8',
      width: 0,
      height: 0,
      riffSize: riffPayloadSize,
      totalLength: buffer.length,
      error: `عدم تطابق حجم RIFF المعلن (${expectedTotalSize} بايت) مع حجم الملف الفعلي (${buffer.length} بايت)`,
    };
  }

  // 3. FourCC 'WEBP'
  if (readAscii(buffer, 8, 12) !== 'WEBP') {
    return { valid: false, format: 'VP8', width: 0, height: 0, riffSize: riffPayloadSize, totalLength: buffer.length, error: 'توقيع WEBP غير موجود' };
  }

  // 4. Iterate over chunks; sum must reach expectedTotalSize exactly
  let offset = 12;
  let primaryFormat: 'VP8' | 'VP8L' | 'VP8X' | null = null;
  let extractedWidth = 0;
  let extractedHeight = 0;

  while (offset < buffer.length) {
    if (offset + 8 > buffer.length) {
      return {
        valid: false,
        format: 'VP8',
        width: 0,
        height: 0,
        riffSize: riffPayloadSize,
        totalLength: buffer.length,
        error: `بيانات ترويسة المقطع مبتورة عند الإزاحة ${offset}`,
      };
    }

    const chunkFourCC = readAscii(buffer, offset, offset + 4);
    const chunkSize = readUInt32LE(buffer, offset + 4);
    const chunkDataOffset = offset + 8;
    const paddedChunkSize = chunkSize + (chunkSize % 2); // RIFF requires 2-byte alignment

    if (chunkDataOffset + chunkSize > buffer.length) {
      return {
        valid: false,
        format: 'VP8',
        width: 0,
        height: 0,
        riffSize: riffPayloadSize,
        totalLength: buffer.length,
        error: `حجم المقطع ${chunkFourCC} (${chunkSize} بايت) يتجاوز نهاية الملف`,
      };
    }

    // Dimension extraction based on Chunk type
    if (chunkFourCC === 'VP8 ' && !primaryFormat) {
      primaryFormat = 'VP8';
      if (chunkSize >= 10) {
        if (
          buffer[chunkDataOffset + 3] === 0x9d &&
          buffer[chunkDataOffset + 4] === 0x01 &&
          buffer[chunkDataOffset + 5] === 0x2a
        ) {
          extractedWidth = (buffer[chunkDataOffset + 6] | (buffer[chunkDataOffset + 7] << 8)) & 0x3fff;
          extractedHeight = (buffer[chunkDataOffset + 8] | (buffer[chunkDataOffset + 9] << 8)) & 0x3fff;
        }
      }
    } else if (chunkFourCC === 'VP8L' && !primaryFormat) {
      primaryFormat = 'VP8L';
      if (chunkSize >= 5 && buffer[chunkDataOffset] === 0x2f) {
        const b1 = buffer[chunkDataOffset + 1];
        const b2 = buffer[chunkDataOffset + 2];
        const b3 = buffer[chunkDataOffset + 3];
        const b4 = buffer[chunkDataOffset + 4];

        extractedWidth = 1 + (((b2 & 0x3f) << 8) | b1);
        extractedHeight = 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6));
      }
    } else if (chunkFourCC === 'VP8X' && !primaryFormat) {
      primaryFormat = 'VP8X';
      if (chunkSize >= 10) {
        extractedWidth = 1 + (buffer[chunkDataOffset + 4] | (buffer[chunkDataOffset + 5] << 8) | (buffer[chunkDataOffset + 6] << 16));
        extractedHeight = 1 + (buffer[chunkDataOffset + 7] | (buffer[chunkDataOffset + 8] << 8) | (buffer[chunkDataOffset + 9] << 16));
      }
    }

    offset = chunkDataOffset + paddedChunkSize;
  }

  // 5. Stream termination check: chunks must end EXACTLY at buffer.length
  if (offset !== buffer.length) {
    return {
      valid: false,
      format: primaryFormat || 'VP8',
      width: extractedWidth,
      height: extractedHeight,
      riffSize: riffPayloadSize,
      totalLength: buffer.length,
      error: `نهاية المقاطع (${offset}) لا تتطابق تماماً مع نهاية الملف المعنون (${buffer.length})`,
    };
  }

  if (!primaryFormat) {
    return {
      valid: false,
      format: 'VP8',
      width: 0,
      height: 0,
      riffSize: riffPayloadSize,
      totalLength: buffer.length,
      error: 'لم يتم العثور على مقطع بيانات صالح (VP8 أو VP8L أو VP8X)',
    };
  }

  if (extractedWidth <= 0 || extractedHeight <= 0 || extractedWidth > 4096 || extractedHeight > 4096) {
    return {
      valid: false,
      format: primaryFormat,
      width: extractedWidth,
      height: extractedHeight,
      riffSize: riffPayloadSize,
      totalLength: buffer.length,
      error: `أبعاد الصورة غير صالحة (${extractedWidth}x${extractedHeight})`,
    };
  }

  return {
    valid: true,
    format: primaryFormat,
    width: extractedWidth,
    height: extractedHeight,
    riffSize: riffPayloadSize,
    totalLength: buffer.length,
  };
}

// ==========================================
// 3. Strict JPEG Segment Validator & Dimension Extractor
// ==========================================
export interface JpegValidationResult {
  valid: boolean;
  width: number;
  height: number;
  error?: string;
}

export function validateStrictJpeg(buffer: Uint8Array): JpegValidationResult {
  if (buffer.length < 4) {
    return { valid: false, width: 0, height: 0, error: 'الملف أصغر من ترويسة JPEG' };
  }

  const readUInt16BE = (buf: Uint8Array, offset: number) => {
    return (buf[offset] << 8) | buf[offset + 1];
  };

  // 1. Check SOI: 0xFF, 0xD8
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return { valid: false, width: 0, height: 0, error: 'توقيع بداية JPEG (SOI) غير صحيح' };
  }

  let offset = 2;
  let width = 0;
  let height = 0;
  let foundSof = false;

  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) {
      return { valid: false, width, height, error: `بايت علامة غير صالح عند الإزاحة ${offset}` };
    }

    const marker = buffer[offset + 1];

    // EOI marker (0xD9)
    if (marker === 0xd9) {
      if (offset + 2 !== buffer.length) {
        return { valid: false, width, height, error: 'توجد بيانات زائدة بعد علامة EOI' };
      }
      break;
    }

    // Skip fill bytes (0xFF 0xFF)
    if (marker === 0xff) {
      offset += 1;
      continue;
    }

    // Markers without payload: RST0-RST7 (0xD0-0xD7), TEM (0x01)
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      offset += 2;
      continue;
    }

    // Other markers have length (uint16 BE)
    if (offset + 4 > buffer.length) {
      return { valid: false, width, height, error: 'ترويسة المقطع مبتورة' };
    }

    const segmentLength = readUInt16BE(buffer, offset + 2);
    if (segmentLength < 2 || offset + 2 + segmentLength > buffer.length) {
      return { valid: false, width, height, error: 'طول المقطع غير صالح أو يتجاوز نهاية الملف' };
    }

    // SOF markers: SOF0 (0xC0), SOF1 (0xC1), SOF2 (0xC2), SOF3 (0xC3)
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2 || marker === 0xc3) {
      foundSof = true;
      if (segmentLength >= 7) {
        height = readUInt16BE(buffer, offset + 5);
        width = readUInt16BE(buffer, offset + 7);
      }
    }

    // SOS (0xDA): Start of Scan
    if (marker === 0xda) {
      offset = offset + 2 + segmentLength;

      // Scan entropy encoded data until EOI marker
      let eoiIndex = -1;
      for (let i = offset; i < buffer.length - 1; i++) {
        if (buffer[i] === 0xff) {
          if (buffer[i + 1] === 0x00 || (buffer[i + 1] >= 0xd0 && buffer[i + 1] <= 0xd7)) {
            continue;
          }
          if (buffer[i + 1] === 0xd9) {
            eoiIndex = i;
            break;
          }
        }
      }

      if (eoiIndex === -1) {
        return { valid: false, width, height, error: 'علامة نهاية JPEG (EOI) مفقودة' };
      }
      if (eoiIndex + 2 !== buffer.length) {
        return { valid: false, width, height, error: 'توجد بيانات زائدة غير مصرح بها بعد نهاية JPEG (EOI)' };
      }

      offset = buffer.length;
      break;
    }

    offset = offset + 2 + segmentLength;
  }

  if (!foundSof || width <= 0 || height <= 0 || width > 4096 || height > 4096) {
    return { valid: false, width, height, error: `فشل استخراج أبعاد صالحة من صورة JPEG (${width}x${height})` };
  }

  return { valid: true, width, height };
}

// ==========================================
// 4. Conservative Document Size Calculation
// ==========================================
export function calculateConservativeDocSize(doc: {
  id: string;
  name: string;
  name_hash: string;
  category: string;
  image1: string;
  image2: string;
  weightMg?: number;
  firstPositionMm?: number;
  lastPositionMm?: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}): { estimatedBytes: number; underSafeCeiling: boolean } {
  let bytes = 32;

  const encoder = new TextEncoder();

  const countString = (key: string, val?: string) => {
    if (!val) return;
    bytes += key.length + 1 + encoder.encode(val).length + 1;
  };

  const countNumber = (key: string, val?: number) => {
    if (val === undefined) return;
    bytes += key.length + 1 + 8;
  };

  countString('id', doc.id);
  countString('name', doc.name);
  countString('name_hash', doc.name_hash);
  countString('category', doc.category);
  countString('image1', doc.image1);
  countString('image2', doc.image2);
  countString('createdBy', doc.createdBy);
  countString('createdAt', doc.createdAt);
  countString('updatedAt', doc.updatedAt);
  countNumber('weightMg', doc.weightMg);
  countNumber('firstPositionMm', doc.firstPositionMm);
  countNumber('lastPositionMm', doc.lastPositionMm);

  // 15% safety buffer for Firestore internal indexing & metadata
  const totalWithBuffer = Math.ceil(bytes * 1.15);

  return {
    estimatedBytes: totalWithBuffer,
    underSafeCeiling: totalWithBuffer < 750 * 1024, // 750 KB conservative limit
  };
}
