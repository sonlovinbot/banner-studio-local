#!/usr/bin/env node
// `npm run dev` — chạy server local và Vite cùng lúc trong một terminal.
//
// Tự viết thay vì dùng `concurrently` để học viên không phải cài thêm gói,
// và để Ctrl-C tắt gọn cả hai tiến trình.

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const children = [];

function run(label, cmd, args) {
  const child = spawn(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  child.on('exit', (code, signal) => {
    if (signal) return;
    console.log(`\n[${label}] đã dừng (code ${code}). Tắt luôn tiến trình còn lại.`);
    shutdown();
  });
  children.push(child);
  return child;
}

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    try { c.kill('SIGTERM'); } catch { /* đã tắt */ }
  }
  setTimeout(() => process.exit(0), 200);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

run('server', process.execPath, [join(root, 'server', 'index.mjs')]);
// Chờ một nhịp để server kịp bind cổng trước khi Vite proxy vào nó.
setTimeout(() => {
  run('vite', 'npx', ['vite']);
  console.log('\n  Giao diện: http://localhost:3100\n');
}, 400);
