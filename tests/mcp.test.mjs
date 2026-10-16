// Test MCP server qua đúng giao thức thật: JSON-RPC trên stdio.
//
// Test ở mức này vì cái cần đảm bảo là Claude Desktop nói chuyện được với nó.
// Gọi hàm trực tiếp thì không phát hiện được lỗi hay gặp nhất: in log ra
// stdout làm hỏng JSON-RPC, và app chat chỉ báo "server disconnected".

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from '../server/db/open.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const USER = '00000000-0000-4000-8000-000000000001';

let child;
let buffer = '';
const pending = new Map();
let nextId = 1;

function send(method, params) {
  const id = nextId++;
  const promise = new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`Hết thời gian chờ phản hồi cho ${method}`));
      }
    }, 10000);
  });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  return promise;
}

/** Gọi tool rồi parse JSON trong phần text trả về. */
async function callTool(name, args = {}) {
  const res = await send('tools/call', { name, arguments: args });
  const text = res.content[0].text;
  if (res.isError) return { isError: true, text };
  return JSON.parse(text);
}

before(async () => {
  const db = getDb();
  db.exec('DELETE FROM banner_history');
  db.exec('DELETE FROM brand_projects');
  const now = new Date().toISOString();
  for (const [id, ft, fav] of [['m1', 'banner', 1], ['m2', 'banner', 0], ['m3', 'ugc', 0], ['m4', 'mcp_banner', 0]]) {
    db.prepare(`INSERT INTO banner_history
      (id, user_id, image_url, prompt_used, feature_type, created_at, is_favorite, gen_params)
      VALUES (?,?,?,?,?,?,?,?)`)
      .run(id, USER, `/files/banners/${id}.png`, `banner ${id} cho workshop AI`, ft, now, fav,
           JSON.stringify({ quality: '1K' }));
  }
  db.prepare('INSERT INTO brand_projects (id, user_id, name, brand_info, updated_at) VALUES (?,?,?,?,?)')
    .run('b1', USER, 'Lovinbot', 'Dạy AI cho người Việt', now);

  child = spawn(process.execPath, [join(ROOT, 'mcp', 'server.mjs')], {
    cwd: ROOT,
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      const waiter = pending.get(msg.id);
      if (!waiter) continue;
      pending.delete(msg.id);
      if (msg.error) waiter.reject(new Error(msg.error.message));
      else waiter.resolve(msg.result);
    }
  });

  await send('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test', version: '1' },
  });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
});

after(() => child?.kill());

test('tools/list khai đủ tool và tool nào cũng có mô tả', async () => {
  const { tools } = await send('tools/list', {});
  const names = tools.map(t => t.name).sort();
  assert.deepEqual(names, [
    'generate_banner', 'get_banner', 'list_banners', 'list_brands',
    'search_banners', 'set_favorite', 'stats',
  ]);
  for (const t of tools) {
    assert.ok(t.description?.length > 20, `tool ${t.name} thiếu mô tả tử tế`);
    assert.equal(t.inputSchema.type, 'object');
  }
});

test('stats đếm đúng', async () => {
  const s = await callTool('stats');
  assert.equal(s.banners, 4);
  assert.equal(s.favorites, 1);
  assert.equal(s.brands, 1);
  assert.deepEqual(s.byFeature, { banner: 2, ugc: 1, mcp_banner: 1 });
});

test('list_banners mặc định ẩn mcp_banner, giống tab "Tất cả" của app', async () => {
  const r = await callTool('list_banners');
  assert.equal(r.total, 3);
  assert.ok(!r.banners.some(b => b.featureType === 'mcp_banner'));
});

test('list_banners lọc được theo featureType và theo yêu thích', async () => {
  assert.equal((await callTool('list_banners', { featureType: 'ugc' })).total, 1);
  assert.equal((await callTool('list_banners', { featureType: 'mcp_banner' })).total, 1);
  assert.equal((await callTool('list_banners', { favoritesOnly: true })).total, 1);
});

test('list_banners phân trang, limit bị chặn trần', async () => {
  const page1 = await callTool('list_banners', { limit: 2, offset: 0 });
  const page2 = await callTool('list_banners', { limit: 2, offset: 2 });
  assert.equal(page1.returned, 2);
  assert.equal(page2.returned, 1);
  const overlap = page1.banners.filter(a => page2.banners.some(b => b.id === a.id));
  assert.equal(overlap.length, 0, 'hai trang không được trùng');

  const huge = await callTool('list_banners', { limit: 9999 });
  assert.ok(huge.returned <= 100, 'limit phải bị chặn để không trả cả DB');
});

test('ảnh trả về URL tuyệt đối — app chat không mở được đường dẫn tương đối', async () => {
  const r = await callTool('list_banners', { limit: 1 });
  assert.match(r.banners[0].imageUrl, /^http:\/\/localhost:\d+\/files\//);
});

test('search_banners tìm theo prompt', async () => {
  assert.equal((await callTool('search_banners', { query: 'workshop' })).found, 4);
  assert.equal((await callTool('search_banners', { query: 'không-có-đâu' })).found, 0);
});

test('get_banner trả cả gen_params đã parse', async () => {
  const b = await callTool('get_banner', { id: 'm1' });
  assert.equal(b.id, 'm1');
  assert.deepEqual(b.genParams, { quality: '1K' });
});

test('get_banner với id không tồn tại trả lỗi đọc được, không làm đứt kết nối', async () => {
  const r = await callTool('get_banner', { id: 'không-tồn-tại' });
  assert.equal(r.isError, true);
  assert.match(r.text, /Không có banner/);
});

test('list_brands trả brand kèm thông tin để viết prompt', async () => {
  const r = await callTool('list_brands');
  assert.equal(r.count, 1);
  assert.equal(r.brands[0].name, 'Lovinbot');
  assert.equal(r.brands[0].brandInfo, 'Dạy AI cho người Việt');
});

test('set_favorite ghi thật vào DB', async () => {
  await callTool('set_favorite', { id: 'm2', favorite: true });
  assert.equal((await callTool('list_banners', { favoritesOnly: true })).total, 2);

  await callTool('set_favorite', { id: 'm2', favorite: false });
  assert.equal((await callTool('list_banners', { favoritesOnly: true })).total, 1);
});

test('generate_banner thiếu key thì chỉ đường, không ném stack trace', async () => {
  // Xoá key cả ở env lẫn DB để test đúng nhánh "chưa cấu hình".
  const r = await callTool('generate_banner', { prompt: 'thử' });
  assert.equal(r.isError, true);
  assert.match(r.text, /kie\.ai\/api-key|KIE_API_KEY/);
});

test('tool không tồn tại trả lỗi thay vì sập', async () => {
  const r = await callTool('tool_bia_ra');
  assert.equal(r.isError, true);
});
