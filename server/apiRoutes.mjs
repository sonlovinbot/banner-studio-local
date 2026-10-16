// Các endpoint /api/* mà front-end gọi.
//
// Vì sao phải có server cho mấy cái này thay vì gọi thẳng từ trình duyệt:
//   - Firecrawl và KIE không bật CORS, trình duyệt gọi trực tiếp là bị chặn.
//   - API key không nên nằm trong bundle front-end.
// Coachio và OpenAI thì ngược lại: gọi thẳng từ trình duyệt được, nên app
// vẫn gọi trực tiếp, không đi qua đây.

import { getDb } from './db/open.mjs';
import { LOCAL_USER_ID, LOCAL_EMAIL } from './auth.mjs';
import { saveBuffer } from './upload.mjs';

const FIRECRAWL_URL = 'https://api.firecrawl.dev/v2/scrape';
const KIE_BASE = process.env.KIE_BASE_URL || 'https://api.kie.ai';

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** Đọc key của user local. Ưu tiên biến môi trường, sau đó tới DB (key nhập
 *  trong Settings). Env đi trước để bạn gắn key một lần trong .env.local là
 *  mọi chỗ dùng được, không phải nhập lại trên UI. */
function resolveKey(envName, column) {
  const fromEnv = process.env[envName];
  if (fromEnv && fromEnv.trim()) return { key: fromEnv.trim().replace(/^["']|["']$/g, ''), source: '.env.local' };
  if (!column) return { key: null, source: 'none' };
  const row = getDb()
    .prepare(`SELECT ${column} AS k FROM user_api_keys WHERE user_id = ? LIMIT 1`)
    .get(LOCAL_USER_ID);
  const k = row?.k ? String(row.k).trim() : '';
  return k ? { key: k, source: 'Settings' } : { key: null, source: 'none' };
}

// ───────────────── /api/user-keys ─────────────────
// Lưu key Coachio / Firecrawl vào DB để MCP server đọc được (MCP chạy ở
// tiến trình khác, không thấy localStorage của trình duyệt).

function handleUserKeys(req, res) {
  const db = getDb();

  if (req.method === 'GET') {
    // Trả cả key đặt trong .env.local, không chỉ key nhập trên UI. Nhờ vậy
    // điền một file .env.local là front-end nhận được key ngay, không phải
    // nhập lại ở Settings.
    return json(res, 200, {
      coachio_api_key:   resolveKey('COACHIO_API_KEY', 'coachio_api_key').key,
      firecrawl_api_key: resolveKey('FIRECRAWL_API_KEY', 'firecrawl_api_key').key,
      kie_api_key:       resolveKey('KIE_API_KEY', 'kie_api_key').key,
    });
  }

  if (req.method === 'POST') {
    const body = req.jsonBody;
    if (!body || typeof body !== 'object') return json(res, 400, { error: 'Body phải là JSON' });

    const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
    const clean = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

    // Chỉ ghi field nào client gửi — nhờ vậy lưu key Coachio không xoá mất
    // key Firecrawl đang có (và ngược lại).
    db.prepare(
      'INSERT INTO user_api_keys (user_id, updated_at) VALUES (?, ?) ON CONFLICT("user_id") DO NOTHING',
    ).run(LOCAL_USER_ID, new Date().toISOString());
    if (has('coachio_api_key')) {
      db.prepare('UPDATE user_api_keys SET coachio_api_key = ?, updated_at = ? WHERE user_id = ?')
        .run(clean(body.coachio_api_key), new Date().toISOString(), LOCAL_USER_ID);
    }
    if (has('firecrawl_api_key')) {
      db.prepare('UPDATE user_api_keys SET firecrawl_api_key = ?, updated_at = ? WHERE user_id = ?')
        .run(clean(body.firecrawl_api_key), new Date().toISOString(), LOCAL_USER_ID);
    }
    if (has('kie_api_key')) {
      db.prepare('UPDATE user_api_keys SET kie_api_key = ?, updated_at = ? WHERE user_id = ?')
        .run(clean(body.kie_api_key), new Date().toISOString(), LOCAL_USER_ID);
    }
    return json(res, 200, { ok: true });
  }

  if (req.method === 'DELETE') {
    db.prepare('DELETE FROM user_api_keys WHERE user_id = ?').run(LOCAL_USER_ID);
    return json(res, 200, { ok: true });
  }

  return json(res, 405, { error: 'Method không hỗ trợ' });
}

// ───────────────── /api/firecrawl-scrape ─────────────────

async function handleFirecrawl(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Chỉ nhận POST' });

  const url = typeof req.jsonBody?.url === 'string' ? req.jsonBody.url.trim() : '';
  if (!url) return json(res, 400, { error: 'Thiếu url' });
  try { new URL(url); } catch { return json(res, 400, { error: 'URL không hợp lệ' }); }

  let { key } = resolveKey('FIRECRAWL_API_KEY', 'firecrawl_api_key');
  if (!key) {
    return json(res, 402, {
      error: 'Chưa có Firecrawl API key. Mở Settings → API Keys → Firecrawl, hoặc đặt FIRECRAWL_API_KEY trong .env.local.',
    });
  }
  // Key Firecrawl luôn bắt đầu bằng "fc-"; dán thiếu tiền tố là lỗi rất
  // thường gặp nên tự thêm thay vì báo sai key.
  if (!key.startsWith('fc-')) key = 'fc-' + key;

  let upstream;
  try {
    upstream = await fetch(FIRECRAWL_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url, onlyMainContent: true, maxAge: 172800000, parsers: ['pdf'], formats: ['markdown'],
      }),
    });
  } catch (e) {
    return json(res, 502, { error: `Lỗi mạng khi gọi Firecrawl: ${e.message}` });
  }

  const text = await upstream.text();
  let data;
  try { data = JSON.parse(text); }
  catch { return json(res, 502, { error: `Firecrawl trả về không phải JSON (${upstream.status})`, raw: text.slice(0, 300) }); }

  if (!upstream.ok) {
    return json(res, upstream.status, {
      error: data?.error || data?.message || `Firecrawl ${upstream.status}`,
      detail: data,
    });
  }

  const markdown = data?.data?.markdown || data?.markdown || '';
  const metadata = data?.data?.metadata || data?.metadata || {};
  if (!markdown) return json(res, 502, { error: 'Firecrawl OK nhưng không trả markdown', raw: data });

  return json(res, 200, {
    url, markdown, bytes: markdown.length,
    metadata: {
      title: metadata.title, description: metadata.description,
      ogTitle: metadata.ogTitle, ogDescription: metadata.ogDescription,
      sourceURL: metadata.sourceURL,
    },
  });
}

