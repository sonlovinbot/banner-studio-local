#!/usr/bin/env node
// Gắn MCP server này vào Claude Desktop / Codex / Cursor.
//
// Chạy:  node mcp/install.mjs
//
// Việc nó làm: thêm một mục vào file cấu hình của app chat, trỏ tới
// mcp/server.mjs bằng ĐƯỜNG DẪN TUYỆT ĐỐI (các app đó chạy từ thư mục khác
// nên đường dẫn tương đối sẽ không tìm thấy file). File cũ được sao lưu trước
// khi sửa, và mục nào khác của bạn đều giữ nguyên.

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_PATH = join(dirname(fileURLToPath(import.meta.url)), 'server.mjs');
const SERVER_NAME = 'banner-studio-local';
const HOME = homedir();

/** Vị trí file cấu hình của từng app, theo hệ điều hành. */
function targets() {
  const os = platform();
  const list = [];

  if (os === 'darwin') {
    list.push({
      app: 'Claude Desktop',
      path: join(HOME, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
      key: 'mcpServers',
    });
  } else if (os === 'win32') {
    list.push({
      app: 'Claude Desktop',
      path: join(process.env.APPDATA || join(HOME, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json'),
      key: 'mcpServers',
    });
  } else {
    list.push({
      app: 'Claude Desktop',
      path: join(HOME, '.config', 'Claude', 'claude_desktop_config.json'),
      key: 'mcpServers',
    });
  }

  // Codex CLI dùng TOML nên không sửa tự động được an toàn — chỉ in hướng dẫn.
  list.push({
    app: 'Claude Code',
    path: join(HOME, '.claude.json'),
    key: 'mcpServers',
    optional: true,
  });

  return list;
}

const entry = {
  command: process.execPath,   // đúng bản node đang chạy script này
  args: [SERVER_PATH],
};

function install({ app, path, key, optional }) {
  let config = {};
  if (existsSync(path)) {
    try {
      config = JSON.parse(readFileSync(path, 'utf8'));
    } catch (e) {
      console.log(`  ✗ ${app}: file cấu hình không phải JSON hợp lệ (${path})`);
      console.log(`    ${e.message}`);
      console.log('    Sửa file đó rồi chạy lại, hoặc thêm tay theo hướng dẫn ở cuối.');
      return false;
    }
    // Sao lưu trước khi sửa — cấu hình này có thể đang chứa nhiều server khác.
    copyFileSync(path, `${path}.backup`);
  } else if (optional) {
    console.log(`  – ${app}: chưa thấy ${path}, bỏ qua`);
    return false;
  } else {
    mkdirSync(dirname(path), { recursive: true });
  }

  config[key] = config[key] || {};
  const existed = !!config[key][SERVER_NAME];
  config[key][SERVER_NAME] = entry;
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n');
  console.log(`  ✓ ${app}: ${existed ? 'đã cập nhật' : 'đã thêm'} "${SERVER_NAME}"`);
  console.log(`    ${path}`);
  return true;
}

console.log('\nGắn Banner Studio MCP vào app chat\n');
console.log(`  server: ${SERVER_PATH}`);
console.log(`  node:   ${process.execPath}\n`);

let anyDone = false;
for (const t of targets()) {
  if (install(t)) anyDone = true;
}

console.log(`
Bước cuối: TẮT HẲN rồi mở lại Claude Desktop (đóng cửa sổ là chưa đủ, phải
thoát app). Sau đó thử hỏi: "Trong Banner Studio của tôi có bao nhiêu banner?"

Thêm tay (Codex CLI dùng TOML — ~/.codex/config.toml):

  [mcp_servers.${SERVER_NAME}]
  command = "${process.execPath}"
  args = ["${SERVER_PATH}"]

Hoặc dạng JSON cho app nào dùng JSON:

  "${SERVER_NAME}": {
    "command": "${process.execPath}",
    "args": ["${SERVER_PATH}"]
  }
`);

if (!anyDone) {
  console.log('Chưa sửa được file nào — dùng phần "Thêm tay" ở trên.\n');
  process.exitCode = 1;
}
