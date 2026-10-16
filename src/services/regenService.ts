// Shared background regen service. BannerTool + HistoryPage both use it so
// a regen submitted from HistoryEditModal has ONE persistence pipeline —
// localStorage-backed task list, cross-page visibility, F5-survivable.
//
// The service handles: persist task, kick off async gen, mirror image via
// storage local, insert history row on success, and mark task errored/timed-out
// otherwise. Callers subscribe via callbacks + a browser CustomEvent so any
// mounted panel can display live status.

import { HistoryItem, RegenRetryPayload, FeatureType, UploadedImage, StoredImageRef } from '../types';
import { generateBannerWithCoachio } from './coachioService';
import { addHistoryToCloud } from './historyService';
import { proxiedBannerUrl } from './cdnProxy';
import { dataUrlOrUrlToUploadedImage } from './imageUtils';
import { uploadToStorage } from './uploadService';
import { buildEditPrompt } from './editPromptBuilder';
import { generateBannerWithOpenai, getOpenaiApiKey } from './openaiImageService';
import { withOpenaiFallback, fallbackSuccessNotice } from './genFallback';

export interface PendingRegenTask {
  taskId: string;
  startedAt: number;
  payload: RegenRetryPayload;
  status?: 'error' | 'timeout';
  errorMsg?: string;
}

export const PENDING_TASKS_KEY = 'bannerAds:pendingRegenTasks';
export const REGEN_EVENT = 'regen:tick';

export function readPendingRegenTasks(): PendingRegenTask[] {
  try {
    const raw = localStorage.getItem(PENDING_TASKS_KEY);
    return raw ? (JSON.parse(raw) as PendingRegenTask[]) : [];
  } catch {
    return [];
  }
}

export function savePendingRegenTasks(tasks: PendingRegenTask[]): void {
  try {
    localStorage.setItem(PENDING_TASKS_KEY, JSON.stringify(tasks));
    window.dispatchEvent(new CustomEvent(REGEN_EVENT));
  } catch (e) {
    console.warn('Persist pending regen tasks failed', e);
  }
}

/** Remove a task from pending. Used when a caller cancels or acknowledges
 *  an errored task without retry. */
export function removePendingRegenTask(taskId: string): void {
  savePendingRegenTasks(readPendingRegenTasks().filter(t => t.taskId !== taskId));
}

/** Convert a pending task → a HistoryItem placeholder shape the grid can
 *  render as a loading tile. Same shape as the ones BannerTool inserts
 *  directly into its history state. */
export function pendingToHistoryPlaceholder(t: PendingRegenTask): HistoryItem {
  const p = t.payload;
  const commonPromptUsed = p.prompt ? `Edit: ${p.prompt}` : 'Chỉnh sửa từ bản trước';
  return {
    id: t.taskId,
    imageUrl: '',
    promptUsed: commonPromptUsed,
    timestamp: t.startedAt,
    model: p.sourceModel,
    quality: p.quality,
    aspectRatio: p.aspectRatio,
    parentId: p.sourceParentId,
    version: p.sourceVersion,
    featureType: (p.sourceFeatureType as FeatureType) || 'banner',
    sessionId: p.sessionId,
    pendingStatus: t.status || 'loading',
    pendingError: t.errorMsg,
    retryPayload: p,
  };
}

export interface RegenCallbacks {
  /** Called immediately with a placeholder HistoryItem. Panel should show
   *  it as a loading tile. */
  onPlaceholder?: (placeholder: HistoryItem) => void;
  /** Success — persisted DB row is the argument. */
  onSuccess?: (saved: HistoryItem) => void;
  /** Error / timeout. Payload lets the caller offer a retry button. */
  onError?: (taskId: string, kind: 'error' | 'timeout', errorMsg: string, payload: RegenRetryPayload) => void;
  /** Thông tin không phải lỗi — VD đã tự chuyển sang OpenAI vì Coachio hỏng. */
  onNotice?: (taskId: string, msg: string) => void;
}

