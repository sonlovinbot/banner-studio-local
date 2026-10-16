-- Schema SQLite cho bản chạy local.
--
-- Sinh từ chính schema Postgres của bản cloud nên tên bảng/cột khớp y hệt —
-- nhờ vậy client local dùng chung được mọi câu truy vấn mà component đang gọi,
-- và chuyển qua lại cloud/local không phải sửa code.
--
-- Khác biệt so với Postgres, đều cố ý:
--   jsonb/ARRAY  -> TEXT   (lưu JSON chuỗi; client tự parse)
--   boolean      -> INTEGER (0/1)
--   timestamptz  -> TEXT   (ISO 8601, so sánh chuỗi vẫn đúng thứ tự)
--   KHÔNG có RLS — máy local một người dùng; phân quyền do server lo.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS "banner_history" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL,
  "image_url" TEXT NOT NULL,
  "prompt_used" TEXT,
  "duration" REAL,
  "model" TEXT,
  "quality" TEXT,
  "aspect_ratio" TEXT,
  "parent_id" TEXT,
  "version" INTEGER DEFAULT 1,
  "created_at" TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "feature_type" TEXT NOT NULL DEFAULT 'banner',
  "session_id" TEXT,
  "gen_params" TEXT,
  "is_favorite" INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS "brand_briefs" (
  "id" TEXT PRIMARY KEY,
  "brand_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "brief_type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "primary_message" TEXT,
  "headline" TEXT,
  "primary_text" TEXT,
  "cta" TEXT,
  "tone_notes" TEXT,
  "source_url" TEXT,
  "is_selected" INTEGER NOT NULL DEFAULT 0,
  "position" INTEGER NOT NULL DEFAULT 100,
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "updated_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "subline" TEXT,
  "cta_text" TEXT,
  "badges" TEXT
);

CREATE TABLE IF NOT EXISTS "brand_projects" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "brand_info" TEXT,
  "event_info" TEXT,
  "json_prompt" TEXT,
  "logo" TEXT,
  "style_references" TEXT DEFAULT '[]',
  "product_references" TEXT DEFAULT '[]',
  "created_at" TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "updated_at" TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "scraped_url" TEXT,
  "scraped_summary" TEXT,
  "scraped_at" TEXT
);

CREATE TABLE IF NOT EXISTS "brand_snippets" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "added_at" TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS "library_images" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "file_name" TEXT,
  "mime_type" TEXT,
  "added_at" TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS "profiles" (
  "id" TEXT PRIMARY KEY,
  "email" TEXT NOT NULL,
  "display_name" TEXT,
  "avatar_url" TEXT,
  "created_at" TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS "url_crawl_briefs" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL,
  "source_url" TEXT NOT NULL,
  "brief_type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "primary_message" TEXT,
  "headline" TEXT,
  "primary_text" TEXT,
  "cta" TEXT,
  "tone_notes" TEXT,
  "is_enabled" INTEGER NOT NULL DEFAULT 1,
  "position" INTEGER NOT NULL DEFAULT 100,
  "crawled_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "subline" TEXT,
  "cta_text" TEXT,
  "badges" TEXT
);

CREATE TABLE IF NOT EXISTS "user_api_keys" (
  -- Cloud dùng user_id làm khoá chính; giữ nguyên để upsert hoạt động.
  "user_id" TEXT PRIMARY KEY,
  "coachio_api_key" TEXT,
  "updated_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "firecrawl_api_key" TEXT,
  -- Chỉ có ở bản local: KIE là cổng gom API nhiều model (Nano Banana, Veo...).
  "kie_api_key" TEXT
);

CREATE TABLE IF NOT EXISTS "voted_banners" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL,
  "image_url" TEXT NOT NULL,
  "prompt_used" TEXT,
  "brand_content" TEXT,
  "banner_type" TEXT,
  "aspect_ratio" TEXT,
  "model" TEXT,
  "voted_at" TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Index cho các truy vấn hay dùng: liệt kê theo thời gian, lọc theo tool.
CREATE INDEX IF NOT EXISTS idx_history_created   ON banner_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_history_feature   ON banner_history(feature_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_history_session   ON banner_history(session_id);
CREATE INDEX IF NOT EXISTS idx_history_parent    ON banner_history(parent_id);
CREATE INDEX IF NOT EXISTS idx_library_category  ON library_images(category, added_at DESC);
CREATE INDEX IF NOT EXISTS idx_briefs_brand      ON brand_briefs(brand_id, created_at DESC);
