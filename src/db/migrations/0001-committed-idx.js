import { db } from '../index';
import { log } from '@/lib/logger';
export const migration0001 = {
    version: 1,
    name: 'committed-idx',
    async up() {
        log('Running migration 0001: Convert committed boolean to committed_idx numeric');
        const gameSessions = await db.gameSessions.toArray();
        if (gameSessions.length === 0)
            return;
        for (const session of gameSessions) {
            if ('committed' in session && typeof session.committed === 'boolean') {
                await db.gameSessions.update(session.id, { committed_idx: session.committed ? 1 : 0 });
            }
        }
    },
};
