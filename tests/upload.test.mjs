// Test lưu file. Phần quan trọng nhất: nhận diện file theo HÀNH VI.
//
// Ở bản cloud từng mất rất nhiều thời gian vì `file instanceof File` trả về
// false dù đúng là file: FormData của mỗi runtime dựng File bằng class riêng
// của nó, nên `instanceof` so sai realm. Thông báo lỗi lúc đó là "thiếu field
// file" nên dẫn người đọc đi sai hướng hoàn toàn.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { handleUpload, saveBuffer } from '../server/upload.mjs';
import { UPLOAD_DIR } from '../server/db/open.mjs';

// PNG 1x1 thật — không dùng buffer rỗng, để còn kiểm tra đúng số byte.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

let server;
let base;

before(async () => {
  server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    req.rawBody = Buffer.concat(chunks);
    return handleUpload(req, res);
  });
  await new Promise(r => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});

after(() => server.close());

async function upload(form) {
  const res = await fetch(`${base}/api/upload`, { method: 'POST', body: form });
  return { status: res.status, body: await res.json() };
}

test('upload ảnh trả URL dùng được và ghi đúng số byte ra ổ đĩa', async () => {
  const form = new FormData();
  form.append('file', new File([PNG], 'test.png', { type: 'image/png' }));
  form.append('folder', 'banners');

  const { status, body } = await upload(form);
  assert.equal(status, 200);
  assert.match(body.url, /^\/files\/banners\/.+\.png$/);
  assert.equal(body.size, PNG.length);

  const onDisk = join(UPLOAD_DIR, body.path);
  assert.ok(existsSync(onDisk), 'file phải có thật trên ổ đĩa');
  assert.deepEqual(readFileSync(onDisk), PNG, 'byte phải khớp nguyên bản');
});

test('thiếu field file thì báo lỗi kèm danh sách field nhận được', async () => {
  const form = new FormData();
  form.append('folder', 'refs');

  const { status, body } = await upload(form);
  assert.equal(status, 400);
  // Chỉ nói "thiếu file" là người đọc không biết mình gửi sai tên field gì.
  assert.match(body.hint, /folder/);
});

test('định dạng không cho phép bị từ chối', async () => {
  const form = new FormData();
  form.append('file', new File([Buffer.from('#!/bin/sh')], 'x.sh', { type: 'application/x-sh' }));

  const { status, body } = await upload(form);
  assert.equal(status, 400);
  assert.match(body.error, /không cho phép/);
});

test('folder lạ rơi về misc chứ không tạo thư mục tuỳ ý', async () => {
  const form = new FormData();
  form.append('file', new File([PNG], 'a.png', { type: 'image/png' }));
  form.append('folder', '../../../etc');

  const { status, body } = await upload(form);
  assert.equal(status, 200);
  assert.match(body.path, /^misc\//);
});

test('hai file cùng tên không ghi đè nhau', async () => {
  const send = async () => {
    const form = new FormData();
    form.append('file', new File([PNG], 'same-name.png', { type: 'image/png' }));
    return (await upload(form)).body.path;
  };
  const [p1, p2] = [await send(), await send()];
  assert.notEqual(p1, p2);
});

test('saveBuffer dùng được trực tiếp (đường tải ảnh từ nhà cung cấp về)', async () => {
  const saved = await saveBuffer(PNG, 'image/png', 'banners');
  assert.match(saved.url, /^\/files\/banners\//);
  assert.equal(saved.mime, 'image/png');
  assert.ok(existsSync(join(UPLOAD_DIR, saved.path)));
});

test('saveBuffer từ chối mime không hợp lệ', async () => {
  await assert.rejects(() => saveBuffer(PNG, 'text/html', 'banners'), /không cho phép/);
});
