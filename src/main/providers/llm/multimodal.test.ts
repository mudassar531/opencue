import { describe, expect, it } from 'vitest';
import { transformAnthropicMessage } from './anthropic';
import { transformOpenAiMessage } from './openai';

const PNG_DATA_URL = 'data:image/png;base64,AAAA';

describe('transformOpenAiMessage', () => {
  it('returns plain string content when no images are attached', () => {
    expect(transformOpenAiMessage({ role: 'user', content: 'hello' })).toEqual({
      role: 'user',
      content: 'hello',
    });
  });

  it('builds the multimodal parts array when images are present', () => {
    const out = transformOpenAiMessage({
      role: 'user',
      content: 'what is on my screen?',
      images: [{ dataUrl: PNG_DATA_URL }],
    });
    expect(out.role).toBe('user');
    expect(Array.isArray(out.content)).toBe(true);
    const parts = out.content as { type: string; text?: string; image_url?: { url: string } }[];
    expect(parts[0]).toEqual({ type: 'text', text: 'what is on my screen?' });
    expect(parts[1]).toEqual({ type: 'image_url', image_url: { url: PNG_DATA_URL } });
  });

  it('appends image captions as additional text parts before the image', () => {
    const out = transformOpenAiMessage({
      role: 'user',
      content: 'q',
      images: [{ dataUrl: PNG_DATA_URL, caption: 'meeting tab' }],
    });
    const parts = out.content as { type: string; text?: string }[];
    expect(parts[1]?.text).toBe('meeting tab');
  });
});

describe('transformAnthropicMessage', () => {
  it('returns string content when no images attached', () => {
    expect(transformAnthropicMessage({ role: 'user', content: 'hi' })).toEqual({
      role: 'user',
      content: 'hi',
    });
  });

  it('produces base64 image parts then the text', () => {
    const out = transformAnthropicMessage({
      role: 'user',
      content: 'describe',
      images: [{ dataUrl: PNG_DATA_URL }],
    });
    expect(out.role).toBe('user');
    const parts = out.content as Array<
      { type: 'text'; text: string } | { type: 'image'; source: { media_type: string; data: string } }
    >;
    expect(parts[0]?.type).toBe('image');
    expect(parts[parts.length - 1]).toEqual({ type: 'text', text: 'describe' });
    const imagePart = parts[0] as { type: 'image'; source: { media_type: string; data: string } };
    expect(imagePart.source.media_type).toBe('image/png');
    expect(imagePart.source.data).toBe('AAAA');
  });

  it('skips images with malformed data URLs', () => {
    const out = transformAnthropicMessage({
      role: 'user',
      content: 'x',
      images: [{ dataUrl: 'not-a-data-url' }],
    });
    const parts = out.content as Array<{ type: string }>;
    expect(parts.length).toBe(1);
    expect(parts[0]?.type).toBe('text');
  });

  it('maps assistant role through unchanged', () => {
    expect(transformAnthropicMessage({ role: 'assistant', content: 'ok' })).toEqual({
      role: 'assistant',
      content: 'ok',
    });
  });
});
