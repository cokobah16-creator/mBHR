import Dexie from 'dexie'
import { db } from './index'

export async function safeOpenDb() {
  try {
    await db.open()
  } catch (e: any) {
    if (e?.name === 'UpgradeError' || e?.name === 'SchemaError') {
      console.warn('Schema migration incompatible. Deleting local DB and recreating…')
      await Dexie.delete(db.name)
      await db.open()
    } else {
      throw e
    }
  }
}