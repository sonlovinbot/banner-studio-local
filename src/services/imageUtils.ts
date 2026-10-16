import { LibraryImage, UploadedImage } from '../types';

export function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Resizes (preserving aspect ratio) and re-encodes as JPEG so library entries fit in localStorage.
export async function compressForLibrary(
  file: File,
  maxDimension = 1280,
  quality = 0.82
): Promise<{ base64: string; mimeType: string }> {
  const dataUrl = await readFileAsDataURL(file);
  try {
    const img = await loadImage(dataUrl);
    const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { base64: dataUrl, mimeType: file.type };
    ctx.drawImage(img, 0, 0, w, h);
    const out = canvas.toDataURL('image/jpeg', quality);
    return { base64: out, mimeType: 'image/jpeg' };
  } catch {
    return { base64: dataUrl, mimeType: file.type };
  }
}

export function extractImageFiles(items: DataTransferItemList | DataTransferItem[] | null | undefined): File[] {
  if (!items) return [];
  const out: File[] = [];
  for (const item of items as any) {
    if (item.kind === 'file') {
      const f = item.getAsFile();
      if (f && f.type.startsWith('image/')) out.push(f);
    }
  }
  return out;
}

export function filesToFileList(files: File[]): FileList {
  const dt = new DataTransfer();
  files.forEach(f => dt.items.add(f));
  return dt.files;
}

// Reads images directly from the OS clipboard via the Async Clipboard API.
// Requires HTTPS or localhost + user gesture. Browser may prompt for permission
// the first time. Returns [] silently on denial / no images.
export async function readImagesFromClipboard(): Promise<File[]> {
  try {
    if (!navigator.clipboard || !('read' in navigator.clipboard)) return [];
    const items = await navigator.clipboard.read();
    const out: File[] = [];
    for (const item of items) {
      for (const type of item.types) {
        if (type.startsWith('image/')) {
          const blob = await item.getType(type);
          const ext = (type.split('/')[1] || 'png').replace('jpeg', 'jpg');
          out.push(new File([blob], `pasted-${Date.now()}.${ext}`, { type }));
        }
      }
    }
    return out;
  } catch (e) {
    console.warn('Clipboard read failed', e);
    return [];
  }
}

// Compress an image (data URL or File) for upload to storage local via Vercel Edge
// function. Vercel limits request body to 4.5MB Hobby / 10MB Pro, so we
// down-scale to maxDimension and re-encode as JPEG. Returns a Blob safe to
// PUT in a multipart request.
export async function compressForUpload(
  source: string | File | Blob,
  maxDimension = 1920,
  quality = 0.88,
): Promise<{ blob: Blob; mimeType: string; dataUrl: string; width: number; height: number }> {
  let dataUrl: string;
  if (typeof source === 'string') {
    dataUrl = source;
  } else {
    dataUrl = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result as string);
      r.onerror = rej;
      r.readAsDataURL(source);
    });
  }

  const img = await loadImage(dataUrl);
  const naturalW = img.naturalWidth || img.width;
  const naturalH = img.naturalHeight || img.height;
  const scale = Math.min(1, maxDimension / Math.max(naturalW, naturalH));
  const w = Math.max(1, Math.round(naturalW * scale));
  const h = Math.max(1, Math.round(naturalH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable');
  // White background so JPEG doesn't get black transparent areas
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  const outDataUrl = canvas.toDataURL('image/jpeg', quality);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob null'))), 'image/jpeg', quality),
  );
  return { blob, mimeType: 'image/jpeg', dataUrl: outDataUrl, width: w, height: h };
}

export async function fileToUploadedImage(file: File): Promise<UploadedImage> {
  const base64 = await readFileAsDataURL(file);
  return {
    id: Math.random().toString(36).substring(7),
    url: base64,
    file,
    base64,
    mimeType: file.type || 'image/png',
  };
}

