import { HistoryItem } from '../types';

// Snapshot history đi kèm source code. Mặc định để rỗng.
//
// Muốn ship sẵn một bộ banner mẫu: vào History → Export JSON, rồi dán mảng
// JSON đó vào đây. Trên máy mới, trang History sẽ hiện nút "Restore snapshot".
export const EMBEDDED_HISTORY: HistoryItem[] = [];
