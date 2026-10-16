import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Hai chế độ, dùng CHUNG một đoạn mã:
//
//   LOCAL (mặc định)  — không cần cấu hình gì. Client trỏ về server local
//                       ở cùng origin; server đó nói đúng giao thức PostgREST
//                       + GoTrue trên một file SQLite trong ./data.
//   SUPABASE          — khai VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY trong
//                       .env.local là tự chuyển sang, không sửa code.
//
// Vì sao vẫn dùng `supabase-js` ở bản local thay vì viết client riêng: toàn bộ
// app đã gọi qua nó (gần 90 chỗ `.from()`), và nó tự lo session, retry, kiểu
// dữ liệu. Giữ nguyên thư viện thì đổi local <-> cloud chỉ là đổi URL.

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** true khi đang nói chuyện với Supabase thật. */
export const isRemoteSupabase = !!(SUPABASE_URL && SUPABASE_ANON_KEY);

/** true khi đang dùng server local. */
export const isLocalMode = !isRemoteSupabase;

/** Giữ lại tên cũ: app dùng cờ này để biết "đã có backend chưa".
 *  Bản local thì LUÔN có backend, nên luôn true. */
export const isSupabaseConfigured = true;

const BASE_URL = isRemoteSupabase
  ? SUPABASE_URL!
  : (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5174');

// Server local không kiểm tra apikey, nhưng supabase-js bắt buộc phải có một
// chuỗi khác rỗng, nên truyền một giá trị đánh dấu cho dễ đọc khi debug.
const ANON_KEY = isRemoteSupabase ? SUPABASE_ANON_KEY! : 'local-anon-key';

let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!_client) {
    _client = createClient(BASE_URL, ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: isRemoteSupabase,
      },
    });
  }
  return _client;
}

/** Bản local chỉ có một người dùng nên không cần màn hình đăng nhập: tự tạo
 *  session khi chưa có. Vẫn đi qua `auth.signInWithPassword` để supabase-js
 *  tự lưu session và tự gắn token cho mọi truy vấn sau đó — nhờ vậy những
 *  chỗ gọi `auth.getUser()` trong app không phải sửa gì.
 *
 *  Trả về true nếu sau lệnh này đã có session. */
export async function ensureLocalSession(): Promise<boolean> {
  if (isRemoteSupabase) return false;
  const sb = getSupabase();
  const { data } = await sb.auth.getSession();
  if (data.session) return true;
  const { error } = await sb.auth.signInWithPassword({
    email: 'local@banner.studio',
    password: 'local',
  });
  if (error) {
    console.error('[local] không tạo được session local', error);
    return false;
  }
  return true;
}
