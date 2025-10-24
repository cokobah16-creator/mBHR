import { db } from '../index';
import { log, error as logError } from '@/lib/logger';
import type { Migration, MigrationRecord } from './types';
import { migration0001 } from './0001-committed-idx';
import { migration0002 } from './0002-vitals-ranges';

const migrations: Migration[] = [migration0001, migration0002];

export async function runMigrations(): Promise<void> {
  const metaKey = 'db_version';
  const meta = await db.meta.get(metaKey);
  const currentVersion = (meta?.value as number) || 0;

  log(`Current database version: ${currentVersion}`);

  const pending = migrations.filter(m => m.version > currentVersion);
  if (pending.length === 0) {
    log('No pending migrations');
    return;
  }

  for (const migration of pending) {
    log(`Running migration ${migration.version}: ${migration.name}`);
    try {
      await migration.up();
      await db.meta.put({ key: metaKey, value: migration.version, updatedAt: Date.now() });
      log(`Migration ${migration.version} completed`);
    } catch (err) {
      logError(`Migration ${migration.version} failed:`, err);
      throw err;
    }
  }
}

export async function getCurrentVersion(): Promise<number> {
  const meta = await db.meta.get('db_version');
  return (meta?.value as number) || 0;
}
