// Mở (và tạo nếu chưa có) file SQLite ở ./data/app.db.
//
// Dùng `node:sqlite` có sẵn trong Node >= 22.5 — không phải cài thêm gói
// native nào, nên `npm install` của học viên không bao giờ hỏng vì khâu build
// C++ như better-sqlite3.

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = join(here, '..', '..');
export const DATA_DIR = process.env.DATA_DIR || join(PROJECT_ROOT, 'data');
export const DB_PATH = process.env.DB_PATH || join(DATA_DIR, 'app.db');
export const UPLOAD_DIR = join(DATA_DIR, 'uploads');

// Cột thêm vào SAU khi đã có người dùng bản cũ.
//
// `CREATE TABLE IF NOT EXISTS` trong schema.sql chỉ tạo bảng mới, nó KHÔNG
// sửa bảng đã tồn tại. Nên mỗi lần schema có thêm cột thì phải khai ở đây,
// không thì ai đã chạy bản trước sẽ gặp lỗi "no such column".
//
// SQLite báo lỗi nếu cột đã có, nên cứ chạy rồi bỏ qua lỗi đó.
const MIGRATIONS = [
  'ALTER TABLE user_api_keys ADD COLUMN kie_api_key TEXT',
];

function migrate(db) {
  for (const sql of MIGRATIONS) {
    try {
      db.exec(sql);
      console.error(`[db] đã áp migration: ${sql}`);
    } catch (e) {
      // "duplicate column name" = đã áp rồi, đúng như mong đợi.
      if (!/duplicate column name/i.test(e.message)) {
        console.error(`[db] migration lỗi: ${sql}\n     ${e.message}`);
      }
    }
  }
}

let _db = null;

export function getDb() {
  if (_db) return _db;
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(UPLOAD_DIR, { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec(readFileSync(join(here, 'schema.sql'), 'utf8'));
  migrate(db);
  _db = db;
  return db;
}

/** Danh sách bảng thật trong file DB — dùng để chặn tên bảng client bịa ra. */
export function listTables() {
  return getDb()
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map(r => r.name);
}

/** Cột của một bảng, theo thứ tự khai báo. */
export function columnsOf(table) {
  return getDb().prepare(`PRAGMA table_info("${table}")`).all().map(r => r.name);
}
