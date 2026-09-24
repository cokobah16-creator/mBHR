// src/features/gamification/VitalsPrecisionGame.tsx
//
// This used to be an unfinished placeholder page. The maintained Vitals
// Precision game lives in features/vitals (routed at /games/vitals-precision);
// render that so any link to this module gets the real, framed game.
import MaintainedVitalsPrecisionGame from "@/features/vitals/VitalsPrecisionGame";

export default function VitalsPrecisionGame() {
  return <MaintainedVitalsPrecisionGame />;
}
