// Test đường dữ liệu đầy đủ: HTTP vào -> SQLite -> HTTP ra.
//
// Test ở mức HTTP chứ không gọi hàm trực tiếp, vì cái cần đảm bảo là
// `supabase-js` nói chuyện được với server này. Header (Range, Prefer,
// Accept, Content-Range) chính là phần giao thức dễ sai nhất.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { handleRest } from '../server/rest.mjs';
import { handleAuth } from '../server/auth.mjs';
import { getDb } from '../server/db/open.mjs';

let server;
let base;

before(async () => {
  // Dựng đúng phần router cần test, không cần cả server thật.
  server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const raw = Buffer.concat(chunks);
      if (raw.length) {
        try { req.jsonBody = JSON.parse(raw.toString('utf8')); } catch { /* không phải json */ }
      }
    }
    if (url.pathname.startsWith('/auth/v1')) return handleAuth(req, res, url);
    return handleRest(req, res, url);
  });
  await new Promise(r => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
  getDb().exec('DELETE FROM banner_history');
});

after(() => server.close());

const USER = '00000000-0000-4000-8000-000000000001';

function row(id, extra = {}) {
  return {
    id, user_id: USER, image_url: `/files/banners/${id}.png`,
    prompt_used: `prompt ${id}`, feature_type: 'banner',
    created_at: new Date(2026, 0, 1 + (extra.day || 0)).toISOString(),
    ...extra,
  };
}

async function insert(rows, prefer = 'return=representation') {
  const res = await fetch(`${base}/rest/v1/banner_history`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: prefer },
    body: JSON.stringify(rows),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

test('insert rồi select lại giữ đúng kiểu dữ liệu', async () => {
  const { status, body } = await insert([
    row('a', { is_favorite: true, gen_params: { quality: '2K' } }),
  ]);
  assert.equal(status, 201);
  assert.equal(body[0].is_favorite, true, 'boolean phải về dạng true, không phải 1');
  assert.deepEqual(body[0].gen_params, { quality: '2K' }, 'jsonb phải được parse');
  assert.equal(body[0].version, 1, 'giá trị default của SQLite phải được trả về');
});

test('Range + Prefer: count=exact trả Content-Range đúng', async () => {
  await insert([row('b', { day: 1 }), row('c', { day: 2 }), row('d', { day: 3 })], 'return=minimal');

  const res = await fetch(
    `${base}/rest/v1/banner_history?select=id&order=created_at.desc`,
    { headers: { Prefer: 'count=exact', Range: '0-1' } },
  );
  const items = await res.json();
  assert.equal(items.length, 2, 'Range 0-1 phải trả đúng 2 hàng');
  assert.equal(res.headers.get('content-range'), '0-1/4', 'tổng phải là 4, không phải số hàng của trang');
});

test('phân trang: trang 2 không trùng trang 1', async () => {
  const page = async (range) => {
    const res = await fetch(
      `${base}/rest/v1/banner_history?select=id&order=id.asc`,
      { headers: { Range: range } },
    );
    return (await res.json()).map(r => r.id);
  };
  assert.deepEqual(await page('0-1'), ['a', 'b']);
  assert.deepEqual(await page('2-3'), ['c', 'd']);
});

test('HEAD chỉ trả số đếm, không trả thân', async () => {
  const res = await fetch(`${base}/rest/v1/banner_history?select=id`, {
    method: 'HEAD',
    headers: { Prefer: 'count=exact' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-range'), '0-3/4');
  assert.equal(await res.text(), '');
});

test('single/maybeSingle: có hàng trả object, không hàng trả 406', async () => {
  const hit = await fetch(`${base}/rest/v1/banner_history?id=eq.a&select=*`, {
    headers: { Accept: 'application/vnd.pgrst.object+json' },
  });
  assert.equal(hit.status, 200);
  assert.equal((await hit.json()).id, 'a', 'phải là object, không phải mảng');

  const miss = await fetch(`${base}/rest/v1/banner_history?id=eq.zzz&select=*`, {
    headers: { Accept: 'application/vnd.pgrst.object+json' },
  });
  // supabase-js nhận PGRST116 là "không có hàng" rồi trả data=null cho
  // maybeSingle(). Đổi mã này là làm vỡ mọi chỗ gọi maybeSingle.
  assert.equal(miss.status, 406);
  assert.equal((await miss.json()).code, 'PGRST116');
});

test('upsert merge-duplicates cập nhật hàng đã có', async () => {
  const res = await fetch(`${base}/rest/v1/banner_history?on_conflict=id`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(row('a', { prompt_used: 'đã sửa' })),
  });
  assert.equal(res.status, 201);

  const check = await fetch(`${base}/rest/v1/banner_history?id=eq.a&select=prompt_used`);
  assert.equal((await check.json())[0].prompt_used, 'đã sửa');
});

test('upsert ignore-duplicates không ghi đè', async () => {
  const res = await fetch(`${base}/rest/v1/banner_history`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates,return=minimal',
    },
    body: JSON.stringify(row('a', { prompt_used: 'không được ghi' })),
  });
  assert.equal(res.status, 201);

  const check = await fetch(`${base}/rest/v1/banner_history?id=eq.a&select=prompt_used`);
  assert.equal((await check.json())[0].prompt_used, 'đã sửa', 'giá trị cũ phải còn');
});

test('PATCH đổi được boolean', async () => {
  const res = await fetch(`${base}/rest/v1/banner_history?id=eq.a`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ is_favorite: false }),
  });
  assert.equal((await res.json())[0].is_favorite, false);
});

