// Medicines-dispensed tally for the Outreach Summary report (pure, no Dexie).
//
// Dispensing is recorded in two places on a device:
// - db.dispenses (main database): visit dispensing, plus prescription
//   dispenses downloaded from the server (the rx_dispense RPC writes them to
//   the shared server table with item_name set);
// - mbhrDb.dispenses (pharmacy database): prescription dispenses made on
//   this device, including ones the server has not confirmed yet and ones
//   from stock kept only on this device.
// A prescription dispense can therefore be in both once it has been
// downloaded. The server keeps the device's dispense id, so a row is counted
// once: rows from the pharmacy database whose id is already in the main
// database are skipped.

export interface MedicineTally {
  name: string;
  unitsDispensed: number;
  events: number;
}

export interface DispenseTallyRow {
  id: string;
  itemName?: string;
  qty?: number;
}

/** Tally units and events per medicine name, counting each dispense id once. */
export function tallyMedicines(
  main: DispenseTallyRow[],
  pharmacy: DispenseTallyRow[],
  limit = 20,
): MedicineTally[] {
  const seen = new Set<string>();
  const medMap = new Map<string, { units: number; events: number }>();
  const add = (d: DispenseTallyRow) => {
    if (d.id) {
      if (seen.has(d.id)) return;
      seen.add(d.id);
    }
    const name = (d.itemName ?? "").trim() || "Unknown";
    const cur = medMap.get(name) ?? { units: 0, events: 0 };
    cur.units += Number.isFinite(d.qty) ? (d.qty as number) : 0;
    cur.events += 1;
    medMap.set(name, cur);
  };
  main.forEach(add);
  pharmacy.forEach(add);
  return [...medMap.entries()]
    .map(([name, v]) => ({ name, unitsDispensed: v.units, events: v.events }))
    .sort((a, b) => b.unitsDispensed - a.unitsDispensed)
    .slice(0, limit);
}