// ───────────────── /api/kie/* ─────────────────
// KIE là một cổng gom nhiều model của nhiều hãng (Google Nano Banana, Veo,
// Suno...) về một API. Luồng của nó là BẤT ĐỒNG BỘ:
//   POST /api/v1/jobs/createTask  -> { code, data: { taskId } }
//   GET  /api/v1/jobs/recordInfo?taskId=...  -> state: waiting|queuing|generating|success|fail
//
// Bẫy quan trọng: KIE trả HTTP 200 KÈM code lỗi trong body. Chỉ nhìn
// res.ok là tưởng thành công trong khi thật ra hết credit hoặc sai model.

function kieFail(res, status, message, extra) {
  return json(res, status, { error: message, ...(extra || {}) });
}

async function kieCall(path, init) {
  const { key } = resolveKey('KIE_API_KEY', 'kie_api_key');
  if (!key) {
    const err = new Error('Chưa có KIE API key. Đặt KIE_API_KEY trong .env.local (lấy ở https://kie.ai/api-key).');
    err.status = 402;
    throw err;
  }
  const upstream = await fetch(`${KIE_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  const text = await upstream.text();
  let data;
  try { data = JSON.parse(text); }
  catch {
    const err = new Error(`KIE trả về không phải JSON (HTTP ${upstream.status})`);
    err.status = 502; err.raw = text.slice(0, 300);
    throw err;
  }
  // Lỗi của KIE nằm trong body dù HTTP là 200.
  if (!upstream.ok || (data.code !== undefined && data.code !== 200)) {
    const err = new Error(data.msg || data.message || `KIE lỗi code=${data.code ?? upstream.status}`);
    err.status = upstream.ok ? 400 : upstream.status;
    err.kieCode = data.code;
    throw err;
  }
  return data;
}

async function handleKie(req, res, url) {
  const sub = url.pathname.replace(/^\/api\/kie\/?/, '');

  try {
    if (sub === 'create' && req.method === 'POST') {
      const { model, input } = req.jsonBody || {};
      if (!model) return kieFail(res, 400, 'Thiếu "model" (vd: google/nano-banana)');
      if (!input || typeof input !== 'object') return kieFail(res, 400, 'Thiếu object "input"');
      const data = await kieCall('/api/v1/jobs/createTask', {
        method: 'POST',
        body: JSON.stringify({ model, input }),
      });
      const taskId = data?.data?.taskId;
      if (!taskId) return kieFail(res, 502, 'KIE không trả taskId', { raw: data });
      return json(res, 200, { taskId });
    }

    if (sub === 'task' && req.method === 'GET') {
      const taskId = url.searchParams.get('taskId');
      if (!taskId) return kieFail(res, 400, 'Thiếu taskId');
      const data = await kieCall(`/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
        method: 'GET',
      });
      const d = data?.data || {};
      // resultJson là JSON ĐÃ ĐÓNG THÀNH CHUỖI — phải parse thêm một lần nữa
      // mới thấy resultUrls.
      let urls = [];
      if (d.resultJson) {
        try { urls = JSON.parse(d.resultJson)?.resultUrls || []; } catch { /* để rỗng */ }
      }
      return json(res, 200, {
        taskId: d.taskId || taskId,
        state: d.state || 'unknown',
        urls,
        failMsg: d.failMsg || null,
        creditsConsumed: d.creditsConsumed ?? null,
        costTime: d.costTime ?? null,
      });
    }

    return kieFail(res, 404, `Không có route KIE: ${sub || '(rỗng)'}. Dùng /api/kie/create hoặc /api/kie/task`);
  } catch (e) {
    return kieFail(res, e.status || 500, e.message, e.raw ? { raw: e.raw } : undefined);
  }
}

