import { generateKeyPairSync } from 'node:crypto';

let cachedKey: string | undefined;

/** A real, throw-away RSA key made at test time: nothing key-shaped is ever committed. */
export function throwawayPrivateKey(): string {
  cachedKey ??= generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  }).privateKey;
  return cachedKey;
}

export interface ServiceAccountFixture {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
}

export function serviceAccountFixture(
  overrides: Partial<Record<keyof ServiceAccountFixture, unknown>> = {},
): Record<string, unknown> {
  return {
    type: 'service_account',
    project_id: 'demo-project',
    private_key_id: 'k'.repeat(30),
    private_key: throwawayPrivateKey(),
    client_email: 'firebase-adminsdk-test@demo-project.iam.gserviceaccount.com',
    client_id: '1'.repeat(21),
    ...overrides,
  };
}

/** Lines of the key body (without the armor), enough to recognise a leak by any 24-character slice. */
export function keyFragments(privateKey: string): string[] {
  const body = privateKey.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
  const parts: string[] = [];
  for (let at = 0; at + 24 <= body.length; at += 24) parts.push(body.slice(at, at + 24));
  return parts;
}