// Re-encode any source (data URL or http URL) to a clean PNG File.
// Guarantees: filename ends in .png, MIME is image/png, bytes are a valid PNG.
// Eliminates 415 from upstreams that sniff bytes vs declared MIME.
async function reencodeAsPng(srcDataUrl: string, fileName: string): Promise<{ file: File; dataUrl: string; mimeType: string }> {
  const img = await loadImage(srcDataUrl);
  const w = Math.max(1, img.naturalWidth || img.width);
  const h = Math.max(1, img.naturalHeight || img.height);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.drawImage(img, 0, 0, w, h);
  const pngDataUrl = canvas.toDataURL('image/png');
  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Canvas toBlob returned null'))), 'image/png');
  });
  const safeName = (fileName.replace(/\.[a-zA-Z0-9]+$/, '') || 'image') + '.png';
  const file = new File([blob], safeName, { type: 'image/png' });
  return { file, dataUrl: pngDataUrl, mimeType: 'image/png' };
}

export async function dataUrlOrUrlToUploadedImage(
  src: string,
  fileName = 'voted-banner.png',
): Promise<UploadedImage | null> {
  try {
    let dataUrl = src;
    if (!src.startsWith('data:')) {
      const res = await fetch(src);
      const blob = await res.blob();
      dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = reject;
        r.readAsDataURL(blob);
      });
    }

    // Re-encode via canvas to guarantee a clean PNG payload that upstream
    // image APIs (e.g. Coachio) will accept without 415 surprises.
    try {
      const { file, dataUrl: pngDataUrl, mimeType } = await reencodeAsPng(dataUrl, fileName);
      return {
        id: Math.random().toString(36).substring(7),
        url: pngDataUrl,
        file,
        base64: pngDataUrl,
        mimeType,
      };
    } catch (e) {
      // Fall back to raw blob if canvas re-encoding fails (e.g. tainted canvas).
      console.warn('reencodeAsPng failed, falling back to raw blob', e);
      const blob = dataURLToBlob(dataUrl);
      const mimeType = blob.type || 'image/png';
      const safeName = (fileName.replace(/\.[a-zA-Z0-9]+$/, '') || 'image') + '.png';
      const file = new File([blob], safeName, { type: mimeType });
      return {
        id: Math.random().toString(36).substring(7),
        url: dataUrl,
        file,
        base64: dataUrl,
        mimeType,
      };
    }
  } catch (e) {
    console.warn('dataUrlOrUrlToUploadedImage failed', e);
    return null;
  }
}

function dataURLToBlob(dataUrl: string): Blob {
  const [header, payload] = dataUrl.split(',');
  const mime = /data:(.*?);base64/.exec(header)?.[1] || 'image/png';
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function libraryItemToUploadedImage(item: LibraryImage): UploadedImage {
  if (!item.base64) {
    throw new Error('libraryItemToUploadedImage requires base64; use libraryItemToUploadedImageAsync for url-only items');
  }
  const blob = dataURLToBlob(item.base64);
  const file = new File([blob], item.fileName || `library-${item.id}.jpg`, { type: item.mimeType || blob.type });
  return {
    id: Math.random().toString(36).substring(7),
    url: item.base64,
    file,
    base64: item.base64,
    mimeType: item.mimeType || file.type,
  };
}

/** Same but works for cloud library items that only have a storage local URL.
 *  Fetches the image, converts to UploadedImage with base64 (needed for Gemini inlineData). */
export async function libraryItemToUploadedImageAsync(item: LibraryImage): Promise<UploadedImage> {
  if (item.base64) return libraryItemToUploadedImage(item);
  if (!item.url) throw new Error('Library item has no base64 or url');
  const res = await fetch(item.url);
  const blob = await res.blob();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
  const mimeType = blob.type || item.mimeType || 'image/jpeg';
  const file = new File([blob], item.fileName || `library-${item.id}.jpg`, { type: mimeType });
  return {
    id: Math.random().toString(36).substring(7),
    url: dataUrl,
    file,
    base64: dataUrl,
    mimeType,
  };
}
