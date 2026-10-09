// OWNER: storage
import 'server-only';
import { createPrivateKey } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

/** A real key file is about 2.5 KB; anything much bigger is the wrong file. */
const MAX_KEY_FILE_BYTES = 64 * 1024;

export interface ServiceAccount {
  type: 'service_account';
  project_id: string;
  client_email: string;
  private_key: string;
  private_key_id?: string;
}

export const FILE_SETTING = 'FIREBASE_SERVICE_ACCOUNT_FILE';
export const JSON_SETTING = 'FIREBASE_SERVICE_ACCOUNT_JSON';

/**
 * A problem with the service-account key. The message names the setting and the field that is
 * wrong and NEVER contains a value (not the path, not a snippet of the JSON, not the key): it ends
 * up in logs, in terminals people paste into chats, and in error pages.
 */
export class ServiceAccountError extends Error {
  override readonly name: string = 'ServiceAccountError';
}

const INSTRUCTIONS =
  'Download a fresh file: Firebase console > Project settings > Service accounts > Generate new private key.';

function field(record: Record<string, unknown>, name: string): string | undefined {
  const value = record[name];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/**
 * JSON.parse messages quote the text they choke on, which here would be the private key, so the
 * original error is dropped. An environment file loader that expands `\n` inside double quotes
 * turns the key's escaped line breaks into raw ones, which JSON forbids inside a string: that case
 * is repaired once before giving up.
 */
function parseJson(source: string): unknown {
  try {
    return JSON.parse(source);
  } catch {
    // Fall through to the repair attempt.
  }
  try {
    return JSON.parse(source.replace(/\r?\n/g, '\\n'));
  } catch {
    return undefined;
  }
}

/** Checks the shape of a downloaded key file. `setting` is only used to word the messages. */
export function parseServiceAccount(source: string, setting: string): ServiceAccount {
  const parsed = parseJson(source.trim());
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ServiceAccountError(
      `${setting} is not a JSON object. Use the key file exactly as downloaded. ${INSTRUCTIONS}`,
    );
  }
  const record = parsed as Record<string, unknown>;
  if (record.type !== 'service_account') {
    throw new ServiceAccountError(
      `${setting} is not a service-account key (its "type" must be "service_account"). ${INSTRUCTIONS}`,
    );
  }
  const projectId = field(record, 'project_id');
  const clientEmail = field(record, 'client_email');
  const privateKey = field(record, 'private_key');
  if (!projectId) throw new ServiceAccountError(`${setting} has no "project_id". ${INSTRUCTIONS}`);
  if (!clientEmail || !/^[^\s@]+@[^\s@]+$/.test(clientEmail)) {
    throw new ServiceAccountError(`${setting} has no valid "client_email". ${INSTRUCTIONS}`);
  }
  if (!privateKey)
    throw new ServiceAccountError(`${setting} has no "private_key". ${INSTRUCTIONS}`);
  try {
    createPrivateKey(privateKey);
  } catch {
    // The reason from OpenSSL is dropped on purpose: it can quote parts of the key.
    throw new ServiceAccountError(
      `${setting} has a "private_key" that is not a readable private key (was the file edited?). ${INSTRUCTIONS}`,
    );
  }
  const keyId = field(record, 'private_key_id');
  return {
    type: 'service_account',
    project_id: projectId,
    client_email: clientEmail,
    private_key: privateKey,
    ...(keyId ? { private_key_id: keyId } : {}),
  };
}

export interface ServiceAccountSettings {
  FIREBASE_SERVICE_ACCOUNT_FILE?: string | undefined;
  FIREBASE_SERVICE_ACCOUNT_JSON?: string | undefined;
}

/** The file named by `FIREBASE_SERVICE_ACCOUNT_FILE` wins over `FIREBASE_SERVICE_ACCOUNT_JSON`. */
export function readServiceAccount(settings: ServiceAccountSettings): ServiceAccount {
  const file = settings.FIREBASE_SERVICE_ACCOUNT_FILE?.trim();
  if (file) {
    // A pasted key in the path setting must not be echoed back as a "missing file" path.
    if (file.startsWith('{')) {
      throw new ServiceAccountError(
        `${FILE_SETTING} must be the path of the key file, not its contents. Put the contents in ${JSON_SETTING} instead.`,
      );
    }
    let text: string;
    try {
      const path = resolve(file);
      if (statSync(path).size > MAX_KEY_FILE_BYTES) {
        throw new ServiceAccountError(
          `The file named by ${FILE_SETTING} is too large to be a key file. ${INSTRUCTIONS}`,
        );
      }
      text = readFileSync(path, 'utf8');
    } catch (error) {
      if (error instanceof ServiceAccountError) throw error;
      const code = (error as { code?: unknown }).code;
      throw new ServiceAccountError(
        `Cannot read the file named by ${FILE_SETTING}${typeof code === 'string' ? ` (${code})` : ''}. Check the path and that the server may read it.`,
      );
    }
    return parseServiceAccount(text, `The file named by ${FILE_SETTING}`);
  }
  const json = settings.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (json) return parseServiceAccount(json, JSON_SETTING);
  throw new ServiceAccountError(
    `${FILE_SETTING} (or ${JSON_SETTING}) is required when STORAGE_DRIVER=gcs`,
  );
}
