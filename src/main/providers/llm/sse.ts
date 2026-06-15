/**
 * Generic Server-Sent Events parser for the OpenAI / Groq / Gemini SSE streams.
 *
 * Each provider's `/v1/chat/completions` stream returns lines like:
 *
 *   data: {"id":"…","choices":[{"delta":{"content":"hello"}}]}
 *   data: {"id":"…","choices":[{"delta":{"content":" world"}}]}
 *   data: [DONE]
 *
 * The helper handles partial frames split across `read()` calls and yields
 * one `data:` payload (string) at a time. It does NOT parse JSON — callers
 * decide what to do with `[DONE]` vs a JSON-looking payload.
 */

export async function* readSseLines(
  response: Response,
  signal?: AbortSignal,
): AsyncGenerator<string, void, void> {
  if (!response.body) {
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  const cleanup = (): void => {
    try {
      void reader.cancel();
    } catch {
      /* ignore */
    }
  };

  if (signal) {
    if (signal.aborted) {
      cleanup();
      return;
    }
    signal.addEventListener('abort', cleanup, { once: true });
  }

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, '');
        buffer = buffer.slice(newlineIndex + 1);
        const trimmed = line.trim();
        if (trimmed.startsWith('data:')) {
          yield trimmed.slice(5).trimStart();
        }
        newlineIndex = buffer.indexOf('\n');
      }
    }
    const tail = buffer.trim();
    if (tail.startsWith('data:')) {
      yield tail.slice(5).trimStart();
    }
  } finally {
    cleanup();
  }
}
