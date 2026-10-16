#!/usr/bin/env node
// MCP server local của Banner Studio.
//
// Để Claude Desktop / Codex / ChatGPT Desktop đọc được thư viện banner của
// bạn và sinh ảnh mới, ngay trên máy — không cần deploy, không cần OAuth,
// không mở cổng nào ra internet.
//
// Cách nó hoạt động: chạy qua stdio (tiến trình con của app chat), đọc THẲNG
// file ./data/app.db — cùng file mà web app đang dùng. Nhờ vậy ảnh Claude sinh
// ra hiện luôn trong History của app, và ngược lại.
//
// Cài vào Claude Desktop: xem mcp/README.md (hoặc chạy `node mcp/install.mjs`).

// App chat khởi động MCP server bằng tiến trình riêng, không đi qua shell của
// bạn, nên không có biến môi trường nào — phải tự đọc .env.local.
import { loadEnv } from '../server/env.mjs';
loadEnv();

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'node:crypto';

import { getDb } from '../server/db/open.mjs';
import { rowFromDb } from '../server/db/columns.mjs';
import { saveBuffer } from '../server/upload.mjs';
import { LOCAL_USER_ID } from '../server/auth.mjs';

const KIE_BASE = process.env.KIE_BASE_URL || 'https://api.kie.ai';

// ─────────────────────── tiện ích ───────────────────────

const ok = (data) => ({
  content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
});

const fail = (message) => ({
  content: [{ type: 'text', text: `Lỗi: ${message}` }],
  isError: true,
});

/** Key đọc từ env trước, rồi tới key đã lưu trong app (Settings → API Keys). */
function apiKey(envName, column) {
  const fromEnv = process.env[envName];
  if (fromEnv?.trim()) return fromEnv.trim();
  const row = getDb()
    .prepare(`SELECT ${column} AS k FROM user_api_keys WHERE user_id = ? LIMIT 1`)
    .get(LOCAL_USER_ID);
  return row?.k ? String(row.k).trim() : '';
}

/** Banner nào cũng trả kèm URL xem được trên trình duyệt. */
const APP_ORIGIN = process.env.APP_ORIGIN || 'http://localhost:5174';

function presentBanner(row) {
  const b = rowFromDb('banner_history', row);
  return {
    id: b.id,
    prompt: b.prompt_used,
    model: b.model,
    quality: b.quality,
    aspectRatio: b.aspect_ratio,
    featureType: b.feature_type,
    isFavorite: !!b.is_favorite,
    createdAt: b.created_at,
    imageUrl: b.image_url?.startsWith('/') ? APP_ORIGIN + b.image_url : b.image_url,
  };
}

// ─────────────────────── định nghĩa tool ───────────────────────

const TOOLS = [
  {
    name: 'list_banners',
    description: 'Liệt kê banner đã tạo, mới nhất trước. Lọc được theo tool và theo đánh dấu yêu thích.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Số banner trả về (mặc định 20, tối đa 100)' },
        offset: { type: 'number', description: 'Bỏ qua bao nhiêu banner đầu (để phân trang)' },
        featureType: {
          type: 'string',
          enum: ['banner', 'ugc', 'image_studio', 'mcp_banner'],
          description: 'Chỉ lấy banner của một tool',
        },
        favoritesOnly: { type: 'boolean', description: 'Chỉ lấy banner đã đánh dấu yêu thích' },
      },
    },
  },
  {
    name: 'search_banners',
    description: 'Tìm banner theo nội dung prompt đã dùng để tạo nó.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Từ khoá cần tìm trong prompt' },
        limit: { type: 'number', description: 'Số kết quả (mặc định 20)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_banner',
    description: 'Lấy đầy đủ thông tin một banner theo id, gồm cả tham số đã dùng khi tạo.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'list_brands',
    description: 'Liệt kê brand đã lưu (tên, mô tả brand, ghi chú style). Dùng để viết prompt đúng giọng brand.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'stats',
    description: 'Thống kê nhanh: tổng số banner, số theo từng tool, số brand, số ảnh trong thư viện.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'generate_banner',
    description:
      'Sinh một ảnh banner mới từ prompt bằng KIE.ai, lưu ảnh vào máy và ghi vào History của app '
      + '(tab "Banner MCP"). Cần KIE API key — đặt trong .env.local hoặc nhập ở Settings → API Keys.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Mô tả ảnh muốn tạo. Càng cụ thể càng tốt.' },
        aspectRatio: {
          type: 'string',
          enum: ['1:1', '4:5', '3:4', '9:16', '16:9', '3:2', '2:3'],
          description: 'Tỷ lệ khung ảnh (mặc định 1:1)',
        },
        model: { type: 'string', description: 'Model KIE (mặc định google/nano-banana)' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'set_favorite',
    description: 'Đánh dấu hoặc bỏ đánh dấu yêu thích cho một banner.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        favorite: { type: 'boolean' },
      },
      required: ['id', 'favorite'],
    },
  },
];

