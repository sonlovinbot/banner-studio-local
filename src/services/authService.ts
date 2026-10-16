import type { Session, User } from '@supabase/supabase-js';
import { getSupabase, isSupabaseConfigured } from './supabaseClient';

export type AuthUser = User;
export type AuthSession = Session;

export interface AuthProfile {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
}

export async function getCurrentSession(): Promise<AuthSession | null> {
  if (!isSupabaseConfigured) return null;
  const { data } = await getSupabase().auth.getSession();
  return data.session;
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  if (!isSupabaseConfigured) return null;
  const { data } = await getSupabase().auth.getUser();
  return data.user;
}

export async function signUpWithEmail(email: string, password: string, displayName?: string) {
  const { data, error } = await getSupabase().auth.signUp({
    email,
    password,
    options: {
      data: displayName ? { display_name: displayName } : undefined,
    },
  });
  if (error) throw error;
  return data;
}

export async function signInWithEmail(email: string, password: string) {
  const { data, error } = await getSupabase().auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signInWithMagicLink(email: string) {
  const { data, error } = await getSupabase().auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin },
  });
  if (error) throw error;
  return data;
}

export async function signOut(): Promise<void> {
  const { error } = await getSupabase().auth.signOut();
  if (error) throw error;
}

export function onAuthChange(cb: (user: AuthUser | null) => void): () => void {
  if (!isSupabaseConfigured) return () => {};
  const { data } = getSupabase().auth.onAuthStateChange((_event, session) => {
    cb(session?.user ?? null);
  });
  return () => data.subscription.unsubscribe();
}

export async function getProfile(userId: string): Promise<AuthProfile | null> {
  const { data, error } = await getSupabase()
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    console.warn('getProfile failed', error);
    return null;
  }
  return data as AuthProfile | null;
}

export async function updateProfile(userId: string, patch: Partial<Pick<AuthProfile, 'display_name' | 'avatar_url'>>) {
  const { error } = await getSupabase().from('profiles').update(patch).eq('id', userId);
  if (error) throw error;
}
