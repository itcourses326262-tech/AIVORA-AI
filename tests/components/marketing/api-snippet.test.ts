import { describe, expect, it } from 'vitest';
import {
  requestLines,
  responseLines,
  snippetText,
  type SnippetOptions,
} from '@/components/marketing/api-snippet';

const options: SnippetOptions = {
  origin: 'https://aivore.example',
  modelId: 'fal-flux-schnell',
  cost: 3,
};

describe('the cURL example', () => {
  const text = snippetText(requestLines(options));

  it('copies as exactly the text that is shown', () => {
    expect(text.split('\n')[0]).toBe('curl -X POST https://aivore.example/api/v1/generations \\');
    expect(text).toContain('-H "Authorization: Bearer $AIVORE_API_KEY" \\');
    expect(text).toContain('-H "Content-Type: application/json" \\');
  });

  it('carries a request body that is valid JSON for POST /generations', () => {
    const body = text.slice(text.indexOf("-d '") + 4, text.lastIndexOf("'"));
    expect(JSON.parse(body)).toEqual({
      tool: 'text-to-image',
      modelId: 'fal-flux-schnell',
      prompt: 'A lighthouse at dawn, soft fog, cinematic',
      params: { aspectRatio: '16:9' },
    });
  });

  it('shows a response in the API envelope with the cost of the request', () => {
    const response = JSON.parse(snippetText(responseLines(options))) as {
      data: { status: string; cost: number };
    };
    expect(response.data).toMatchObject({ status: 'queued', cost: 3 });
  });

  it('never ships an API key', () => {
    expect(text).not.toMatch(/avk_/);
  });
});
