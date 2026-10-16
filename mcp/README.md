# MCP server — nối Banner Studio với Claude Desktop / Codex

MCP (Model Context Protocol) là cách để app chat gọi được công cụ bên ngoài.
Server này cho Claude đọc thư viện banner của bạn và tạo ảnh mới.

Nó chạy **trên máy bạn**, qua stdio (app chat tự khởi động nó như một tiến
trình con). Không mở cổng mạng nào, không đăng nhập, không gửi gì lên internet
ngoài chính lệnh gọi API sinh ảnh.

Nó đọc **cùng một file** `data/app.db` mà web app đang dùng. Nên ảnh Claude tạo
ra hiện ngay trong History của app, và Claude thấy luôn mọi banner bạn đã làm.

## Cài

```bash
node mcp/install.mjs
```

Rồi **thoát hẳn** Claude Desktop và mở lại. Đóng cửa sổ là chưa đủ — phải thoát
app (macOS: `Cmd+Q`).

Thử hỏi Claude:

> Trong Banner Studio của tôi có bao nhiêu banner?
>
> Tìm trong Banner Studio các banner về workshop.
>
> Tạo cho tôi một banner tỷ lệ 16:9: nền gradient tím, chữ "Khai giảng 20/11".

## Cài bằng tay

Script trên chỉ ghi vào file cấu hình. Muốn tự làm hoặc dùng app khác:

**Claude Desktop** — `claude_desktop_config.json`:
- macOS: `~/Library/Application Support/Claude/`
- Windows: `%APPDATA%\Claude\`
- Linux: `~/.config/Claude/`

```json
{
  "mcpServers": {
    "banner-studio-local": {
      "command": "node",
      "args": ["/duong/dan/tuyet/doi/den/banner-studio-local/mcp/server.mjs"]
    }
  }
}
```

**Codex CLI** — `~/.codex/config.toml`:

```toml
[mcp_servers.banner-studio-local]
command = "node"
args = ["/duong/dan/tuyet/doi/den/banner-studio-local/mcp/server.mjs"]
```

**Claude Code**:

```bash
claude mcp add banner-studio-local -- node /duong/dan/tuyet/doi/den/mcp/server.mjs
```

Đường dẫn **phải tuyệt đối**. App chat chạy từ thư mục khác nên đường dẫn
tương đối sẽ không tìm thấy file. Lấy đường dẫn đúng:

```bash
node -e "console.log(require('path').resolve('mcp/server.mjs'))"
```

Nếu `node` không nằm trong PATH mà app chat thấy được (hay gặp khi dùng nvm),
thay `"node"` bằng đường dẫn đầy đủ — `which node` sẽ in ra.

## Các tool

| Tool | Việc nó làm |
|---|---|
| `list_banners` | Liệt kê banner, mới nhất trước. Lọc theo công cụ, theo yêu thích, có phân trang |
| `search_banners` | Tìm banner theo nội dung prompt |
| `get_banner` | Chi tiết một banner, kèm tham số đã dùng khi tạo |
| `list_brands` | Danh sách brand đã lưu — để Claude viết prompt đúng giọng brand |
| `stats` | Tổng số banner, số theo từng công cụ, số brand |
| `set_favorite` | Đánh dấu / bỏ đánh dấu yêu thích |
| `generate_banner` | Tạo ảnh mới qua KIE.ai, lưu vào máy và ghi vào History |

`generate_banner` cần **KIE API key** — đặt `KIE_API_KEY` trong `.env.local`,
hoặc nhập ở Settings → API Keys trong app. Các tool chỉ đọc thì không cần key.

Ảnh tạo qua MCP vào History ở tab **Banner MCP**, không lẫn vào tab Tất cả.

## Khi không chạy

**Claude báo "server disconnected"**

Chạy thử bằng tay để xem lỗi thật:

```bash
node mcp/server.mjs
```

Phải in ra `[banner-studio-local] MCP server đang chạy qua stdio` rồi đứng chờ
(đó là bình thường — nó đang đợi lệnh trên stdin). `Ctrl+C` để thoát.

Lỗi `Cannot find module` nghĩa là chưa `npm install`.

**Claude không thấy tool nào**

Kiểm tra file cấu hình đúng chỗ chưa, đường dẫn có tuyệt đối không, và đã
thoát hẳn Claude Desktop rồi mở lại chưa.

**Claude thấy tool nhưng gọi thì lỗi**

Mở log của Claude Desktop:
`~/Library/Logs/Claude/mcp-server-banner-studio-local.log` (macOS).

## Một lưu ý khi tự viết thêm tool

**Không bao giờ `console.log` trong file này.** stdout là kênh truyền JSON-RPC;
in thêm một dòng vào đó là app chat mất kết nối ngay mà chỉ báo chung chung
"server disconnected". Cần log thì dùng `console.error` (ra stderr, app chat
ghi vào file log).
