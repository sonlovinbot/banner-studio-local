// Bản đồ kiểu cột: SQLite chỉ có TEXT/INTEGER/REAL, còn client nói chuyện
// bằng JSON của Postgres. Hai chỗ lệch nhau cần dịch ở cả hai chiều:
//
//   jsonb / mảng  <->  TEXT    (ghi thì JSON.stringify, đọc thì JSON.parse)
//   boolean       <->  INTEGER (ghi thì 1/0, đọc thì true/false)
//
// Không dịch thì lỗi rất khó thấy: `is_favorite` đọc ra số 0 vẫn "falsy" nên
// UI chạy đúng, nhưng chỗ nào so sánh `=== true` thì sai âm thầm.

/** Cột lưu JSON (jsonb hoặc mảng trong Postgres). */
export const JSON_COLUMNS = {
  banner_history:   ['gen_params'],
  brand_briefs:     ['badges'],
  brand_projects:   ['style_references', 'product_references', 'scraped_summary'],
  url_crawl_briefs: ['badges'],
};

/** Cột boolean. */
export const BOOL_COLUMNS = {
  banner_history:   ['is_favorite'],
  brand_briefs:     ['is_selected'],
  url_crawl_briefs: ['is_enabled'],
};

/** Hàng từ client (JSON) -> hàng ghi vào SQLite. */
export function rowToDb(table, row) {
  const jsonCols = JSON_COLUMNS[table] || [];
  const boolCols = BOOL_COLUMNS[table] || [];
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === undefined) continue;
    if (jsonCols.includes(k)) {
      out[k] = v === null ? null : JSON.stringify(v);
    } else if (boolCols.includes(k)) {
      out[k] = v === null ? null : (v ? 1 : 0);
    } else if (typeof v === 'boolean') {
      // Cột không khai boolean nhưng client gửi boolean — node:sqlite không
      // bind được kiểu này, phải đổi chứ không thì vỡ lúc chạy.
      out[k] = v ? 1 : 0;
    } else if (v !== null && typeof v === 'object') {
      // Object/mảng ở cột chưa khai trong JSON_COLUMNS: vẫn lưu JSON hơn là
      // để node:sqlite ném lỗi kiểu.
      out[k] = JSON.stringify(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Hàng đọc từ SQLite -> JSON trả cho client. */
export function rowFromDb(table, row) {
  if (!row) return row;
  const jsonCols = JSON_COLUMNS[table] || [];
  const boolCols = BOOL_COLUMNS[table] || [];
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (jsonCols.includes(k)) {
      if (v === null || v === undefined || v === '') { out[k] = null; continue; }
      try { out[k] = JSON.parse(v); }
      catch { out[k] = v; }   // dữ liệu cũ không phải JSON — trả nguyên văn
    } else if (boolCols.includes(k)) {
      out[k] = v === null || v === undefined ? null : !!v;
    } else {
      out[k] = v;
    }
  }
  return out;
}