// ───────────────── /api/fetch-to-storage ─────────────────
// Tải một URL ảnh/video về ./data/uploads rồi trả URL local.
//
// Cần endpoint này vì ảnh do nhà cung cấp trả về chỉ sống tạm (KIE để file ở
// CDN tạm và dọn sau ít ngày). Lưu URL đó vào lịch sử thì vài hôm sau mở lại
// chỉ còn ảnh hỏng. Tải về một lần là xong.
//
// Trình duyệt không tự làm được việc này: CDN của họ không bật CORS.

async function handleFetchToStorage(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Chỉ nhận POST' });
  const src = typeof req.jsonBody?.url === 'string' ? req.jsonBody.url.trim() : '';
  const folder = typeof req.jsonBody?.folder === 'string' ? req.jsonBody.folder : 'banners';
  if (!src) return json(res, 400, { error: 'Thiếu url' });

  let parsed;
  try { parsed = new URL(src); } catch { return json(res, 400, { error: 'URL không hợp lệ' }); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return json(res, 400, { error: 'Chỉ nhận http/https' });
  }

  let upstream;
  try { upstream = await fetch(src); }
  catch (e) { return json(res, 502, { error: `Không tải được: ${e.message}` }); }
  if (!upstream.ok) return json(res, 502, { error: `Nguồn trả về HTTP ${upstream.status}` });

  const mime = (upstream.headers.get('content-type') || '').split(';')[0].trim();
  const buf = Buffer.from(await upstream.arrayBuffer());
  try {
    const saved = await saveBuffer(buf, mime, folder);
    return json(res, 200, saved);
  } catch (e) {
    return json(res, 400, { error: e.message });
  }
}

// ───────────────── router ─────────────────

export async function handleApi(req, res, url) {
  const p = url.pathname;

  if (p === '/api/user-keys')       return handleUserKeys(req, res);
  if (p === '/api/fetch-to-storage') return handleFetchToStorage(req, res);
  if (p === '/api/firecrawl-scrape') return handleFirecrawl(req, res);
  if (p.startsWith('/api/kie'))     return handleKie(req, res, url);

  if (p === '/api/whoami') {
    return json(res, 200, {
      mode: 'local',
      user: { id: LOCAL_USER_ID, email: LOCAL_EMAIL },
      keys: {
        coachio:   resolveKey('COACHIO_API_KEY', 'coachio_api_key').source,
        openai:    resolveKey('OPENAI_API_KEY', null).source,
        kie:       resolveKey('KIE_API_KEY', 'kie_api_key').source,
        firecrawl: resolveKey('FIRECRAWL_API_KEY', 'firecrawl_api_key').source,
      },
    });
  }

  return json(res, 404, { error: `Không có endpoint: ${p}` });
}

export { resolveKey };