/** Đẩy ảnh user upload lên CDN để payload retry serialize được. Ảnh nào
 *  upload lỗi thì bỏ qua field url — bản in-memory vẫn dùng được cho lần gen
 *  này, chỉ mất khi retry sau F5. */
export async function mirrorEditRefsToCdn(extras: UploadedImage[]): Promise<StoredImageRef[]> {
  return Promise.all(extras.map(async (img, idx): Promise<StoredImageRef> => {
    const meta: StoredImageRef = { fileName: img.file?.name || `edit-ref-${idx}.png`, mimeType: img.mimeType };
    try {
      const { url } = await uploadToStorage(img.file, 'refs');
      return { ...meta, url };
    } catch (e) {
      console.warn('[regen] mirror edit ref to CDN failed — retry after reload will lose it', e);
      return meta;
    }
  }));
}

/** Dựng lại UploadedImage từ refs đã persist (đường retry sau F5). */
export async function restoreEditRefs(refs: StoredImageRef[] | undefined): Promise<UploadedImage[]> {
  if (!refs?.length) return [];
  const restored = await Promise.all(refs.map(async (r, idx) => {
    const source = r.url || r.base64;
    if (!source) return null;
    try {
      return await dataUrlOrUrlToUploadedImage(source, r.fileName || `edit-ref-${idx}.png`);
    } catch (e) {
      console.warn('[regen] restore edit ref failed', r, e);
      return null;
    }
  }));
  return restored.filter(Boolean) as UploadedImage[];
}

/** Kick off 1 async regen with 5-min timeout. Persists to localStorage,
 *  fires callbacks along the way, and returns the task/placeholder id. */
