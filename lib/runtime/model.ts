/**
 * Real `ModelClient` backed by lib/llm.ts. The engine drives against the
 * `ModelClient` seam; tests inject a mock instead. Provider/model selection and
 * the native-tools request live entirely in llm.ts (`streamChatWithTools`).
 */
import { streamChatWithTools, type Provider } from '@/lib/llm';
import type { ModelClient } from './types';

export function makeProviderClient(provider: Provider, model?: string): ModelClient {
  return (system, messages, tools, onDelta) =>
    streamChatWithTools(provider, system, messages, tools, model, onDelta);
}
