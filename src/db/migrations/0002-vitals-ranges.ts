import { db } from '../index';
import { log } from '@/lib/logger';
import type { Migration } from './types';
import { seedVitalsRanges } from '../seedVitalsRanges';

export const migration0002: Migration = {
  version: 2,
  name: 'vitals-ranges',

  async up() {
    log('Running migration 0002: Seed vitals reference ranges');

    const existingRanges = await db.vitalsRanges.count();

    if (existingRanges === 0) {
      log('Seeding vitals reference ranges...');
      await seedVitalsRanges();
      log('Vitals ranges seeded successfully');
    } else {
      log(`Vitals ranges already exist (${existingRanges} records), skipping seed`);
    }
  },
};