// ─────────────────────── xử lý tool ───────────────────────

function toolListBanners(args) {
  const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 100);
  const offset = Math.max(Number(args.offset) || 0, 0);
  const where = [];
  const params = [];
  if (args.featureType) { where.push('feature_type = ?'); params.push(args.featureType); }
  else { where.push("feature_type <> 'mcp_banner'"); } // giống tab "Tất cả" của app
  if (args.favoritesOnly) where.push('is_favorite = 1');

  const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const db = getDb();
  const total = db.prepare(`SELECT COUNT(*) AS n FROM banner_history${whereSql}`).get(...params).n;
  const rows = db
    .prepare(`SELECT * FROM banner_history${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);
  return ok({ total, returned: rows.length, offset, banners: rows.map(presentBanner) });
}

function toolSearchBanners(args) {
  const q = String(args.query || '').trim();
  if (!q) return fail('Thiếu query');
  const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 100);
  const rows = getDb()
    .prepare('SELECT * FROM banner_history WHERE prompt_used LIKE ? ORDER BY created_at DESC LIMIT ?')
    .all(`%${q}%`, limit);
  return ok({ query: q, found: rows.length, banners: rows.map(presentBanner) });
}

function toolGetBanner(args) {
  const row = getDb().prepare('SELECT * FROM banner_history WHERE id = ?').get(String(args.id || ''));
  if (!row) return fail(`Không có banner id="${args.id}"`);
  const b = rowFromDb('banner_history', row);
  return ok({ ...presentBanner(row), genParams: b.gen_params, parentId: b.parent_id, version: b.version });
}

function toolListBrands() {
  const rows = getDb()
    .prepare('SELECT * FROM brand_projects ORDER BY updated_at DESC')
    .all()
    .map(r => rowFromDb('brand_projects', r));
  return ok({
    count: rows.length,
    brands: rows.map(b => ({
      id: b.id, name: b.name, brandInfo: b.brand_info, eventInfo: b.event_info,
      styleNotes: b.json_prompt, scrapedUrl: b.scraped_url, updatedAt: b.updated_at,
    })),
  });
}

function toolStats() {
  const db = getDb();
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  const byFeature = db
    .prepare('SELECT feature_type, COUNT(*) AS n FROM banner_history GROUP BY feature_type')
    .all();
  return ok({
    banners: one('SELECT COUNT(*) AS n FROM banner_history').n,
    favorites: one('SELECT COUNT(*) AS n FROM banner_history WHERE is_favorite = 1').n,
    byFeature: Object.fromEntries(byFeature.map(r => [r.feature_type, r.n])),
    brands: one('SELECT COUNT(*) AS n FROM brand_projects').n,
    libraryImages: one('SELECT COUNT(*) AS n FROM library_images').n,
    briefs: one('SELECT COUNT(*) AS n FROM brand_briefs').n,
  });
}

function toolSetFavorite(args) {
  const db = getDb();
  const row = db.prepare('SELECT id FROM banner_history WHERE id = ?').get(String(args.id || ''));
  if (!row) return fail(`Không có banner id="${args.id}"`);
  db.prepare('UPDATE banner_history SET is_favorite = ? WHERE id = ?')
    .run(args.favorite ? 1 : 0, row.id);
  return ok({ id: row.id, favorite: !!args.favorite });
}

/** KIE trả HTTP 200 kèm code lỗi trong body — phải kiểm tra `code`, không
 *  chỉ res.ok, nếu không thì hết credit cũng tưởng là thành công. */
async function kie(path, init, key) {
  const res = await fetch(`${KIE_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error(`KIE trả về không phải JSON (HTTP ${res.status}): ${text.slice(0, 200)}`); }
  if (!res.ok || (data.code !== undefined && data.code !== 200)) {
    throw new Error(data.msg || data.message || `KIE lỗi code=${data.code ?? res.status}`);
  }
  return data;
}