export function startBackgroundRegen(
  payload: RegenRetryPayload,
  opts: {
    fallbackModel?: string;
    callbacks?: RegenCallbacks;
    /** Ảnh user vừa upload trong modal edit. Có File nên không serialize
     *  được — service tự mirror lên CDN rồi ghi lại vào payload đã persist. */
    extras?: UploadedImage[];
  } = {},
): string {
  const fallbackModel = opts.fallbackModel || 'gpt_image_2';
  const cb = opts.callbacks || {};
  const inMemoryExtras = opts.extras || [];
  const {
    sourceItemId, sourceImageUrl, sourceModel, sourcePromptUsed,
    sourceParentId, sourceVersion, sourceFeatureType, sourceAspectRatio,
    prompt: adj, aspectRatio: ar, quality: qual, sessionId,
  } = payload;

  const placeholderId = Math.random().toString(36).substring(7);
  const commonPromptUsed = adj ? `Edit: ${adj}` : 'Chỉnh sửa từ bản trước';

  // 1. Persist for F5 survival.
  savePendingRegenTasks([
    ...readPendingRegenTasks(),
    { taskId: placeholderId, startedAt: Date.now(), payload },
  ]);

  // 2. Emit placeholder immediately so the UI shows a loading tile.
  const placeholder: HistoryItem = {
    id: placeholderId,
    imageUrl: '',
    promptUsed: commonPromptUsed,
    timestamp: Date.now(),
    model: sourceModel,
    quality: qual,
    aspectRatio: ar,
    parentId: sourceParentId,
    version: sourceVersion,
    featureType: (sourceFeatureType as FeatureType) || 'banner',
    sessionId,
    pendingStatus: 'loading',
  };
  cb.onPlaceholder?.(placeholder);

  // 3. Async gen — 2-min race removed in favor of 5-min to match server limits.
  (async () => {
    try {
      const source = proxiedBannerUrl(sourceImageUrl);
      const base = await dataUrlOrUrlToUploadedImage(source, `base-${sourceItemId}.png`);
      if (!base) throw new Error('Không tải được ảnh gốc làm reference');

      // Ưu tiên ảnh còn trong memory (vừa upload); nếu không có (retry sau
      // F5) thì dựng lại từ refs đã mirror lên CDN.
      let extras = inMemoryExtras;
      if (extras.length > 0 && !payload.editRefs?.length) {
        // Mirror lên CDN + ghi lại vào task đã persist để retry giữ được refs.
        const stored = await mirrorEditRefsToCdn(extras);
        payload.editRefs = stored;
        savePendingRegenTasks(readPendingRegenTasks().map(t => t.taskId === placeholderId
          ? { ...t, payload: { ...t.payload, editRefs: stored } }
          : t));
      } else if (extras.length === 0) {
        extras = await restoreEditRefs(payload.editRefs);
      }

      // Ảnh gốc LUÔN là reference (canvas được sửa). Ảnh user upload đầu tiên
      // đóng vai product/focus mới; các ảnh còn lại là reference bổ sung.
      // Không upload gì thì ảnh gốc đóng cả 2 vai như trước.
      const productImage = extras[0] ?? base;
      const extraRefs = extras.slice(1);

      const combinedPrompt = buildEditPrompt({
        editInstruction: adj,
        originalPrompt: sourcePromptUsed,
        extraRefCount: extras.length,
        sourceAspectRatio,
        targetAspectRatio: ar,
      });

      const isItemCoachioModel = sourceModel === 'gpt_image_2' || sourceModel === 'google_image_gen_banana_pro';
      const modelForBackend = isItemCoachioModel ? sourceModel : fallbackModel;
      // History phải ghi đúng model đã tạo ra ảnh, không phải model định dùng.
      let usedFallbackModel = '';

      const start = Date.now();
      // Coachio hỏng phía họ thì chạy lại bằng OpenAI — task nền không có ai
      // ngồi canh để bấm đổi backend.
      const genPromise = withOpenaiFallback<string>({
        fallbackAvailable: !!getOpenaiApiKey(),
        onNotice: (m) => cb.onNotice?.(placeholderId, m),
        primary: () => generateBannerWithCoachio(
          base, productImage, combinedPrompt, '',
          ar, qual, modelForBackend,
          undefined, extraRefs,
        ),
        fallback: () => generateBannerWithOpenai(
          { logo: null, styleRefs: [base, ...extraRefs].filter(Boolean), productRef: productImage },
          combinedPrompt, '', ar, qual,
        ),
      }).then(out => {
        if (out.usedFallback) {
          usedFallbackModel = `openai-gpt-image-2-${String(qual).toLowerCase()}`;
          cb.onNotice?.(placeholderId, fallbackSuccessNotice(out.primaryError));
        }
        return out.result;
      });
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Timeout 5 phút — banner có thể vẫn đang tạo phía server. Bấm Tạo lại để thử.')), 5 * 60 * 1000);
      });
      const imageUrl = await Promise.race([genPromise, timeoutPromise]);
      const duration = (Date.now() - start) / 1000;

      const saved = await addHistoryToCloud({
        id: placeholderId,
        imageUrl,
        promptUsed: combinedPrompt,
        timestamp: Date.now(),
        duration,
        model: usedFallbackModel || modelForBackend,
        quality: qual,
        aspectRatio: ar,
        parentId: sourceParentId,
        version: sourceVersion,
        featureType: (sourceFeatureType as FeatureType) || 'banner',
        sessionId,
      });

      // Clean pending list + notify caller.
      savePendingRegenTasks(readPendingRegenTasks().filter(t => t.taskId !== placeholderId));
      cb.onSuccess?.(saved);
    } catch (err: any) {
      console.error('Background regen failed', err);
      const isTimeout = (err?.message || '').includes('Timeout');
      const errorMsg = err?.message || 'unknown';
      // Keep task in localStorage with error status so user can retry.
      savePendingRegenTasks(readPendingRegenTasks().map(t => t.taskId === placeholderId
        ? { ...t, status: isTimeout ? 'timeout' : 'error', errorMsg }
        : t));
      cb.onError?.(placeholderId, isTimeout ? 'timeout' : 'error', errorMsg, payload);
    }
  })();

  return placeholderId;
}
