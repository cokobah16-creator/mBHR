// Every sync run (Sync now, background and reconnect syncs) also brings the
// staff directory down, so role changes and deactivations reach the device
// without waiting for the next online sign-in there. Sync runs only for a
// staff member signed in online (src/lib/cloudSession.ts), whom the server
// lets read the directory. Registered at start-up from src/main.tsx.
import { registerSyncParticipant } from "./adapter";
import { pullStaffRoster } from "./staffRoster";

registerSyncParticipant({
  name: "staff-roster",
  afterPull: async () => {
    await pullStaffRoster();
  },
});
