// Nạp .env.local vào process.env.
//
// Node không tự đọc .env. Có cờ `--env-file` nhưng nó BÁO LỖI nếu file không
// tồn tại, mà repo này cố tình chạy được khi chưa có .env.local — nên tự đọc
// ở đây, thiếu file thì bỏ qua.
//
// Biến đã có sẵn trong môi trường thì không bị ghi đè: chạy
// `KIE_API_KEY=... npm run dev` vẫn thắng file.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECT_ROOT } from './db/open.mjs';

export function loadEnv(fileName = '.env.local') {
  const path = join(PROJECT_ROOT, fileName);
  if (!existsSync(path)) return 0;

  let loaded = 0;
  for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    if (!key || key in process.env) continue;

    let value = line.slice(eq + 1).trim();
    // Bỏ nháy bọc ngoài nếu có — dán từ nơi khác hay kèm theo.
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!value) continue;

    process.env[key] = value;
    loaded++;
  }
  return loaded;
}
