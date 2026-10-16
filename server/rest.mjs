// Endpoint /rest/v1/* — nói đúng giao thức PostgREST để `supabase-js` chạy
// nguyên bản, không phải sửa một dòng nào trong app.
//
// Hỗ trợ đúng những gì app dùng (đã soát từ mã nguồn):
//   GET    + filter/order/limit/offset/Range/Prefer: count=exact
//   HEAD   (dạng `head: true` của select — chỉ lấy số đếm)
//   POST   insert, kèm upsert qua `Prefer: resolution=merge-duplicates`
//   PATCH  update theo filter
//   DELETE xoá theo filter
//   Accept: application/vnd.pgrst.object+json  (.single() / .maybeSingle())
//
// Toán tử nào chưa hỗ trợ thì trả lỗi rõ ràng (xem query.mjs) chứ không im
// lặng trả sai — sai âm thầm ở tầng này cực khó lần ra từ phía UI.

import { getDb, listTables, columnsOf } from './db/open.mjs';
import { buildSelect, buildWhereOnly, ident } from './db/query.mjs';
import { rowToDb, rowFromDb } from './db/columns.mjs';

/** Tham số điều khiển, không phải filter cột. */
const CONTROL_KEYS = new Set(['select', 'order', 'limit', 'offset', 'or', 'on_conflict', 'columns']);

function pgrstError(res, status, message, hint) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ message, hint: hint || null, code: String(status) }));
}

/** `Range: 0-39` của .range(from, to) → limit/offset. */
function parseRange(header) {
  if (!header) return {};
  const m = /^(\d+)-(\d*)$/.exec(header.trim());
  if (!m) return {};
  const from = Number(m[1]);
  if (!m[2]) return { offset: from };
  return { offset: from, limit: Number(m[2]) - from + 1 };
}

function prefers(req) {
  const raw = (req.headers['prefer'] || '').toString().toLowerCase();
  return {
    representation: raw.includes('return=representation'),
    exactCount: raw.includes('count=exact'),
    mergeDuplicates: raw.includes('resolution=merge-duplicates'),
    ignoreDuplicates: raw.includes('resolution=ignore-duplicates'),
  };
}

function wantsObject(req) {
  return (req.headers['accept'] || '').toString().includes('vnd.pgrst.object');
}

/** Chặn tên bảng client gửi — chỉ nhận bảng có thật trong schema. */
function checkTable(table) {
  if (!listTables().includes(table)) {
    throw Object.assign(new Error(`Bảng không tồn tại: ${table}`), { status: 404 });
  }
}

/** Lọc bỏ field client gửi mà bảng không có cột tương ứng.
 *  Bản cloud có thể thừa cột so với schema local (hoặc ngược lại); thà bỏ qua
 *  field lạ còn hơn để cả câu insert vỡ. */
function pickColumns(table, row) {
  const cols = columnsOf(table);
  const out = {};
  const dropped = [];
  for (const [k, v] of Object.entries(row)) {
    if (cols.includes(k)) out[k] = v;
    else dropped.push(k);
  }
  if (dropped.length) {
    console.warn(`[rest] ${table}: bỏ qua field không có trong schema: ${dropped.join(', ')}`);
  }
  return out;
}

function insertSql(table, row, { onConflict, ignoreDuplicates, mergeDuplicates }) {
  const keys = Object.keys(row);
  const cols = keys.map(ident).join(', ');
  const marks = keys.map(() => '?').join(', ');
  let conflict = '';
  if (ignoreDuplicates) {
    conflict = ' ON CONFLICT DO NOTHING';
  } else if (mergeDuplicates) {
    const target = onConflict ? ` (${onConflict.split(',').map(s => ident(s.trim())).join(', ')})` : '';
    const sets = keys.map(k => `${ident(k)} = excluded.${ident(k)}`).join(', ');
    conflict = ` ON CONFLICT${target} DO UPDATE SET ${sets}`;
  }
  return `INSERT INTO ${ident(table)} (${cols}) VALUES (${marks})${conflict}`;
}

