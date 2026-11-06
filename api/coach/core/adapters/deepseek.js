/* DeepSeek — OpenAI-compatible Chat Completions at a fixed base URL.
 * Same wire shape as openai.js, with the two things DeepSeek documents: `max_tokens` (not
 * `max_completion_tokens`) and greedy decoding for a deterministic plan diff, the same way
 * compatible.js pins temperature 0. */
import { httpAdapter } from './http.js';
import { chatCompletionsSpec } from './openai.js';

export const deepseekSpec = chatCompletionsSpec('deepseek', { maxTokensField: 'max_tokens', temperature: 0 });
export default httpAdapter(deepseekSpec);
