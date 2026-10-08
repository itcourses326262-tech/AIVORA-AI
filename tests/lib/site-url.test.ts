import { describe, expect, it } from 'vitest';
import { metadataBaseFor } from '@/lib/site-url';

describe('metadataBaseFor', () => {
  it('returns the origin of an http(s) URL', () => {
    expect(metadataBaseFor('https://aivore.example.com')?.href).toBe('https://aivore.example.com/');
    expect(metadataBaseFor('http://localhost:3000')?.href).toBe('http://localhost:3000/');
  });

  it('drops a path, query and credentials: only the origin is a base', () => {
    expect(metadataBaseFor('https://user:pw@aivore.example.com:8443/app?x=1#top')?.href).toBe(
      'https://aivore.example.com:8443/',
    );
  });

  it.each(['', undefined, 'not a url', '/relative', 'ftp://example.com', 'javascript:alert(1)'])(
    'is undefined for %j instead of throwing',
    (value) => {
      expect(metadataBaseFor(value)).toBeUndefined();
    },
  );
});
