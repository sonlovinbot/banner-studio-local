// Endpoint /auth/v1/* — bản GoTrue tối giản cho máy local.
//
// Máy local chỉ có MỘT người dùng (chính bạn), nên ở đây KHÔNG có mật khẩu
// thật, không gửi email, không xác thực gì cả: email/mật khẩu nào cũng đăng
// nhập được vào cùng một tài khoản local.
//
// Vì sao vẫn giữ nguyên hình dạng GoTrue thay vì bỏ hẳn đăng nhập: `supabase-js`
// tự lo lưu session, tự gắn `Authorization` cho mọi truy vấn, và app đã gọi
// `auth.getUser()` ở nhiều chỗ. Trả đúng hình dạng đó thì toàn bộ mã nguồn
// chạy y nguyên, và ngày nào bạn đổi sang Supabase thật thì chỉ việc đổi URL.

import { createHmac, randomUUID } from 'node:crypto';
import { getDb } from './db/open.mjs';

export const LOCAL_USER_ID = '00000000-0000-4000-8000-000000000001';
export const LOCAL_EMAIL = process.env.LOCAL_USER_EMAIL || 'local@banner.studio';

// Chỉ dùng để ký token cho chính máy này. Không phải secret bảo mật gì cả —
// server local tin mọi token nó tự phát.
const JWT_SECRET = process.env.LOCAL_JWT_SECRET || 'banner-studio-local-dev-secret';
const TOKEN_TTL = 60 * 60 * 24 * 365; // 1 năm — khỏi phải đăng nhập lại

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function mintJwt(sub, exp) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    sub, aud: 'authenticated', role: 'authenticated', email: LOCAL_EMAIL,
    iss: 'banner-studio-local', iat: Math.floor(Date.now() / 1000), exp,
  }));
  const sig = b64url(createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${sig}`;
}

/** Đảm bảo có hàng profiles cho user local. Gọi mỗi lần đăng nhập. */
function ensureProfile() {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM profiles WHERE id = ?').get(LOCAL_USER_ID);
  if (existing) return existing;
  db.prepare('INSERT INTO profiles (id, email, display_name) VALUES (?, ?, ?)')
    .run(LOCAL_USER_ID, LOCAL_EMAIL, 'Local User');
  return db.prepare('SELECT * FROM profiles WHERE id = ?').get(LOCAL_USER_ID);
}

function userObject() {
  const p = ensureProfile();
  const now = new Date().toISOString();
  return {
    id: LOCAL_USER_ID,
    aud: 'authenticated',
    role: 'authenticated',
    email: p.email,
    email_confirmed_at: p.created_at || now,
    phone: '',
    confirmed_at: p.created_at || now,
    last_sign_in_at: now,
    app_metadata: { provider: 'local', providers: ['local'] },
    user_metadata: {
      display_name: p.display_name || 'Local User',
      avatar_url: p.avatar_url || undefined,
    },
    identities: [],
    created_at: p.created_at || now,
    updated_at: now,
    is_anonymous: false,
  };
}

function sessionObject() {
  const expiresAt = Math.floor(Date.now() / 1000) + TOKEN_TTL;
  return {
    access_token: mintJwt(LOCAL_USER_ID, expiresAt),
    token_type: 'bearer',
    expires_in: TOKEN_TTL,
    expires_at: expiresAt,
    refresh_token: `local-refresh-${randomUUID()}`,
    user: userObject(),
  };
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

export function handleAuth(req, res, url) {
  const path = url.pathname.replace(/^\/auth\/v1/, '') || '/';

  // Đăng nhập + đăng ký + làm mới token: tất cả trả về cùng một session.
  if (path === '/token' || path === '/signup') {
    return json(res, 200, sessionObject());
  }

  if (path === '/user') {
    if (req.method === 'PUT') {
      // updateUser({ data: {...} }) — app dùng để lưu tên hiển thị + avatar.
      const body = req.jsonBody || {};
      const data = body.data || {};
      const db = getDb();
      ensureProfile();
      if ('display_name' in data) {
        db.prepare('UPDATE profiles SET display_name = ? WHERE id = ?')
          .run(data.display_name ?? null, LOCAL_USER_ID);
      }
      if ('avatar_url' in data) {
        db.prepare('UPDATE profiles SET avatar_url = ? WHERE id = ?')
          .run(data.avatar_url ?? null, LOCAL_USER_ID);
      }
      return json(res, 200, userObject());
    }
    return json(res, 200, userObject());
  }

  if (path === '/logout') {
    res.writeHead(204);
    return res.end();
  }

  if (path === '/settings') {
    return json(res, 200, {
      external: {}, disable_signup: false, mailer_autoconfirm: true,
      phone_autoconfirm: false, sms_provider: '', saml_enabled: false,
    });
  }

  // OTP / magic link: máy local không gửi email — nói thẳng thay vì giả vờ
  // đã gửi rồi để user ngồi chờ mãi.
  if (path === '/otp' || path === '/magiclink' || path === '/recover') {
    return json(res, 400, {
      error: 'unsupported',
      error_description: 'Bản local không gửi email. Bấm Đăng nhập là vào luôn.',
      msg: 'Bản local không gửi email. Bấm Đăng nhập là vào luôn.',
    });
  }

  return json(res, 404, { message: `Không có endpoint auth: ${path}` });
}
