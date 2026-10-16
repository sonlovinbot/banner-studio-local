# Banner Studio (bản local)

Công cụ tạo banner quảng cáo bằng AI, chạy **hoàn toàn trên máy bạn**.
Không cần đăng ký dịch vụ nào, không cần deploy, không có hoá đơn hàng tháng.
Dữ liệu nằm trong một file duy nhất: `data/app.db`.

Có bốn công cụ:

| Công cụ | Dùng để làm gì |
|---|---|
| **Banner Tool** | Tạo banner quảng cáo từ prompt + ảnh mẫu (style, sản phẩm, logo) |
| **UGC Studio** | Tạo ảnh UGC giữ nguyên khuôn mặt một người qua nhiều bối cảnh |
| **Brand Style** | Lưu bộ nhận diện: logo, ảnh mẫu, giọng điệu. Nhập được từ một URL |
| **History** | Xem lại, sửa, đánh dấu yêu thích mọi ảnh đã tạo |

Kèm theo một **MCP server** để Claude Desktop / Codex đọc được thư viện banner
của bạn và tạo ảnh mới ngay trong cuộc trò chuyện.

---

## Cần có trước

- **Node.js phiên bản 22.5 trở lên.** Kiểm tra: `node -v`.
  Chưa có hoặc cũ hơn thì tải ở [nodejs.org](https://nodejs.org) (chọn bản LTS).
  Bản này dùng SQLite có sẵn trong Node, nên không phải cài thêm thư viện nào
  cần biên dịch — `npm install` sẽ không bao giờ hỏng vì khâu đó.
- **Một API key để sinh ảnh.** Không có key thì app vẫn mở được và xem được
  mọi thứ, chỉ là chưa tạo ảnh mới. Xem phần [API key](#api-key) bên dưới.

## Chạy lần đầu

```bash
npm install
npm run dev
```

Mở http://localhost:3100 — vào thẳng app, **không cần đăng nhập**.

Lệnh `npm run dev` chạy hai thứ cùng lúc:

- **Cổng 5174** — server local: database, lưu ảnh, gọi API.
- **Cổng 3100** — giao diện.

Màn hình trắng hoặc hiện "Chưa kết nối được server local"? Nghĩa là bạn chạy
`vite` một mình. Dùng `npm run dev` để chạy cả hai.

## API key

Sao chép file mẫu rồi điền key nào bạn có:

```bash
cp .env.example .env.local
```

Hoặc nhập trực tiếp trong app: **Settings → API Keys**. Hai cách đều được;
key đặt trong `.env.local` được ưu tiên.

| Key | Dùng cho | Lấy ở đâu |
|---|---|---|
| Coachio | Banner Tool, UGC Studio (đường chính) | [studio.coachio.ai](https://studio.coachio.ai) |
| OpenAI | Chất lượng 2K/4K, và dự phòng khi Coachio lỗi | [platform.openai.com](https://platform.openai.com/api-keys) |
| KIE.ai | Một key chạy nhiều model (Nano Banana, Veo, Suno) | [kie.ai/api-key](https://kie.ai/api-key) |
| Firecrawl | Nhập nội dung từ một URL ở Brand Style | [firecrawl.dev](https://firecrawl.dev/app/api-keys) |

Cần đúng **một** key trong hai key đầu là tạo được banner. Ba key còn lại thêm
tính năng chứ không bắt buộc.

> **Lưu ý về KIE:** KIE chỉ sinh ảnh **từ prompt**, không nhận ảnh mẫu. Vì KIE
> tải ảnh mẫu bằng cách truy cập một URL công khai, mà ảnh của bạn nằm ở
> `localhost` nên máy chủ của họ không với tới được. Cần bám theo ảnh mẫu thì
> dùng Coachio hoặc OpenAI.

## Các lệnh

| Lệnh | Việc nó làm |
|---|---|
| `npm run dev` | Chạy server + giao diện (dùng lệnh này khi đang làm việc) |
| `npm test` | Chạy bộ test (58 test, trên DB tạm — không chạm dữ liệu thật) |
| `npm run lint` | Kiểm tra kiểu TypeScript |
| `npm run build` | Build giao diện ra `dist/` |
| `npm start` | Build rồi chạy mọi thứ trên **một** cổng 5174 |
| `npm run mcp` | Chạy MCP server (thường không cần — app chat tự chạy) |

## Dữ liệu của bạn nằm ở đâu

```
data/
├── app.db          ← toàn bộ database (SQLite)
└── uploads/        ← ảnh và video đã tạo hoặc upload
    ├── banners/
    ├── refs/
    └── ...
```

Sao lưu = copy thư mục `data/`. Xoá sạch để làm lại = xoá thư mục `data/`
(lần chạy sau nó tự tạo lại).

Thư mục `data/` đã nằm trong `.gitignore` nên không bị commit lên Git.

## Nối với Claude Desktop (MCP)

```bash
node mcp/install.mjs
```

Script này tự thêm cấu hình vào Claude Desktop. Sau đó **thoát hẳn** Claude
Desktop rồi mở lại (đóng cửa sổ là chưa đủ) và thử hỏi:

> Trong Banner Studio của tôi có bao nhiêu banner?

Chi tiết và cách thêm tay: [mcp/README.md](mcp/README.md).

## Bật Supabase sau (không bắt buộc)

Mặc định dữ liệu nằm local. Muốn chuyển sang Supabase thật để nhiều người dùng
chung thì điền hai dòng này trong `.env.local`:

```
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

Không phải sửa một dòng code nào. App thấy có hai biến đó là tự chuyển sang
chế độ cloud, và màn hình đăng nhập thật sẽ xuất hiện.

Lý do đổi được dễ như vậy: server local nói **đúng giao thức của Supabase**
(PostgREST cho dữ liệu, GoTrue cho đăng nhập), nên thư viện `supabase-js`
trong app chạy y nguyên ở cả hai chế độ. Việc duy nhất thay đổi là URL.

Bảng của bản local có tên cột khớp hệt bản cloud, nên schema dùng lại được.
Xem `server/db/schema.sql`.

## Cấu trúc thư mục

```
index.html            điểm vào của giao diện
src/
├── App.tsx           định tuyến trang
├── components/       giao diện React
├── services/         gọi API, truy vấn DB, xử lý ảnh
└── types.ts          kiểu dữ liệu dùng chung
server/
├── index.mjs         server local — gom mọi thứ vào một tiến trình
├── rest.mjs          /rest/v1/*  — PostgREST trên SQLite
├── auth.mjs          /auth/v1/*  — đăng nhập (một người dùng)
├── apiRoutes.mjs     /api/*      — lưu key, Firecrawl, KIE
├── upload.mjs        /api/upload — ghi file vào data/uploads
└── db/
    ├── schema.sql    định nghĩa bảng
    ├── query.mjs     dịch truy vấn PostgREST sang SQL
    ├── columns.mjs   cầu nối kiểu JSON ↔ SQLite
    └── open.mjs      mở DB, áp schema, chạy migration
mcp/
├── server.mjs        MCP server (stdio)
├── install.mjs       gắn vào Claude Desktop
└── README.md
tests/                bộ test (chỉ dùng node:test, không framework)
```

## Gặp lỗi

**`Cổng 5174 đang bị một tiến trình khác dùng`**
Server đã chạy ở terminal khác. Tắt nó: `lsof -ti:5174 | xargs kill`
Hoặc đổi cổng: `PORT=5175 npm run dev`

**Màn hình trắng, hoặc "Chưa kết nối được server local"**
Dùng `npm run dev`, đừng chạy `vite` một mình.

**`SQLite is an experimental feature`**
Chỉ là cảnh báo của Node, không phải lỗi. Bỏ qua được.

**Tạo banner báo hết credit mà tài khoản vẫn còn tiền**
Thông báo đó nói về ví **Coachio**, không phải ví OpenAI. Nạp ở
studio.coachio.ai, hoặc thêm key OpenAI rồi chọn backend OpenAI.

**Ảnh trong History hiện hình vỡ**
File ảnh trong `data/uploads/` đã bị xoá nhưng hàng dữ liệu vẫn còn. Xoá
banner đó trong History.

## Giấy phép

Dùng cho mục đích học tập.
