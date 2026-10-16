// Test cầu nối kiểu dữ liệu giữa JSON của client và SQLite.
//
// Lỗi ở tầng này âm thầm: `is_favorite` đọc ra số 0 vẫn "falsy" nên UI trông
// như chạy đúng, nhưng chỗ nào so sánh `=== true` thì sai mà không báo gì.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rowToDb, rowFromDb } from '../server/db/columns.mjs';

test('cột jsonb: ghi thì stringify, đọc thì parse', () => {
  const written = rowToDb('banner_history', { gen_params: { quality: '2K', refs: [1, 2] } });
  assert.equal(typeof written.gen_params, 'string');

  const read = rowFromDb('banner_history', written);
  assert.deepEqual(read.gen_params, { quality: '2K', refs: [1, 2] });
});

test('cột boolean: ghi thành 1/0, đọc lại thành true/false', () => {
  assert.equal(rowToDb('banner_history', { is_favorite: true }).is_favorite, 1);
  assert.equal(rowToDb('banner_history', { is_favorite: false }).is_favorite, 0);
  assert.equal(rowFromDb('banner_history', { is_favorite: 1 }).is_favorite, true);
  assert.equal(rowFromDb('banner_history', { is_favorite: 0 }).is_favorite, false);
});

test('boolean ở cột chưa khai cũng phải đổi — node:sqlite không bind được', () => {
  const w = rowToDb('banner_history', { some_flag: true });
  assert.equal(w.some_flag, 1);
});

test('object ở cột chưa khai thì lưu JSON thay vì vỡ', () => {
  const w = rowToDb('banner_history', { whatever: { a: 1 } });
  assert.equal(w.whatever, '{"a":1}');
});

test('null giữ nguyên null ở cả hai chiều', () => {
  assert.equal(rowToDb('banner_history', { gen_params: null }).gen_params, null);
  assert.equal(rowFromDb('banner_history', { gen_params: null }).gen_params, null);
  assert.equal(rowFromDb('banner_history', { is_favorite: null }).is_favorite, null);
});

test('undefined bị loại khỏi câu insert, không ghi thành null', () => {
  const w = rowToDb('banner_history', { id: 'x', model: undefined });
  assert.deepEqual(Object.keys(w), ['id']);
});

test('cột json chứa dữ liệu cũ không phải JSON thì trả nguyên văn', () => {
  // DB thật có thể còn hàng cũ ghi bằng bản trước. Ném lỗi ở đây sẽ làm
  // sập cả trang History chỉ vì một hàng xấu.
  const read = rowFromDb('banner_history', { gen_params: 'không phải json' });
  assert.equal(read.gen_params, 'không phải json');
});

test('chuỗi rỗng ở cột json đọc ra null', () => {
  assert.equal(rowFromDb('banner_history', { gen_params: '' }).gen_params, null);
});

test('bảng không có cột đặc biệt thì đi qua nguyên vẹn', () => {
  const row = { id: 'x', url: '/files/a.png', category: 'ref' };
  assert.deepEqual(rowFromDb('library_images', row), row);
  assert.deepEqual(rowToDb('library_images', row), row);
});
