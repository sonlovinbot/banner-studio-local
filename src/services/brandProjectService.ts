import { BrandProject, LibraryImage } from '../types';
import { getSupabase } from './supabaseClient';
import { uploadDataUrlToStorage } from './uploadService';

async function requireUserId(): Promise<string> {
  const { data: { user } } = await getSupabase().auth.getUser();
  if (!user) throw new Error('Chưa đăng nhập');
  return user.id;
}

function rowToProject(r: any): BrandProject {
  return {
    id: r.id,
    name: r.name,
    brandInfo: r.brand_info || '',
    eventInfo: r.event_info || '',
    jsonPrompt: r.json_prompt || '',
    logo: r.logo || undefined,
    styleReferences: r.style_references || [],
    productReferences: r.product_references || [],
    scrapedUrl: r.scraped_url || undefined,
    scrapedSummary: r.scraped_summary || undefined,
    scrapedAt: r.scraped_at ? new Date(r.scraped_at).getTime() : undefined,
    createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
    updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : Date.now(),
  };
}

/**
 * For each image in the array, if it has a base64 (legacy local) but no URL,
 * upload to storage local and replace with URL. If storage local upload fails, keep base64 in
 * the output so the row still persists the image data (Supabase JSONB holds it)
 * and reload can render via `img.url || img.base64`. Never silently drop.
 */
async function ensureImagesOnCloud(images: LibraryImage[], folder: 'logo' | 'refs' | 'products'): Promise<LibraryImage[]> {
  const out: LibraryImage[] = [];
  for (const img of images) {
    if (img.url) {
      out.push({ id: img.id, url: img.url, fileName: img.fileName, mimeType: img.mimeType, addedAt: img.addedAt });
      continue;
    }
    if (img.base64) {
      try {
        const upload = await uploadDataUrlToStorage(
          img.base64,
          img.fileName || `${folder}-${img.id}.jpg`,
          folder as any,
        );
        out.push({
          id: img.id,
          url: upload.url,
          fileName: img.fileName || `${folder}-${img.id}.jpg`,
          mimeType: upload.mime || img.mimeType,
          addedAt: img.addedAt,
        });
      } catch (e) {
        console.warn('[brand] storage local upload failed — keeping base64 as fallback', e);
        out.push({
          id: img.id,
          base64: img.base64,
          fileName: img.fileName,
          mimeType: img.mimeType,
          addedAt: img.addedAt,
        });
      }
    }
  }
  return out;
}

async function ensureLogoOnCloud(logo: LibraryImage | undefined): Promise<LibraryImage | undefined> {
  if (!logo) return undefined;
  const arr = await ensureImagesOnCloud([logo], 'logo');
  return arr[0];
}

export async function listBrandProjectsFromCloud(): Promise<BrandProject[]> {
  try {
    const { data, error } = await getSupabase()
      .from('brand_projects')
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(rowToProject);
  } catch (e) {
    console.warn('listBrandProjectsFromCloud failed', e);
    return [];
  }
}

export async function saveBrandProjectToCloud(project: BrandProject): Promise<BrandProject> {
  const userId = await requireUserId();

  // Make sure all images are URL-based on storage local (upload base64 if any)
  const [logo, styleRefs, productRefs] = await Promise.all([
    ensureLogoOnCloud(project.logo),
    ensureImagesOnCloud(project.styleReferences || [], 'refs'),
    ensureImagesOnCloud(project.productReferences || [], 'products'),
  ]);

  const row = {
    id: project.id,
    user_id: userId,
    name: project.name,
    brand_info: project.brandInfo || null,
    event_info: project.eventInfo || null,
    json_prompt: project.jsonPrompt || null,
    logo: logo || null,
    style_references: styleRefs,
    product_references: productRefs,
    scraped_url: project.scrapedUrl || null,
    scraped_summary: project.scrapedSummary || null,
    scraped_at: project.scrapedAt ? new Date(project.scrapedAt).toISOString() : null,
    created_at: project.createdAt ? new Date(project.createdAt).toISOString() : new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { error } = await getSupabase().from('brand_projects').upsert(row, { onConflict: 'id' });
  if (error) throw error;

  return {
    ...project,
    logo,
    styleReferences: styleRefs,
    productReferences: productRefs,
    updatedAt: Date.now(),
  };
}

export async function deleteBrandProjectFromCloud(id: string): Promise<void> {
  const { error } = await getSupabase().from('brand_projects').delete().eq('id', id);
  if (error) throw error;
}

export async function bulkMigrateBrandProjects(projects: BrandProject[]): Promise<{ inserted: number; skipped: number }> {
  if (projects.length === 0) return { inserted: 0, skipped: 0 };
  let inserted = 0;
  let skipped = 0;
  for (const p of projects) {
    try {
      // Check if already exists in cloud
      const { data: existing } = await getSupabase().from('brand_projects').select('id').eq('id', p.id).maybeSingle();
      if (existing) {
        skipped++;
        continue;
      }
      await saveBrandProjectToCloud(p);
      inserted++;
    } catch (e) {
      console.warn('bulkMigrateBrandProjects: skip project', p.id, e);
      skipped++;
    }
  }
  return { inserted, skipped };
}
