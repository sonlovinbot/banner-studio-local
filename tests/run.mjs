#!/usr/bin/env node
// Bộ test của bản local. Chạy: npm test
//
// Chỉ dùng thư viện có sẵn của Node (node:test + node:assert) — không thêm
// framework nào, để `npm install` của học viên nhẹ và không bao giờ hỏng.
//
// Test chạy trên một DB TẠM (biến DB_PATH), không chạm vào ./data/app.db của
// bạn. Nếu không tách ra thì chạy test một lần là mất hết dữ liệu thật.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'banner-studio-test-'));

const files = readdirSync(here)
  .filter(f => f.endsWith('.test.mjs'))
  .map(f => join(here, f))
  .sort();

if (files.length === 0) {
  console.error('Không tìm thấy file .test.mjs nào trong tests/');
  process.exit(1);
}

// --test-concurrency=1: các file test dùng CHUNG một file DB, chạy song song
// thì file này xoá bảng của file kia và lỗi hiện ra ngẫu nhiên ở chỗ khác.
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files], {
  stdio: 'inherit',
  env: {
    ...process.env,
    DATA_DIR: tmp,
    DB_PATH: join(tmp, 'test.db'),
    // Tắt cảnh báo experimental của node:sqlite để output test dễ đọc.
    NODE_NO_WARNINGS: '1',
    // Xoá sạch API key. Có key thật thì test "thiếu key" sẽ gọi API thật và
    // TIÊU TIỀN của người chạy test. loadEnv() không ghi đè biến đã có, nên
    // đặt chuỗi rỗng ở đây cũng chặn luôn .env.local.
    KIE_API_KEY: '',
    OPENAI_API_KEY: '',
    COACHIO_API_KEY: '',
    FIRECRAWL_API_KEY: '',
  },
});

process.exit(result.status ?? 1);
