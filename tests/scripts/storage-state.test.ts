import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  countAssetRows,
  readStorageSettings,
  switchBlocker,
} from '../../scripts/lib/storage-state';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aivore-storage-state-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function files(contents: Record<string, string>): string[] {
  return Object.entries(contents).map(([name, text]) => {
    writeFileSync(join(dir, name), text);
    return join(dir, name);
  });
}

describe('readStorageSettings', () => {
  it('uses the defaults when nothing sets anything', () => {
    expect(readStorageSettings({ cwd: dir, files: [join(dir, '.env')], env: {} })).toEqual({
      driver: 'local',
      driverFrom: null,
      mediaDir: resolve(dir, 'data/media'),
      databasePath: resolve(dir, 'data/aivore.db'),
    });
  });

  it('lets a later file win over an earlier one, and the last line win inside a file', () => {
    const list = files({
      '.env': 'STORAGE_DRIVER=s3\nSTORAGE_LOCAL_DIR=./a\nDATABASE_PATH=./a.db\n',
      '.env.local':
        'STORAGE_DRIVER=local\r\nSTORAGE_DRIVER="gcs"\r\nSTORAGE_LOCAL_DIR=../media\r\n',
    });
    const settings = readStorageSettings({ cwd: dir, files: list, env: {} });
    expect(settings.driver).toBe('gcs');
    expect(settings.driverFrom).toBe('.env.local');
    expect(settings.mediaDir).toBe(resolve(dir, '../media'));
    // Not set in the later file: the earlier one still counts.
    expect(settings.databasePath).toBe(resolve(dir, 'a.db'));
  });

  it('skips files that do not exist and treats a blank value as unset', () => {
    const list = files({ '.env': 'STORAGE_DRIVER=s3\n', '.env.local': 'STORAGE_DRIVER=\n' });
    const settings = readStorageSettings({
      cwd: dir,
      files: [join(dir, 'missing.env'), ...list],
      env: {},
    });
    expect(settings.driver).toBe('s3');
    expect(settings.driverFrom).toBe('.env');
  });

  it('asks the shell only when no file says anything', () => {
    const list = files({ '.env.local': 'STORAGE_DRIVER=local\n' });
    const env = { STORAGE_DRIVER: 'gcs', STORAGE_LOCAL_DIR: '/shell/media', DATABASE_PATH: ' ' };
    const settings = readStorageSettings({ cwd: dir, files: list, env });
    expect(settings.driver).toBe('local');
    expect(settings.mediaDir).toBe('/shell/media');
    expect(settings.databasePath).toBe(resolve(dir, 'data/aivore.db'));
  });
});

describe('countAssetRows', () => {
  const open = (name: string) => new Database(join(dir, name));

  it('is 0 for a database that does not exist yet', () => {
    expect(countAssetRows(join(dir, 'none.db'))).toBe(0);
  });

  it('is 0 for a database that has no assets table', () => {
    open('a.db').close();
    expect(countAssetRows(join(dir, 'a.db'))).toBe(0);
  });

  it('counts the rows, and does not change the database', () => {
    const db = open('b.db');
    db.exec('create table assets (id text primary key)');
    db.prepare('insert into assets (id) values (?), (?)').run('ast_a', 'ast_b');
    db.close();
    expect(countAssetRows(join(dir, 'b.db'))).toBe(2);
    expect(countAssetRows(join(dir, 'b.db'))).toBe(2);
  });

  it('is null, not 0, when the file is there but cannot be read as a database', () => {
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'c.db'), 'this is not a database'.repeat(50));
    expect(countAssetRows(join(dir, 'c.db'))).toBeNull();
    expect(countAssetRows(join(dir, 'sub'))).toBeNull();
  });
});

describe('switchBlocker', () => {
  const empty = { driver: 'local', files: false, assetRows: 0 };

  it('lets an empty local site switch', () => {
    expect(switchBlocker(empty)).toBeNull();
  });

  it.each([
    ['s3', { ...empty, driver: 's3' }, 'S3'],
    ['a driver it does not know', { ...empty, driver: 'ftp' }, '"ftp"'],
    ['files on the disk', { ...empty, files: true }, 'migrate:media'],
    ['rows in the database', { ...empty, assetRows: 3 }, '3 stored'],
    ['a database that cannot be read', { ...empty, assetRows: null }, 'could not be read'],
  ])('does not let %s switch', (_label, situation, words) => {
    expect(switchBlocker(situation)).toContain(words);
  });
});
