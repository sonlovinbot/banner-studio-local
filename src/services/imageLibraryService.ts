import { LibraryImage, LibraryCategory } from '../types';
import { getSupabase } from './supabaseClient';
import { uploadToStorage, uploadDataUrlToStorage, StorageFolder } from './uploadService';

async function requireUserId(): Promise<string> {
  const { data: { user } } = await getSupabase().auth.getUser();
  if (!user) throw new Error('Chưa đăng nhập');
  return user.id;
}

function rowToImage(r: any): LibraryImage {
  return {
    id: r.id,
    url: r.url,
    fileName: r.file_name || '',
    mimeType: r.mime_type || 'image/jpeg',
    addedAt: r.added_at ? new Date(r.added_at).getTime() : Date.now(),
  };
}

const folderForCategory = (c: LibraryCategory | 'logo' | 'video'): StorageFolder =>
  ({ ref: 'refs', prod: 'products', face: 'face', logo: 'logo', video: 'videos' } as const)[c];

/** Video chỉ khác ảnh ở chỗ không nén — uploadService tự bỏ qua nén cho
 *  file không phải image/*, nên dùng chung một đường. */
export async function addVideoToLibrary(file: File): Promise<LibraryImage> {
  const allowed = new Set(['video/mp4', 'video/webm', 'video/quicktime']);
  if (!allowed.has(file.type)) {
    throw new Error(`Định dạng video không hỗ trợ: ${file.type || 'không rõ'}. Dùng MP4 / WebM / MOV.`);
  }
  return addFileToLibrary(file, 'video' as LibraryCategory);
}

export async function listLibraryFromCloud(category: LibraryCategory | 'logo' | 'video'): Promise<LibraryImage[]> {
  try {
    const { data, error } = await getSupabase()
      .from('library_images')
      .select('*')
      .eq('category', category)
      .order('added_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(rowToImage);
  } catch (e) {
    console.warn('listLibraryFromCloud failed', e);
    return [];
  }
}

export async function addFileToLibrary(file: File, category: LibraryCategory | 'logo' | 'video'): Promise<LibraryImage> {
  const userId = await requireUserId();
  const upload = await uploadToStorage(file, folderForCategory(category));
  const id = Math.random().toString(36).substring(7);
  const row = {
    id,
    user_id: userId,
    category,
    url: upload.url,
    file_name: file.name,
    mime_type: upload.mime,
    added_at: new Date().toISOString(),
  };
  const { error } = await getSupabase().from('library_images').insert(row);
  if (error) throw error;
  return rowToImage(row);
}

export async function addDataUrlToLibrary(
  dataUrl: string,
  fileName: string,
  category: LibraryCategory | 'logo',
): Promise<LibraryImage> {
  const userId = await requireUserId();
  const upload = await uploadDataUrlToStorage(dataUrl, fileName, folderForCategory(category));
  const id = Math.random().toString(36).substring(7);
  const row = {
    id,
    user_id: userId,
    category,
    url: upload.url,
    file_name: fileName,
    mime_type: upload.mime,
    added_at: new Date().toISOString(),
  };
  const { error } = await getSupabase().from('library_images').insert(row);
  if (error) throw error;
  return rowToImage(row);
}

export async function removeLibraryItemFromCloud(id: string): Promise<void> {
  const { error } = await getSupabase().from('library_images').delete().eq('id', id);
  if (error) throw error;
}

export async function bulkMigrateLibrary(
  items: LibraryImage[],
  category: LibraryCategory | 'logo',
): Promise<{ inserted: number; skipped: number }> {
  if (items.length === 0) return { inserted: 0, skipped: 0 };
  let inserted = 0;
  let skipped = 0;
  for (const it of items) {
    try {
      const { data: exists } = await getSupabase()
        .from('library_images').select('id').eq('id', it.id).maybeSingle();
      if (exists) { skipped++; continue; }
      if (it.base64) {
        await addDataUrlToLibrary(it.base64, it.fileName || `lib-${it.id}.jpg`, category);
        inserted++;
      } else if (it.url) {
        // already a URL — insert metadata only
        const userId = await requireUserId();
        const { error } = await getSupabase().from('library_images').insert({
          id: it.id,
          user_id: userId,
          category,
          url: it.url,
          file_name: it.fileName || null,
          mime_type: it.mimeType || null,
          added_at: it.addedAt ? new Date(it.addedAt).toISOString() : new Date().toISOString(),
        });
        if (error) throw error;
        inserted++;
      } else {
        skipped++;
      }
    } catch (e) {
      console.warn('bulkMigrateLibrary skip', it.id, e);
      skipped++;
    }
  }
  return { inserted, skipped };
}
