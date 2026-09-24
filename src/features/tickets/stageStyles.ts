// Stage colours for the ticket screens. Stage colour identifies where a
// ticket is going (registration → vitals → consultation → pharmacy); it is
// always paired with the stage name, never used on its own.
import type { FlowStage } from "@/services/patientFlow";

/** Small solid marker (dot or thin bar). */
export const STAGE_MARKER_CLASS: Record<FlowStage, string> = {
  registration: "bg-stage-registration",
  vitals: "bg-stage-vitals",
  consult: "bg-stage-consult",
  pharmacy: "bg-stage-pharmacy",
};

/** Soft chip: tinted background, stage-coloured text and border. */
export const STAGE_CHIP_CLASS: Record<FlowStage, string> = {
  registration:
    "bg-stage-registration-soft text-stage-registration border-stage-registration-line",
  vitals: "bg-stage-vitals-soft text-stage-vitals border-stage-vitals-line",
  consult: "bg-stage-consult-soft text-stage-consult border-stage-consult-line",
  pharmacy:
    "bg-stage-pharmacy-soft text-stage-pharmacy border-stage-pharmacy-line",
};
