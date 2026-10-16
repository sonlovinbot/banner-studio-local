#!/usr/bin/env node
// Server local của Banner Studio.
//
// Gom 4 việc vào một tiến trình, không cần Docker, không cần dịch vụ cloud:
//   /rest/v1/*   giao thức PostgREST trên SQLite  -> `supabase-js` chạy nguyên bản
//   /auth/v1/*   GoTrue tối giản, một người dùng   -> app không phải bỏ phần đăng nhập
//   /api/*       upload, lưu API key, Firecrawl, KIE
//   /files/*     ảnh/video đã upload trong ./data/uploads
//   /            giao diện đã build trong ./dist (nếu đã `npm run build`)
//
// Chạy: node server/index.mjs     (hoặc `npm run server`)

// Nạp .env.local đầu tiên: PORT và các API key phải có sẵn trước khi những
// module dưới đây đọc process.env.
import { loadEnv } from './env.mjs';
loadEnv();

import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { handleRest } from './rest.mjs';
import { handleAuth } from './auth.mjs';
import { handleApi } from './apiRoutes.mjs';
import { handleUpload } from './upload.mjs';
import { getDb, UPLOAD_DIR, PROJECT_ROOT, DB_PATH } from './db/open.mjs';

const PORT = Number(process.env.PORT || 5174);
const DIST_DIR = join(PROJECT_ROOT, 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.woff2': 'font/woff2',
};

/** Gom body thành Buffer. Giữ cả dạng thô (cho multipart) và JSON đã parse. */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    req.on('data', (c) => {
      bytes += c.length;
      // 200MB: đủ cho video, mà vẫn chặn trường hợp gửi vô hạn.
      if (bytes > 200 * 1024 * 1024) {
        reject(new Error('Body quá lớn (>200MB)'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Chặn path traversal: ../../ ra ngoài thư mục được phép. */
function safeJoin(root, unsafe) {
  const target = normalize(join(root, decodeURIComponent(unsafe)));
  return target.startsWith(normalize(root)) ? target : null;
}

function serveFile(res, path) {
  if (!path || !existsSync(path) || !statSync(path).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Không tìm thấy file');
  }
  res.writeHead(200, {
    'Content-Type': MIME[extname(path).toLowerCase()] || 'application/octet-stream',
    'Content-Length': statSync(path).size,
  });
  createReadStream(path).pipe(res);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Vite dev chạy ở port khác nên mọi request qua đây là cross-origin.
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers',
    'authorization, apikey, content-type, prefer, range, accept, accept-profile, content-profile, x-client-info');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, HEAD, OPTIONS');
  // Không expose Content-Range thì supabase-js không đọc được tổng số hàng,
  // và mọi chỗ phân trang sẽ hiện "0 kết quả" dù dữ liệu vẫn về.
  res.setHeader('Access-Control-Expose-Headers', 'content-range, content-length');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  try {
    const needsBody = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method);
    if (needsBody) {
      req.rawBody = await readBody(req);
      const ct = (req.headers['content-type'] || '').toString();
      if (ct.includes('application/json') && req.rawBody.length) {
        try { req.jsonBody = JSON.parse(req.rawBody.toString('utf8')); }
        catch { req.jsonBody = undefined; }
      }
    }

    const p = url.pathname;

    if (p.startsWith('/rest/v1/'))  return handleRest(req, res, url);
    if (p.startsWith('/auth/v1'))   return handleAuth(req, res, url);
    if (p === '/api/upload')        return handleUpload(req, res);
    if (p.startsWith('/api/'))      return handleApi(req, res, url);

    if (p.startsWith('/files/')) {
      return serveFile(res, safeJoin(UPLOAD_DIR, p.slice('/files/'.length)));
    }

    if (p === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, db: DB_PATH }));
    }

    // Giao diện đã build. Chưa build thì nói rõ phải làm gì, đừng trả 404 trơ.
    if (!existsSync(DIST_DIR)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`<!doctype html><meta charset="utf-8">
<title>Banner Studio — server local</title>
<body style="font-family:system-ui;max-width:40rem;margin:4rem auto;line-height:1.6">
<h1>Server local đang chạy</h1>
<p>API đã sẵn sàng ở cổng ${PORT}. Giao diện thì chưa có ở đây.</p>
<ul>
  <li>Đang phát triển: mở <a href="http://localhost:3100">http://localhost:3100</a> (Vite).</li>
  <li>Muốn chạy mọi thứ trên một cổng: <code>npm run build</code> rồi tải lại trang này.</li>
</ul></body>`);
    }

    const asset = safeJoin(DIST_DIR, p === '/' ? 'index.html' : p);
    if (asset && existsSync(asset) && statSync(asset).isFile()) return serveFile(res, asset);
    // SPA: route nào không phải file thì trả index.html để router phía client lo.
    return serveFile(res, join(DIST_DIR, 'index.html'));
  } catch (e) {
    console.error('[server]', req.method, url.pathname, e);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  }
});

getDb(); // tạo file DB + áp schema trước khi nhận request đầu tiên

// Cổng bị chiếm là tình huống rất hay gặp (chạy `npm run dev` hai lần).
// Node mặc định ném stack trace dài; nói rõ phải làm gì thì đỡ hoang mang.
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n  Cổng ${PORT} đang bị một tiến trình khác dùng.`);
    console.error('  Thường là do server này đã chạy ở cửa sổ terminal khác.');
    console.error(`  Tắt nó:   lsof -ti:${PORT} | xargs kill`);
    console.error(`  Hoặc đổi cổng:  PORT=5175 npm run server\n`);
    process.exit(1);
  }
  throw e;
});

server.listen(PORT, () => {
  console.log(`  Banner Studio — server local`);
  console.log(`  API    http://localhost:${PORT}`);
  console.log(`  DB     ${DB_PATH}`);
  console.log(`  Uploads ${UPLOAD_DIR}`);
});
