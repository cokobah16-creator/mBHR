// src/features/gamification/VitalsPrecision.tsx
//
// Earlier copy of the Vitals Precision game. It was not routed anywhere and
// had drifted from the routed version (fixed adult ranges applied to a child
// case, different token rules). It now renders the maintained game in
// features/vitals so there is one set of cases, rules and scoring.
import MaintainedVitalsPrecisionGame from "@/features/vitals/VitalsPrecisionGame";

export default function VitalsPrecision() {
  return <MaintainedVitalsPrecisionGame />;
}
