// Coachio LLM streaming chat completions.
// Spec: POST https://api.coachio.ai/api/v1/llm/chat/completions
// Auth: X-API-Key header
// Stream: SSE, lines "data: <json>" + "data: [DONE]"

import { getCoachioApiKey } from './coachioService';

const URL = 'https://api.coachio.ai/api/v1/llm/chat/completions';
export const DEFAULT_MODEL = 'google/gemini-3.1-flash-lite';

export type LLMContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'input_audio'; input_audio: { data: string; format: string } }
  | { type: 'video_url'; video_url: { url: string } };

export type LLMRole = 'system' | 'user' | 'assistant' | 'tool';

export interface LLMMessage {
  role: LLMRole;
  content: string | LLMContentPart[];
}

export interface LLMUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  model?: string;
}

export interface ChatStreamChunk {
  delta?: string;
  usage?: LLMUsage;
  done?: boolean;
}

export class CoachioLLMError extends Error {
  status: number;
  category: 'auth' | 'credits' | 'rate-limit' | 'request' | 'server' | 'unknown';
  constructor(message: string, status: number, category: CoachioLLMError['category']) {
    super(message);
    this.status = status;
    this.category = category;
  }
}

function mapError(status: number, bodyText: string): CoachioLLMError {
  if (status === 401) return new CoachioLLMError('Coachio API key không hợp lệ hoặc hết hạn.', 401, 'auth');
  if (status === 402) return new CoachioLLMError('Tài khoản Coachio không đủ credit.', 402, 'credits');
  if (status === 413) return new CoachioLLMError('Request body quá lớn — nén ảnh hoặc dùng URL.', 413, 'request');
  if (status === 429) return new CoachioLLMError('Bị giới hạn rate, chờ vài giây rồi thử lại.', 429, 'rate-limit');
  if (status >= 500) return new CoachioLLMError(`Server Coachio lỗi (${status}).`, status, 'server');
  if (status >= 400) {
    let detail = bodyText.slice(0, 200);
    try { const j = JSON.parse(bodyText); detail = j.error || j.message || detail; } catch {}
    return new CoachioLLMError(`Yêu cầu không hợp lệ: ${detail}`, status, 'request');
  }
  return new CoachioLLMError(`Lỗi không xác định (${status}).`, status, 'unknown');
}

export async function* chatStream(
  messages: LLMMessage[],
  opts?: {
    model?: string;
    apiKey?: string;
    temperature?: number;
    max_tokens?: number;
    signal?: AbortSignal;
  },
): AsyncGenerator<ChatStreamChunk> {
  const apiKey = opts?.apiKey || getCoachioApiKey();
  if (!apiKey) throw new CoachioLLMError('Chưa cấu hình Coachio API key trong Settings.', 401, 'auth');

  const res = await fetch(URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify({
      model: opts?.model || DEFAULT_MODEL,
      messages,
      stream: true,
      temperature: opts?.temperature ?? 0.7,
      max_tokens: opts?.max_tokens ?? 8192,
    }),
    signal: opts?.signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw mapError(res.status, text);
  }

  if (!res.body) {
    throw new CoachioLLMError('Server không trả về stream body.', 500, 'server');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || !line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') {
        yield { done: true };
        return;
      }
      try {
        const json = JSON.parse(payload);
        const delta = json.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta.length > 0) yield { delta };
        if (json.usage) yield { usage: json.usage };
      } catch {
        // skip malformed chunk
      }
    }
  }
  yield { done: true };
}

/** Convenience: collect full text without streaming UI. */
export async function chatComplete(
  messages: LLMMessage[],
  opts?: Parameters<typeof chatStream>[1],
): Promise<{ text: string; usage?: LLMUsage }> {
  let text = '';
  let usage: LLMUsage | undefined;
  for await (const chunk of chatStream(messages, opts)) {
    if (chunk.delta) text += chunk.delta;
    if (chunk.usage) usage = chunk.usage;
  }
  return { text, usage };
}