test('PATCH không filter bị từ chối', async () => {
  const res = await fetch(`${base}/rest/v1/banner_history`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ is_favorite: true }),
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).message, /không có filter/);
});

test('DELETE không filter bị từ chối', async () => {
  const res = await fetch(`${base}/rest/v1/banner_history`, { method: 'DELETE' });
  assert.equal(res.status, 400);

  const left = await fetch(`${base}/rest/v1/banner_history?select=id`);
  assert.equal((await left.json()).length, 4, 'không hàng nào được xoá');
});

test('DELETE có filter thì xoá đúng một hàng', async () => {
  const res = await fetch(`${base}/rest/v1/banner_history?id=eq.d`, { method: 'DELETE' });
  assert.equal(res.status, 204);

  const left = await fetch(`${base}/rest/v1/banner_history?select=id`);
  assert.equal((await left.json()).length, 3);
});

test('bảng không có trong schema bị chặn', async () => {
  const res = await fetch(`${base}/rest/v1/sqlite_master?select=*`);
  assert.equal(res.status, 404);
});

test('field lạ bị bỏ qua, phần còn lại vẫn insert', async () => {
  // Bản cloud có thể thừa cột so với schema local. Bỏ cả câu insert chỉ vì
  // một field lạ thì mất dữ liệu; bỏ field đó thì vẫn lưu được.
  const { status, body } = await insert([row('e', { khong_co_cot_nay: 'x', day: 9 })]);
  assert.equal(status, 201);
  assert.equal(body[0].id, 'e');
});

test('auth: token nào cũng trả về cùng một user local', async () => {
  const res = await fetch(`${base}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'bất kỳ@gì.cũng được', password: 'sai mật khẩu' }),
  });
  const session = await res.json();
  assert.equal(session.user.id, USER);
  assert.equal(session.token_type, 'bearer');
  assert.equal(session.access_token.split('.').length, 3, 'access_token phải là JWT 3 phần');
});

test('auth: PUT /user lưu tên hiển thị vào bảng profiles', async () => {
  const res = await fetch(`${base}/auth/v1/user`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { display_name: 'Sơn' } }),
  });
  assert.equal((await res.json()).user_metadata.display_name, 'Sơn');

  const again = await fetch(`${base}/auth/v1/user`);
  assert.equal((await again.json()).user_metadata.display_name, 'Sơn', 'phải còn sau khi đọc lại');
});

test('auth: magic link nói thẳng là không hỗ trợ', async () => {
  // Giả vờ "đã gửi mail" thì người dùng ngồi chờ mãi một email không bao giờ tới.
  const res = await fetch(`${base}/auth/v1/otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'a@b.c' }),
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).msg, /không gửi email/);
});
