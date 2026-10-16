// Dịch truy vấn PostgREST sang SQL của SQLite.
//
// Vì sao làm hẳn giao thức PostgREST thay vì viết một shim giả lập query
// builder: `supabase-js` gửi đi HTTP PostgREST chuẩn. Nếu server local nói
// đúng giao thức đó thì THƯ VIỆN CHẠY NGUYÊN — 87 chỗ gọi `.from()` trong app
// không phải sửa một dòng, và đổi qua lại giữa local và cloud chỉ là đổi URL.
// Viết shim thì mỗi lần app dùng thêm một toán tử lại phải vá.
//
// Chỉ hỗ trợ đúng tập toán tử app đang dùng, đã đếm từ mã nguồn. Toán tử lạ
// báo lỗi rõ ràng thay vì im lặng trả sai.

const OPS = {
  eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=',
  like: 'LIKE', ilike: 'LIKE',           // SQLite LIKE vốn không phân biệt hoa thường
};

/** Tên bảng/cột do client gửi — chỉ cho ký tự an toàn, rồi bọc nháy kép. */
function ident(name) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Tên không hợp lệ: ${name}`);
  }
  return `"${name}"`;
}

/** `(a,b,c)` của `in`, hoặc `{a,b,c}` của `cs` → mảng giá trị. */
function parseList(raw) {
  const inner = raw.replace(/^[({]/, '').replace(/[)}]$/, '');
  if (!inner) return [];
  return inner.split(',').map(s => s.replace(/^"(.*)"$/, '$1'));
}

/** Một mệnh đề `col=op.value`. Trả về SQL + tham số. */
function clause(col, raw) {
  const dot = raw.indexOf('.');
  if (dot === -1) throw new Error(`Thiếu toán tử ở filter "${col}=${raw}"`);
  let op = raw.slice(0, dot);
  let val = raw.slice(dot + 1);

  let negate = false;
  if (op === 'not') {
    // dạng not.<op>.<value>
    const d2 = val.indexOf('.');
    if (d2 === -1) throw new Error(`Thiếu toán tử sau "not" ở "${col}"`);
    negate = true;
    op = val.slice(0, d2);
    val = val.slice(d2 + 1);
  }

  const c = ident(col);
  let built;

  if (op === 'is') {
    const v = val.toLowerCase();
    if (v === 'null')  built = { sql: `${c} IS NULL`, params: [] };
    else if (v === 'true')  built = { sql: `${c} = 1`, params: [] };
    else if (v === 'false') built = { sql: `${c} = 0`, params: [] };
    else throw new Error(`"is" chỉ nhận null/true/false, nhận "${val}"`);
  } else if (op === 'in') {
    const items = parseList(val);
    if (items.length === 0) built = { sql: '0', params: [] };   // IN () luôn sai
    else built = { sql: `${c} IN (${items.map(() => '?').join(',')})`, params: items };
  } else if (op === 'cs') {
    // contains trên cột mảng lưu dạng JSON chuỗi
    built = { sql: `EXISTS (SELECT 1 FROM json_each(${c}) WHERE json_each.value = ?)`,
              params: [parseList(val)[0]] };
  } else if (OPS[op]) {
    built = { sql: `${c} ${OPS[op]} ?`, params: [coerce(val)] };
  } else {
    throw new Error(`Toán tử PostgREST chưa hỗ trợ: "${op}". Hỗ trợ: ${Object.keys(OPS).join(', ')}, is, in, cs, not.*`);
  }

  return negate ? { sql: `NOT (${built.sql})`, params: built.params } : built;
}

/** PostgREST gửi mọi thứ dạng chuỗi; đổi về kiểu SQLite hiểu. */
function coerce(v) {
  if (v === 'true') return 1;
  if (v === 'false') return 0;
  if (v === 'null') return null;
  return v;
}

export function buildSelect(table, qs, opts = {}) {
  const t = ident(table);
  const where = [];
  const params = [];
  const order = [];
  let limit = opts.limit;
  let offset = opts.offset;
  let columns = '*';

  for (const [key, raw] of qs.entries()) {
    if (key === 'select') {
      // `*` hoặc danh sách cột; bỏ qua embed quan hệ (app không dùng)
      columns = raw === '*' ? '*' : raw.split(',').map(s => ident(s.trim())).join(', ');
    } else if (key === 'order') {
      for (const part of raw.split(',')) {
        const [col, ...mods] = part.split('.');
        const dir = mods.includes('desc') ? 'DESC' : 'ASC';
        const nulls = mods.includes('nullslast') ? ' NULLS LAST'
                    : mods.includes('nullsfirst') ? ' NULLS FIRST' : '';
        order.push(`${ident(col)} ${dir}${nulls}`);
      }
    } else if (key === 'limit') {
      limit = Number(raw);
    } else if (key === 'offset') {
      offset = Number(raw);
    } else if (key === 'or') {
      // or=(a.eq.1,b.eq.2)
      const parts = parseOrGroup(raw);
      where.push(`(${parts.map(p => p.sql).join(' OR ')})`);
      for (const p of parts) params.push(...p.params);
    } else {
      const c = clause(key, raw);
      where.push(c.sql);
      params.push(...c.params);
    }
  }

  const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const orderSql = order.length ? ` ORDER BY ${order.join(', ')}` : '';
  let tail = '';
  if (limit !== undefined)  tail += ` LIMIT ${Number(limit)}`;
  if (offset !== undefined) tail += ` OFFSET ${Number(offset)}`;

  return {
    sql: `SELECT ${columns} FROM ${t}${whereSql}${orderSql}${tail}`,
    params,
    countSql: opts.wantCount ? `SELECT COUNT(*) AS n FROM ${t}${whereSql}` : undefined,
    countParams: opts.wantCount ? [...params] : undefined,
    single: !!opts.single,
  };
}

/** `or=(a.eq.1,b.eq.2)` — tách ở dấu phẩy ngoài cùng, không cắt trong ngoặc. */
function parseOrGroup(raw) {
  const inner = raw.replace(/^\(/, '').replace(/\)$/, '');
  const parts = [];
  let depth = 0, cur = '';
  for (const ch of inner) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur) parts.push(cur);
  return parts.map(p => {
    const i = p.indexOf('.');
    return clause(p.slice(0, i), p.slice(i + 1));
  });
}

export function buildWhereOnly(table, qs) {
  const where = [];
  const params = [];
  for (const [key, raw] of qs.entries()) {
    if (['select', 'order', 'limit', 'offset'].includes(key)) continue;
    if (key === 'or') {
      const parts = parseOrGroup(raw);
      where.push(`(${parts.map(p => p.sql).join(' OR ')})`);
      for (const p of parts) params.push(...p.params);
      continue;
    }
    const c = clause(key, raw);
    where.push(c.sql);
    params.push(...c.params);
  }
  void table;
  return { sql: where.length ? ` WHERE ${where.join(' AND ')}` : '', params };
}

export { ident };
