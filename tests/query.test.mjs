// Test bộ dịch PostgREST -> SQL. Đây là chỗ dễ sai nhất và cũng là chỗ sai
// khó thấy nhất: dịch sai một toán tử thì query vẫn chạy, chỉ là trả sai dữ
// liệu, và lỗi hiện ra ở tận giao diện.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSelect, buildWhereOnly } from '../server/db/query.mjs';

test('select đơn giản với filter và order', () => {
  const p = buildSelect('banner_history', new URLSearchParams(
    'select=*&feature_type=eq.banner&order=created_at.desc&limit=10',
  ));
  assert.equal(
    p.sql,
    'SELECT * FROM "banner_history" WHERE "feature_type" = ? ORDER BY "created_at" DESC LIMIT 10',
  );
  assert.deepEqual(p.params, ['banner']);
});

test('chọn cột cụ thể được bọc nháy', () => {
  const p = buildSelect('t', new URLSearchParams('select=id,created_at'));
  assert.equal(p.sql, 'SELECT "id", "created_at" FROM "t"');
});

test('count=exact sinh câu đếm riêng dùng chung điều kiện', () => {
  const p = buildSelect('t', new URLSearchParams('is_favorite=is.true'), { wantCount: true });
  assert.equal(p.countSql, 'SELECT COUNT(*) AS n FROM "t" WHERE "is_favorite" = 1');
  assert.deepEqual(p.countParams, []);
});

test('is.null / is.true / is.false', () => {
  assert.match(buildSelect('t', new URLSearchParams('a=is.null')).sql, /"a" IS NULL/);
  assert.match(buildSelect('t', new URLSearchParams('a=is.true')).sql, /"a" = 1/);
  assert.match(buildSelect('t', new URLSearchParams('a=is.false')).sql, /"a" = 0/);
});

test('in.(...) và phủ định not.in.(...)', () => {
  const p = buildSelect('t', new URLSearchParams('a=in.(x,y,z)'));
  assert.match(p.sql, /"a" IN \(\?,\?,\?\)/);
  assert.deepEqual(p.params, ['x', 'y', 'z']);

  const n = buildSelect('t', new URLSearchParams('a=not.in.(x,y)'));
  assert.match(n.sql, /NOT \("a" IN \(\?,\?\)\)/);
});

test('in.() rỗng phải luôn SAI, không được bỏ qua điều kiện', () => {
  // Dịch thành "không có điều kiện" là bug nguy hiểm: `.in(ids)` với mảng
  // rỗng sẽ trả về TOÀN BỘ bảng thay vì không hàng nào.
  const p = buildSelect('t', new URLSearchParams('a=in.()'));
  assert.match(p.sql, /WHERE 0/);
});

test('or=(...) gom thành một nhóm OR', () => {
  const p = buildSelect('t', new URLSearchParams('or=(a.eq.1,b.is.null)'));
  assert.match(p.sql, /WHERE \("a" = \? OR "b" IS NULL\)/);
  assert.deepEqual(p.params, ['1']);
});

test('cs nhận cả {a,b} của mảng Postgres', () => {
  const p = buildSelect('t', new URLSearchParams('tags=cs.{khuyen-mai}'));
  assert.match(p.sql, /json_each/);
  assert.deepEqual(p.params, ['khuyen-mai']);
});

test('true/false/null trong giá trị được đổi sang kiểu SQLite', () => {
  assert.deepEqual(buildSelect('t', new URLSearchParams('a=eq.true')).params, [1]);
  assert.deepEqual(buildSelect('t', new URLSearchParams('a=eq.false')).params, [0]);
  assert.deepEqual(buildSelect('t', new URLSearchParams('a=eq.null')).params, [null]);
});

test('tên cột lạ bị từ chối chứ không nối thẳng vào SQL', () => {
  assert.throws(
    () => buildSelect('t', new URLSearchParams('a";DROP TABLE t;--=eq.1')),
    /Tên không hợp lệ/,
  );
});

test('toán tử chưa hỗ trợ báo lỗi rõ ràng', () => {
  assert.throws(
    () => buildSelect('t', new URLSearchParams('a=fts.xyz')),
    /chưa hỗ trợ/,
  );
});

test('buildWhereOnly bỏ qua tham số điều khiển', () => {
  const w = buildWhereOnly('t', new URLSearchParams('select=*&order=a.desc&limit=5&id=eq.7'));
  assert.equal(w.sql, ' WHERE "id" = ?');
  assert.deepEqual(w.params, ['7']);
});

test('buildWhereOnly trả rỗng khi không có filter — chỗ gọi phải tự chặn', () => {
  const w = buildWhereOnly('t', new URLSearchParams('select=*'));
  assert.equal(w.sql, '');
});
