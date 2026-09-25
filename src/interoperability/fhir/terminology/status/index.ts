// Every status map, for tests and documentation. Each area's maps live next
// to it (terminology/status/<area>.ts) and are listed here.

import type { StatusMap } from "../statusMaps";
import { CONDITION_CLINICAL_STATUS, CONDITION_VERIFICATION_STATUS, ENCOUNTER_STATUS } from "../statusMaps";
import { MEDICATION_STATUS_MAPS } from "./medication";
import { LABORATORY_STATUS_MAPS } from "./laboratory";
import { ALLERGY_STATUS_MAPS } from "./allergy";
import { DOCUMENT_STATUS_MAPS } from "./document";
import { CONSENT_STATUS_MAPS } from "./consent";
import { DIRECTORY_STATUS_MAPS } from "./directory";

export const STATUS_MAPS: readonly StatusMap[] = [
  ENCOUNTER_STATUS,
  CONDITION_CLINICAL_STATUS,
  CONDITION_VERIFICATION_STATUS,
  ...MEDICATION_STATUS_MAPS,
  ...LABORATORY_STATUS_MAPS,
  ...ALLERGY_STATUS_MAPS,
  ...DOCUMENT_STATUS_MAPS,
  ...CONSENT_STATUS_MAPS,
  ...DIRECTORY_STATUS_MAPS,
];
