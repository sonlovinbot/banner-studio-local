// Phiên bản hiện ở Dashboard. Đổi số ở đây khi phát hành bản mới.
export const APP_VERSION = '1.0.0';
export const APP_VERSION_NAME = 'Bản local cho học viên';
export const APP_RELEASE_DATE = '2026-10-16';

export const APP_CHANGELOG: { version: string; date: string; highlights: string[] }[] = [
  {
    version: '1.0.0',
    date: '2026-10-16',
    highlights: [
      'Chạy hoàn toàn trên máy: dữ liệu nằm trong một file SQLite ở ./data/app.db',
      'Server local nói giao thức PostgREST + GoTrue nên không cần Supabase, mà vẫn bật được Supabase sau',
      'Ảnh và video lưu vào ./data/uploads, không cần CDN hay bucket nào',
      'Bốn API gắn sẵn: Coachio, OpenAI, KIE.ai, Firecrawl',
      'MCP server local qua stdio — Claude Desktop / Codex đọc được thư viện banner và sinh ảnh mới',
      'Banner Tool, UGC Studio, Brand Style, History (có tab Yêu thích, phân trang, URL giữ được khi F5)',
    ],
  },
];
