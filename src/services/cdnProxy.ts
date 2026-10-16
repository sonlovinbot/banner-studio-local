// Bản local không có CDN. Ảnh được lưu thẳng vào ./data/uploads và server
// local phục vụ chúng ở /files/..., nên không cần rewrite host nào cả.
//
// File vẫn giữ nguyên tên + nguyên chữ ký hàm để mọi chỗ gọi không phải sửa.
// Nếu sau này bạn gắn CDN thật, chỉ cần đổi thân hàm ở đây.

/** Trả về URL dùng được để <img src>. Local: giữ nguyên. */
export function proxiedBannerUrl(url: string | undefined | null): string {
  return url || '';
}