export function handleRest(req, res, url) {
  const table = url.pathname.replace(/^\/rest\/v1\//, '').split('/')[0];
  const qs = url.searchParams;
  const pref = prefers(req);

  try {
    checkTable(table);
  } catch (e) {
    return pgrstError(res, e.status || 400, e.message);
  }

  const db = getDb();

  // ───── GET / HEAD: select ─────
  if (req.method === 'GET' || req.method === 'HEAD') {
    const range = parseRange(req.headers['range']);
    let plan;
    try {
      plan = buildSelect(table, qs, {
        wantCount: pref.exactCount,
        offset: range.offset,
        limit: range.limit,
      });
    } catch (e) {
      return pgrstError(res, 400, e.message, 'Toán tử không hỗ trợ ở server local');
    }

    let total = null;
    if (plan.countSql) {
      total = db.prepare(plan.countSql).get(...plan.countParams).n;
    }

    // head: true chỉ cần số đếm — không chạy câu select cho nhanh.
    if (req.method === 'HEAD') {
      const from = range.offset || 0;
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Range': `${from}-${Math.max(from, (total ?? 0) - 1)}/${total ?? '*'}`,
      });
      return res.end();
    }

    const rows = db.prepare(plan.sql).all(...plan.params).map(r => rowFromDb(table, r));

    if (wantsObject(req)) {
      if (rows.length === 0) {
        // .maybeSingle() coi 406/PGRST116 là "không có hàng" và trả null.
        res.writeHead(406, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned',
          details: 'Results contain 0 rows', hint: null,
        }));
      }
      res.writeHead(200, { 'Content-Type': 'application/vnd.pgrst.object+json' });
      return res.end(JSON.stringify(rows[0]));
    }

    const from = range.offset || 0;
    const to = Math.max(from, from + rows.length - 1);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Range': `${from}-${to}/${total ?? '*'}`,
    });
    return res.end(JSON.stringify(rows));
  }

  // ───── POST: insert / upsert ─────
  if (req.method === 'POST') {
    const body = req.jsonBody;
    const rows = Array.isArray(body) ? body : [body];
    if (rows.length === 0) {
      res.writeHead(201, { 'Content-Type': 'application/json' });
      return res.end('[]');
    }
    const onConflict = qs.get('on_conflict');
    const inserted = [];
    try {
      db.exec('BEGIN');
      for (const raw of rows) {
        const row = rowToDb(table, pickColumns(table, raw));
        const sql = insertSql(table, row, {
          onConflict,
          ignoreDuplicates: pref.ignoreDuplicates,
          mergeDuplicates: pref.mergeDuplicates || (!!onConflict && !pref.ignoreDuplicates),
        });
        db.prepare(sql).run(...Object.values(row));
        if (pref.representation) inserted.push(row);
      }
      db.exec('COMMIT');
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch { /* đã rollback */ }
      return pgrstError(res, 400, e.message);
    }

    if (!pref.representation) {
      res.writeHead(201, { 'Content-Type': 'application/json' });
      return res.end();
    }
    // Đọc lại từ DB để trả đúng giá trị default server sinh ra.
    const out = inserted.map(r => {
      if (r.id !== undefined) {
        const back = db.prepare(`SELECT * FROM ${ident(table)} WHERE "id" = ?`).get(r.id);
        if (back) return rowFromDb(table, back);
      }
      return rowFromDb(table, r);
    });
    const payload = wantsObject(req) ? out[0] : out;
    res.writeHead(201, {
      'Content-Type': wantsObject(req) ? 'application/vnd.pgrst.object+json' : 'application/json',
    });
    return res.end(JSON.stringify(payload));
  }

  // ───── PATCH: update theo filter ─────
  if (req.method === 'PATCH') {
    const patch = rowToDb(table, pickColumns(table, req.jsonBody || {}));
    const keys = Object.keys(patch);
    if (keys.length === 0) return pgrstError(res, 400, 'PATCH không có field nào để cập nhật');

    let where;
    try { where = buildWhereOnly(table, qs); }
    catch (e) { return pgrstError(res, 400, e.message); }
    if (!where.sql) {
      return pgrstError(res, 400, 'PATCH không có filter — từ chối để tránh cập nhật toàn bảng');
    }

    const sets = keys.map(k => `${ident(k)} = ?`).join(', ');
    try {
      db.prepare(`UPDATE ${ident(table)} SET ${sets}${where.sql}`)
        .run(...keys.map(k => patch[k]), ...where.params);
    } catch (e) {
      return pgrstError(res, 400, e.message);
    }

    if (!pref.representation) {
      res.writeHead(204);
      return res.end();
    }
    const rows = db.prepare(`SELECT * FROM ${ident(table)}${where.sql}`)
      .all(...where.params).map(r => rowFromDb(table, r));
    res.writeHead(200, {
      'Content-Type': wantsObject(req) ? 'application/vnd.pgrst.object+json' : 'application/json',
    });
    return res.end(JSON.stringify(wantsObject(req) ? rows[0] ?? null : rows));
  }

  // ───── DELETE ─────
  if (req.method === 'DELETE') {
    let where;
    try { where = buildWhereOnly(table, qs); }
    catch (e) { return pgrstError(res, 400, e.message); }
    if (!where.sql) {
      return pgrstError(res, 400, 'DELETE không có filter — từ chối để tránh xoá sạch bảng');
    }
    const doomed = pref.representation
      ? db.prepare(`SELECT * FROM ${ident(table)}${where.sql}`).all(...where.params)
      : [];
    try {
      db.prepare(`DELETE FROM ${ident(table)}${where.sql}`).run(...where.params);
    } catch (e) {
      return pgrstError(res, 400, e.message);
    }
    if (!pref.representation) {
      res.writeHead(204);
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(doomed.map(r => rowFromDb(table, r))));
  }

  return pgrstError(res, 405, `Method ${req.method} không hỗ trợ ở /rest/v1`);
}

export { CONTROL_KEYS };
