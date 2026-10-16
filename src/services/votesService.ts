import { VotedBanner } from '../types';
import { getSupabase } from './supabaseClient';
import { uploadDataUrlToStorage } from './uploadService';

function rowToVote(row: any): VotedBanner {
  return {
    id: row.id,
    imageUrl: row.image_url,
    promptUsed: row.prompt_used || '',
    brandContent: row.brand_content || '',
    bannerType: row.banner_type || 'general',
    aspectRatio: row.aspect_ratio || '1:1',
    model: row.model || '',
    votedAt: row.voted_at ? new Date(row.voted_at).getTime() : Date.now(),
  };
}

async function requireUserId(): Promise<string> {
  const { data: { user } } = await getSupabase().auth.getUser();
  if (!user) throw new Error('Chưa đăng nhập');
  return user.id;
}

export async function listVotesFromCloud(): Promise<VotedBanner[]> {
  try {
    const { data, error } = await getSupabase()
      .from('voted_banners')
      .select('*')
      .order('voted_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(rowToVote);
  } catch (e) {
    console.warn('listVotesFromCloud failed', e);
    return [];
  }
}

export async function addVoteToCloud(vote: VotedBanner): Promise<VotedBanner> {
  const userId = await requireUserId();

  let imageUrl = vote.imageUrl;
  if (imageUrl.startsWith('data:')) {
    const uploaded = await uploadDataUrlToStorage(imageUrl, `voted-${vote.id}.png`, 'banners');
    imageUrl = uploaded.url;
  }

  const row = {
    id: vote.id,
    user_id: userId,
    image_url: imageUrl,
    prompt_used: vote.promptUsed,
    brand_content: vote.brandContent,
    banner_type: vote.bannerType,
    aspect_ratio: vote.aspectRatio,
    model: vote.model,
    voted_at: vote.votedAt ? new Date(vote.votedAt).toISOString() : new Date().toISOString(),
  };
  const { error } = await getSupabase().from('voted_banners').upsert(row, { onConflict: 'id' });
  if (error) throw error;
  return { ...vote, imageUrl };
}

export async function removeVoteFromCloud(id: string): Promise<void> {
  const { error } = await getSupabase().from('voted_banners').delete().eq('id', id);
  if (error) throw error;
}

export async function isVotedInCloud(id: string): Promise<boolean> {
  const { data, error } = await getSupabase()
    .from('voted_banners')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (error) return false;
  return !!data;
}