async function toolGenerateBanner(args) {
  const prompt = String(args.prompt || '').trim();
  if (!prompt) return fail('Thiếu prompt');

  const key = apiKey('KIE_API_KEY', 'kie_api_key');
  if (!key) {
    return fail(
      'Chưa có KIE API key. Lấy ở https://kie.ai/api-key rồi đặt KIE_API_KEY trong .env.local, '
      + 'hoặc nhập ở Settings → API Keys trong app.',
    );
  }

  const model = String(args.model || 'google/nano-banana');
  const aspectRatio = String(args.aspectRatio || '1:1');

  const created = await kie('/api/v1/jobs/createTask', {
    method: 'POST',
    body: JSON.stringify({ model, input: { prompt, aspect_ratio: aspectRatio, output_format: 'png' } }),
  }, key);
  const taskId = created?.data?.taskId;
  if (!taskId) return fail('KIE không trả taskId');

  // Chờ tối đa 5 phút. Ảnh thường xong trong 10-60 giây.
  const deadline = Date.now() + 5 * 60 * 1000;
  let imageUrl = '';
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 3000));
    const info = await kie(`/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, { method: 'GET' }, key);
    const d = info?.data || {};
    if (d.state === 'fail') return fail(d.failMsg || 'KIE báo task thất bại');
    if (d.state === 'success') {
      // resultJson là JSON đã đóng thành chuỗi — phải parse thêm một lần.
      try { imageUrl = JSON.parse(d.resultJson || '{}')?.resultUrls?.[0] || ''; } catch { /* để rỗng */ }
      break;
    }
  }
  if (!imageUrl) return fail(`Hết thời gian chờ KIE (taskId=${taskId})`);

  // Tải ảnh về máy: URL của KIE chỉ sống tạm, lưu nguyên vào lịch sử thì
  // vài hôm sau mở lại chỉ còn ảnh hỏng.
  let storedUrl = imageUrl;
  try {
    const res = await fetch(imageUrl);
    if (res.ok) {
      const mime = (res.headers.get('content-type') || 'image/png').split(';')[0].trim();
      const saved = await saveBuffer(Buffer.from(await res.arrayBuffer()), mime, 'banners');
      storedUrl = saved.url;
    }
  } catch (e) {
    console.error('[mcp] không tải được ảnh về, giữ URL tạm của KIE:', e.message);
  }

  const id = randomUUID().slice(0, 8);
  getDb().prepare(`
    INSERT INTO banner_history
      (id, user_id, image_url, prompt_used, model, quality, aspect_ratio, feature_type, created_at, gen_params)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'mcp_banner', ?, ?)
  `).run(
    id, LOCAL_USER_ID, storedUrl, prompt, `kie-${model}`, '1K', aspectRatio,
    new Date().toISOString(), JSON.stringify({ source: 'mcp', model, taskId }),
  );

  return ok({
    id,
    imageUrl: storedUrl.startsWith('/') ? APP_ORIGIN + storedUrl : storedUrl,
    model, aspectRatio, prompt,
    note: 'Ảnh đã lưu vào History của app, xem ở tab "Banner MCP".',
  });
}

const HANDLERS = {
  list_banners: toolListBanners,
  search_banners: toolSearchBanners,
  get_banner: toolGetBanner,
  list_brands: toolListBrands,
  stats: toolStats,
  set_favorite: toolSetFavorite,
  generate_banner: toolGenerateBanner,
};

// ─────────────────────── khởi động ───────────────────────

const server = new Server(
  { name: 'banner-studio-local', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const handler = HANDLERS[req.params.name];
  if (!handler) return fail(`Không có tool "${req.params.name}"`);
  try {
    return await handler(req.params.arguments || {});
  } catch (e) {
    // Trả lỗi dưới dạng kết quả tool để app chat đọc được và nói lại cho
    // người dùng, thay vì ném ra làm đứt kết nối.
    return fail(e.message || String(e));
  }
});

// stdout dành riêng cho giao thức MCP — log phải ra stderr, nếu không sẽ
// làm hỏng JSON-RPC và app chat báo "server disconnected".
console.error('[banner-studio-local] MCP server đang chạy qua stdio');

await server.connect(new StdioServerTransport());
