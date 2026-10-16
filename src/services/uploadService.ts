// Upload file lên server local (thay cho storage local / Cloudflare R2 ở bản cloud).
//
// Server local ghi file vào ./data/uploads/<folder>/ rồi trả URL /files/...
// Không có giới hạn 4.5MB như Vercel, nhưng vẫn nén ảnh lớn để ổ đĩa đỡ phình
// và trình duyệt tải nhanh.

import { compressForUpload } from './imageUtils';

export type StorageFolder = 'banners' | 'refs' | 'products' | 'face' | 'logo' | 'videos' | 'misc';

export interface UploadResult {
  url: string;   // URL công khai do server local trả về, vd /files/banners/abc.jpg
  path: string;  // đường dẫn tương đối trong ./data/uploads
  size: number;
  mime: string;
}

/** Ảnh lớn hơn ngưỡng này thì nén trước khi gửi. */
const COMPRESS_TARGET = 1_500_000;
/** Chặn file quá lớn để không vô tình nhồi cả file 1GB vào ./data. */
const MAX_UPLOAD = 100_000_000;

export async function uploadToStorage(file: File, folder: StorageFolder = 'misc'): Promise<UploadResult> {
  let toSend: File | Blob = file;
  let sendName = file.name;
  let sendType = file.type;

  if (file.type.startsWith('image/') && file.size > COMPRESS_TARGET) {
    try {
      const { blob, mimeType } = await compressForUpload(file, 1920, 0.88);
      console.info(`[upload] nén ảnh ${file.size} -> ${blob.size} bytes`);
      toSend = blob;
      sendType = mimeType;
      sendName = file.name.replace(/\.[a-zA-Z0-9]+$/, '') + '.jpg';
    } catch (e) {
      console.warn('[upload] nén thất bại, gửi file gốc', e);
    }
  }

  if (toSend.size > MAX_UPLOAD) {
    throw new Error(`File quá lớn (${(toSend.size / 1024 / 1024).toFixed(1)}MB). Giới hạn 100MB.`);
  }

  const fd = new FormData();
  fd.append('file', toSend instanceof File ? toSend : new File([toSend], sendName, { type: sendType }));
  fd.append('folder', folder);

  const res = await fetch('/api/upload', { method: 'POST', body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('[upload] thất bại', res.status, data);
    throw new Error(data?.error || `Upload thất bại (${res.status})`);
  }
  return data as UploadResult;
}

/** Ảnh model trả về thường là data URL — nén rồi upload. */
export async function uploadDataUrlToStorage(
  dataUrl: string,
  fileName: string,
  folder: StorageFolder = 'banners',
): Promise<UploadResult> {
  try {
    const { blob, mimeType } = await compressForUpload(dataUrl, 1920, 0.88);
    const file = new File([blob], fileName.replace(/\.\w+$/, '') + '.jpg', { type: mimeType });
    return uploadToStorage(file, folder);
  } catch (e) {
    console.warn('[upload] nén data URL thất bại, gửi nguyên bản', e);
    const blob = await (await fetch(dataUrl)).blob();
    const file = new File([blob], fileName, { type: blob.type || 'image/png' });
    return uploadToStorage(file, folder);
  }
}
