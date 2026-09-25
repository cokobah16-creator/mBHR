import { db } from "./index";
import { mbhrDb } from "./mbhr";
import { outboxDb } from "./outbox";
import { gamificationDb } from "./gamification";

/**
 * Every IndexedDB database the app opens. Device reset erases each of them
 * and every window closes them when another window upgrades or erases them,
 * so a new Dexie database must be added here.
 */
export const APP_DATABASES = [db, mbhrDb, outboxDb, gamificationDb];
