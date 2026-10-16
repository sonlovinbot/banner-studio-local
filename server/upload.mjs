// POST /api/upload — nhận multipart, ghi file vào ./data/uploads/<folder>/
// rồi trả URL /files/... để app lưu vào DB như một URL bình thường.
//
// Bản cloud đẩy lên Bunny CDN / R2. Bản local ghi thẳng ra ổ đĩa: không cần
// tài khoản, không mất phí, và xoá project là xoá sạch dữ liệu.

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { UPLOAD_DIR } from './db/open.mjs';

const ALLOWED = new Set([
  'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'image/avif',
  'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/webm',
  'video/mp4', 'video/webm', 'video/quicktime',
]);

const EXT = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp',
  'image/gif': 'gif', 'image/avif': 'avif',
  'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/wav': 'wav', 'audio/webm': 'weba',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
};

const FOLDERS = new Set(['banners', 'refs', 'products', 'face', 'logo', 'videos', 'misc']);

/** Nhận diện file theo HÀNH VI, không theo `instanceof File`.
 *  FormData của mỗi runtime dựng File bằng class riêng của nó, nên
 *  `x instanceof File` trả false dù x đúng là file — lỗi này từng mất cả
 *  buổi để lần ra ở bản cloud. */
function isFileLike(v) {
  return !!v && typeof v === 'object'
    && typeof v.arrayBuffer === 'function'
    && typeof v.size === 'number'
    && typeof v.type === 'string';
}

/** Ghi một Buffer vào ./data/uploads/<folder>/ và trả metadata. Dùng cho cả
 *  upload từ trình duyệt và tải ảnh từ nhà cung cấp về. */
export async function saveBuffer(buf, mime, folderRaw = 'misc') {
  if (!ALLOWED.has(mime)) throw new Error(`Định dạng không cho phép: ${mime || 'không rõ'}`);
  const folder = FOLDERS.has(folderRaw) ? folderRaw : 'misc';
  const name = `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}.${EXT[mime] || 'bin'}`;
  const relPath = `${folder}/${name}`;
  await mkdir(join(UPLOAD_DIR, folder), { recursive: true });
  await writeFile(join(UPLOAD_DIR, relPath), buf);
  return { url: `/files/${relPath}`, path: relPath, size: buf.length, mime };
}

export async function handleUpload(req, res) {
  const json = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  if (req.method !== 'POST') return json(405, { error: 'Chỉ nhận POST' });

  let form;
  try {
    // Dựng lại Request của WHATWG để dùng bộ parse multipart có sẵn của Node.
    form = await new Response(req.rawBody, {
      headers: { 'content-type': req.headers['content-type'] || '' },
    }).formData();
  } catch (e) {
    return json(400, { error: `Không đọc được multipart: ${e.message}` });
  }

  const file = form.get('file');
  if (!isFileLike(file)) {
    return json(400, {
      error: 'Thiếu field "file"',
      hint: `Các field nhận được: ${[...form.keys()].join(', ') || '(không có)'}`,
    });
  }

  try {
    const saved = await saveBuffer(
      Buffer.from(await file.arrayBuffer()),
      file.type || 'application/octet-stream',
      form.get('folder'),
    );
    return json(200, saved);
  } catch (e) {
    return json(400, { error: e.message });
  }
}
