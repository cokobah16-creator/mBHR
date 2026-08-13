// Clinical protocols and prescription templates seed data.
// Drawn from the Nigeria Essential Medicines List and national treatment
// guidelines; quantities sized for a 200-300 patient outreach day.
// Reviewed content — edit to match your org's actual stock and practice.

export interface ProtocolSeed {
  title: string;
  condition: string;
  category: "infectious" | "chronic" | "acute" | "emergency" | "pediatric" | "maternal" | "general";
  protocolContent: string;
  algorithm?: Record<string, unknown>;
  medications: Array<Record<string, unknown>>;
  contraindications: string[];
  specialConsiderations?: string;
  clinicalReferences: string;
}

export interface PrescriptionTemplateSeed {
  name: string;
  condition: string;
  description: string;
  medications: Array<{
    medication: string;
    dosage: string;
    frequency: string;
    duration: string;
    quantity: number;
    instructions: string;
  }>;
}

export const PROTOCOLS: ProtocolSeed[] = [
  {
    "title": "Uncomplicated Malaria (Adult & Pediatric)",
    "condition": "Uncomplicated Plasmodium falciparum malaria",
    "category": "infectious",
    "protocolContent": "# Uncomplicated Malaria (Adult & Pediatric)\n\n## Overview\nMalaria remains the leading cause of outpatient fever in Nigeria. At outreach, every patient with fever (or history of fever in the last 48 hours) must have a malaria rapid diagnostic test (RDT) before any antimalarial is given. **Test before treat — do not treat RDT-negative patients with antimalarials.** First-line treatment for RDT-confirmed uncomplicated malaria is artemether-lumefantrine (AL).\n\n## Assessment\n1. Ask: fever now or in the last 2 days? Vomiting? Able to drink/breastfeed? Convulsions? Duration of illness?\n2. Look: temperature, level of consciousness, pallor (palms/conjunctivae), respiratory distress, jaundice, dehydration. Weigh every child.\n3. Test: malaria RDT for every febrile patient.\n4. Screen for DANGER SIGNS (any one = severe malaria):\n   - Unable to drink or breastfeed; vomits everything\n   - Convulsions (now or recent)\n   - Lethargy, prostration (cannot sit/stand unaided), or unconsciousness\n   - Severe pallor, respiratory distress, or jaundice\n   - Dark (coca-cola) urine or very little urine\n\n## Classification\n- **RDT positive + any danger sign → SEVERE MALARIA**: give pre-referral treatment and REFER URGENTLY.\n- **RDT positive, no danger signs → UNCOMPLICATED MALARIA**: treat with AL at the clinic.\n- **RDT negative**: do NOT give antimalarials. Look for another cause of fever; refer if unwell and no cause found.\n\n## Treatment — Artemether-Lumefantrine (AL 20/120 mg)\nSix doses over 3 days: first dose now (observed), second dose after 8 hours, then twice daily on days 2 and 3. Give with food or milk (improves absorption). Repeat the dose if vomited within 30 minutes.\n\n| Weight (age guide) | Tablets per dose | Total tablets |\n|---|---|---|\n| 5 – <15 kg (≈ <3 yr) | 1 | 6 |\n| 15 – <25 kg (≈ 3–8 yr) | 2 | 12 |\n| 25 – <35 kg (≈ 9–14 yr) | 3 | 18 |\n| ≥35 kg (adult) | 4 (or 1 × AL 80/480) | 24 (or 6) |\n\nUse dispersible tablets for children where available (disperse in a small amount of water). Add paracetamol for fever: children 15 mg/kg every 6–8 h; adults 1 g every 6–8 h.\n\n## Pre-referral treatment for severe malaria\n- Child <6 years: **rectal artesunate 10 mg/kg** single dose, then refer immediately.\n- Where injectable is available: **IM artesunate 2.4 mg/kg** (3.0 mg/kg if <20 kg) into anterior thigh.\n- If unavailable, give first dose of AL if the patient can swallow, and refer without delay. Treat hypoglycaemia (check glucometer), keep child warm, continue breastfeeding en route.\n\n## Pregnancy\n- Test all febrile pregnant women. AL is recommended in the **second and third trimesters**; per WHO (2022 update) AL may also be used in the **first trimester** — follow current national policy; if quinine is the local first-trimester standard and AL policy is unclear, refer for supervised treatment.\n- Any pregnant woman with danger signs, or fever plus pallor, is HIGH RISK — refer.\n- Remind pregnant women about IPTp with sulfadoxine-pyrimethamine at ANC (SP is for prevention at ANC, never for treatment).\n\n## Referral criteria\nRefer to the nearest general hospital: any danger sign; RDT-positive infant <5 kg or <2 months; fever persisting after a completed AL course within the last 14 days; severe pallor; pregnancy with complications; RDT-negative but seriously ill.\n\n## Counselling (say it, then check understanding)\n- Finish ALL 6 doses even if the patient feels better after day 1.\n- Give with food; repeat the dose if vomited within 30 minutes.\n- Return immediately (nearest facility) if: unable to drink, vomiting everything, convulsions, worsening weakness, fever beyond 3 days.\n- Sleep under an insecticide-treated net every night.",
    "algorithm": {
      "steps": [
        {
          "step": 1,
          "assess": "Fever now or within the last 48 hours?",
          "ifYes": "Perform malaria RDT (step 2)",
          "ifNo": "Assess for other conditions; no RDT or antimalarial needed"
        },
        {
          "step": 2,
          "assess": "Is the malaria RDT positive?",
          "ifYes": "Screen for danger signs (step 3)",
          "ifNo": "No antimalarial. Look for other cause of fever; treat or refer accordingly"
        },
        {
          "step": 3,
          "assess": "Any danger sign: cannot drink/breastfeed, vomits everything, convulsions, lethargy/prostration/unconscious, severe pallor, respiratory distress, jaundice, dark urine?",
          "ifYes": "SEVERE MALARIA: give pre-referral artesunate (rectal 10 mg/kg if <6 yr, or IM 2.4 mg/kg; 3 mg/kg if <20 kg), check/correct glucose, REFER URGENTLY",
          "ifNo": "Uncomplicated malaria: go to step 4"
        },
        {
          "step": 4,
          "assess": "Is the patient pregnant?",
          "ifYes": "2nd/3rd trimester: treat with AL by weight. 1st trimester: AL per WHO 2022 / current national policy, or refer for supervised treatment if local policy specifies quinine",
          "ifNo": "Treat with AL by weight band (step 5)"
        },
        {
          "step": 5,
          "assess": "Weigh patient and select AL weight band (5–<15 kg: 1 tab; 15–<25 kg: 2; 25–<35 kg: 3; ≥35 kg: 4 tabs per dose)",
          "ifYes": "Give first dose observed with food; dispense full 3-day course; counsel on completion, vomiting rule, and return-immediately signs",
          "ifNo": "If <5 kg or <2 months old: do not give AL — refer"
        }
      ]
    },
    "medications": [
      {
        "name": "Artemether-Lumefantrine (AL)",
        "form": "Tablet / dispersible tablet 20/120 mg",
        "dose": "By weight band per dose: 5–<15 kg = 1 tab; 15–<25 kg = 2 tabs; 25–<35 kg = 3 tabs; ≥35 kg = 4 tabs (or 1 × 80/480 mg tab)",
        "frequency": "Dose now, second dose at 8 hours, then twice daily",
        "duration": "3 days (6 doses total)",
        "notes": "Give with food/milk. Repeat dose if vomited within 30 min. Observed first dose at clinic. Not for infants <5 kg."
      },
      {
        "name": "Artesunate (pre-referral)",
        "form": "Rectal capsule 100 mg / injectable powder",
        "dose": "Rectal 10 mg/kg (child <6 yr); IM/IV 2.4 mg/kg (3.0 mg/kg if <20 kg)",
        "frequency": "Single pre-referral dose",
        "duration": "Once, then refer urgently",
        "notes": "For danger signs only. If capsule expelled within 30 min, insert another."
      },
      {
        "name": "Paracetamol",
        "form": "Tablet 500 mg / syrup 120 mg/5 mL",
        "dose": "Child 15 mg/kg; adult 500 mg–1 g",
        "frequency": "Every 6–8 hours as needed for fever/pain",
        "duration": "Up to 3 days",
        "notes": "Maximum 4 doses in 24 hours."
      }
    ],
    "contraindications": [
      "Do not give antimalarials to RDT-negative patients",
      "AL contraindicated in infants <5 kg or <2 months — refer",
      "Do not use AL alone for severe malaria (danger signs) — pre-referral artesunate and referral required",
      "Known hypersensitivity to artemether or lumefantrine",
      "Caution in first-trimester pregnancy — follow current national policy; refer if in doubt",
      "Avoid co-administration with other QT-prolonging drugs where possible",
      "Sulfadoxine-pyrimethamine (IPTp) is for prevention at ANC only, never for treatment of confirmed malaria"
    ],
    "specialConsiderations": "One-day outreach setting: observe the first AL dose on site and dispense the complete course with pictorial/verbal instructions, since no follow-up visit is guaranteed. Weigh every child — do not estimate weight by age unless the scale fails. RDT remains positive for weeks after treated infection (HRP2 antigen persistence): if the patient completed a full ACT course within the last 2 weeks and is febrile again, refer rather than re-treating on the same RDT result. Check blood glucose in any convulsing or lethargic child before referral. Severe pallor in a child plus positive RDT suggests severe malarial anaemia — refer even if alert.",
    "clinicalReferences": "Federal Ministry of Health Nigeria, National Guidelines for Diagnosis and Treatment of Malaria (2015, revised 2020); Nigeria National Malaria Strategic Plan 2021–2025; WHO Guidelines for Malaria (2023, updated 2024); WHO Management of Severe Malaria: A Practical Handbook, 3rd ed. (2012); WHO Recommendation on AL use in first trimester of pregnancy (Guidelines for Malaria, November 2022 update)."
  },
  {
    "title": "Hypertension Screening & Management at Outreach",
    "condition": "Hypertension (screening, initiation of treatment, and referral)",
    "category": "chronic",
    "protocolContent": "# Hypertension Screening & Management at Outreach\n\n## Overview\nAn outreach clinic may be a patient's only contact with health care for months, so every adult ≥18 years should have blood pressure (BP) measured, and treatment decisions must be made the same day using the Nigeria Hypertension Control Initiative (NHCI) / WHO HEARTS protocol. First-line drug: **amlodipine 5 mg once daily**.\n\n## Assessment (correct measurement matters)\n1. Patient seated, back supported, feet flat, arm at heart level; rested ≥5 minutes; no talking. No caffeine/smoking in the previous 30 minutes if known.\n2. Use correct cuff size on a bare or thinly-clothed arm.\n3. If the first reading is ≥140/90 mmHg, take **two further readings 1–2 minutes apart** and record the **average of the 2nd and 3rd readings** as the visit BP.\n4. Ask: known hypertensive? On drugs (which, and when last taken)? Pregnancy/possible pregnancy? Diabetes, prior stroke or heart disease? Chest pain, breathlessness, severe headache, visual changes, weakness of one side?\n5. Check random blood glucose (glucometer) in all with BP ≥140/90; dipstick urine for protein in pregnant women and severe hypertension.\n\n## Classification (average visit BP)\n- **<140/90**: Normal for today — lifestyle counselling; advise annual check.\n- **140–159 / 90–99 (Grade 1)**: Hypertension — treat per step below.\n- **160–179 / 100–109 (Grade 2)**: Hypertension — start treatment today.\n- **≥180/110**: Severe — assess for urgency/emergency (see referral criteria).\n\n## Treatment\n- **Start amlodipine 5 mg once daily** the same day when average BP is **≥160/100**, or **≥140/90 with diabetes, known cardiovascular disease, or prior stroke**.\n- For Grade 1 (140–159/90–99) without comorbidity: because review in 1–2 weeks is usually impossible at outreach, it is acceptable and recommended to start amlodipine 5 mg today, with strong lifestyle counselling and a written record — do not leave a persistently hypertensive patient untreated on the promise of a follow-up that may never happen.\n- Known hypertensive already on treatment with BP ≥140/90: check adherence; if adherent, refer/link to a facility for intensification (do not stack unfamiliar drugs at outreach). If out of stock of their drug, dispense amlodipine 5 mg as a bridge and document.\n- Dispense **30 tablets** with a written BP record card showing today's readings and the start date.\n- Pregnant women: do NOT start amlodipine at outreach. BP ≥140/90 in pregnancy = refer to ANC/hospital the same week; ≥160/110 or proteinuria or headache/visual symptoms = refer SAME DAY (pre-eclampsia risk).\n\n## Referral criteria\n- **Emergency (refer NOW, do not simply treat and release)**: BP ≥180/110 **with** chest pain, breathlessness, reduced consciousness, focal weakness/facial droop, severe headache or visual disturbance, or pregnancy.\n- **Urgent (start amlodipine today AND refer for review within 1 week)**: BP ≥180/110 without symptoms — give first dose observed, dispense 30 days, written referral.\n- Refer also: age <30 with confirmed hypertension, suspected secondary cause, BP ≥140/90 with glucose ≥11.1 mmol/L, known hypertensive uncontrolled on existing therapy.\n\n## Counselling (assume no review for months)\n- \"This medicine is taken every day, at the same time, even when you feel well. Hypertension has no symptoms — stopping the drug lets it silently damage your heart, brain and kidneys.\"\n- Reduce salt (avoid adding salt/seasoning cubes at table), stop tobacco, limit alcohol, walk 30 minutes most days, maintain healthy weight.\n- Name the nearest PHC/general hospital where they can re-check BP and refill within 30 days; write it on the card.\n- Return immediately for: severe headache, chest pain, breathlessness, weakness of one side, swelling of legs/face.\n- Ankle swelling on amlodipine is common and not dangerous, but they should mention it at follow-up.",
    "algorithm": {
      "steps": [
        {
          "step": 1,
          "assess": "Adult ≥18 yr: measure BP after 5 min seated rest. Is first reading ≥140/90?",
          "ifYes": "Take 2 more readings 1–2 min apart; average the 2nd and 3rd (step 2)",
          "ifNo": "Lifestyle counselling; recheck in 1 year"
        },
        {
          "step": 2,
          "assess": "Is average BP ≥180/110?",
          "ifYes": "Any symptom (chest pain, breathlessness, neuro deficit, severe headache/visual change) or pregnancy? YES → EMERGENCY referral now. NO → give amlodipine 5 mg observed, dispense 30 days, urgent referral within 1 week",
          "ifNo": "Go to step 3"
        },
        {
          "step": 3,
          "assess": "Is the patient pregnant with BP ≥140/90?",
          "ifYes": "Do not start amlodipine. Dipstick urine; refer to ANC/hospital (same day if ≥160/110, proteinuria, or symptoms)",
          "ifNo": "Go to step 4"
        },
        {
          "step": 4,
          "assess": "Average BP ≥160/100, OR ≥140/90 with diabetes/CVD/prior stroke?",
          "ifYes": "Start amlodipine 5 mg once daily today; dispense 30 tabs; check glucose; counsel and link to nearest facility for refill",
          "ifNo": "Go to step 5"
        },
        {
          "step": 5,
          "assess": "Average BP 140–159/90–99 without comorbidity (Grade 1)?",
          "ifYes": "Start amlodipine 5 mg once daily today (no reliable follow-up available); intensive lifestyle counselling; written record and refill plan",
          "ifNo": "BP <140/90: reassure, counsel, annual recheck"
        },
        {
          "step": 6,
          "assess": "Known hypertensive already on medication with BP ≥140/90 despite adherence?",
          "ifYes": "Refer/link for treatment intensification; bridge with amlodipine 5 mg if their drug is unavailable; document all drugs",
          "ifNo": "Controlled on current therapy: refill support, praise adherence, counsel"
        }
      ]
    },
    "medications": [
      {
        "name": "Amlodipine",
        "form": "Tablet 5 mg",
        "dose": "5 mg (one tablet)",
        "frequency": "Once daily, same time each day",
        "duration": "30 days, then refill at nearest facility (lifelong treatment)",
        "notes": "First-line per NHCI/WHO HEARTS. First dose observed at clinic. Ankle oedema is a common benign side effect. Not initiated in pregnancy at outreach — refer."
      },
      {
        "name": "Paracetamol",
        "form": "Tablet 500 mg",
        "dose": "500 mg–1 g",
        "frequency": "Every 6–8 hours as needed",
        "duration": "Up to 3 days",
        "notes": "For coincidental headache only — NEVER give NSAIDs (ibuprofen/diclofenac) to hypertensive patients; NSAIDs raise BP."
      }
    ],
    "contraindications": [
      "Do not initiate amlodipine in pregnancy at outreach — refer (methyldopa/labetalol at facility level)",
      "Do not treat-and-release symptomatic BP ≥180/110 (hypertensive emergency) — refer immediately",
      "Known hypersensitivity to amlodipine or other dihydropyridines",
      "Severe aortic stenosis or cardiogenic shock (suspect if syncope/known murmur) — refer instead",
      "Avoid NSAIDs for analgesia in hypertensive patients",
      "Do not add a second antihypertensive at outreach for patients on unknown regimens — refer for intensification"
    ],
    "specialConsiderations": "This may be the only clinical contact for months: err on the side of starting treatment the same day for confirmed hypertension, and make linkage concrete — write the name and location of the nearest PHC/general hospital and the refill date on the patient's card. Automated BP cuffs should be validated and batteries checked each morning; recalibrate against a second device if readings look implausible. High-volume flow (200–300 patients/day): a triage station taking BP on all adults keeps the doctor's queue moving. Check random glucose in every new hypertensive (frequent co-occurrence of diabetes). Record phone numbers where available for NHCI-style follow-up calls.",
    "clinicalReferences": "Nigeria Hypertension Control Initiative (NHCI) Standard Treatment Protocol, FMOH/WHO/Resolve to Save Lives (2020); WHO HEARTS Technical Package for Cardiovascular Disease Management in Primary Health Care (2020); WHO Guideline for the Pharmacological Treatment of Hypertension in Adults (2021); International Society of Hypertension Global Practice Guidelines (2020); Nigeria National Multi-Sectoral Action Plan for NCDs 2019–2025."
  },
  {
    "title": "Acute Diarrhoea in Children (ORS/Zinc)",
    "condition": "Acute watery diarrhoea in children under 5 years",
    "category": "pediatric",
    "protocolContent": "# Acute Diarrhoea in Children (ORS/Zinc)\n\n## Overview\nDiarrhoea (≥3 loose/watery stools in 24 hours) kills children through dehydration. Nearly all cases are viral and self-limiting: the treatment is **fluids (ORS), zinc, and continued feeding — NOT antibiotics**. Assess every child for dehydration using the WHO IMCI scheme and treat with Plan A, B, or C.\n\n## Assessment (look and feel — takes 1 minute)\n1. **Condition**: alert? restless/irritable? lethargic or unconscious?\n2. **Eyes**: sunken?\n3. **Drinking**: drinks normally? drinks eagerly, thirsty? unable to drink or drinking poorly?\n4. **Skin pinch** (abdomen): goes back immediately? slowly? very slowly (>2 seconds)?\n5. Ask: how many days? **Blood in stool?** Vomiting? Fever (do RDT if febrile)? Weigh the child.\n\n## Classification\n- **SEVERE DEHYDRATION** — two or more of: lethargic/unconscious; sunken eyes; unable to drink or drinking poorly; skin pinch goes back very slowly → **Plan C + urgent referral**.\n- **SOME DEHYDRATION** — two or more of: restless/irritable; sunken eyes; drinks eagerly/thirsty; skin pinch goes back slowly → **Plan B**.\n- **NO DEHYDRATION** — not enough signs above → **Plan A**.\n- **Blood in stool = DYSENTERY** → antibiotic indicated (see below) in addition to fluids and zinc.\n- Diarrhoea ≥14 days = persistent diarrhoea → refer.\n\n## Treatment\n### Plan A (no dehydration — treat at home)\n- ORS after each loose stool: **<2 years: 50–100 mL (¼–½ cup); ≥2 years: 100–200 mL (½–1 cup)**. Give with cup and spoon, small sips; if the child vomits, wait 10 minutes then continue more slowly.\n- Dispense 6 ORS sachets; demonstrate mixing: **one sachet in 1 litre of clean (boiled and cooled or treated) water**; discard solution after 24 hours.\n- Continue breastfeeding and normal feeding; extra fluids until diarrhoea stops.\n\n### Plan B (some dehydration — treat at the outreach site)\n- ORS **75 mL/kg over 4 hours** at the clinic (e.g. 10 kg child = 750 mL). If weight unknown, use age chart in IMCI booklet.\n- Small frequent sips by cup and spoon; continue breastfeeding.\n- Reassess after 4 hours: improved → switch to Plan A and send home with sachets; not improved or worse → repeat Plan B or escalate; deteriorating → Plan C and refer.\n\n### Plan C (severe dehydration)\n- **REFER URGENTLY** for IV fluids (Ringer's lactate 100 mL/kg). While organising transport, give ORS by sips or NG tube if the child can take anything. Do not delay referral.\n\n### Zinc (every child with diarrhoea, all plans)\n- **<6 months: 10 mg (½ tablet) once daily for 10 days.**\n- **≥6 months: 20 mg (1 tablet) once daily for 10 days.**\n- Dissolve dispersible tablet in a spoon of breast milk, ORS, or clean water. Zinc shortens this episode and prevents the next one — finish all 10 days even after the stool normalises.\n\n### Antibiotics — only when truly indicated\n- **NO antibiotics for watery diarrhoea.** They do not help and cause harm.\n- **Bloody stool (dysentery)**: ciprofloxacin **15 mg/kg twice daily for 3 days** + zinc + fluids; review need for referral if child is unwell, malnourished, or <12 months.\n- Suspected cholera (profuse rice-water stools, outbreak setting, usually >2 yr): aggressive rehydration and refer; notify health authorities.\n- No antimotility drugs (loperamide) — dangerous in children. No routine antiemetics.\n\n## Referral criteria\nSevere dehydration; unable to drink or vomits everything; lethargy/convulsions; blood in stool in a child who is <12 months, malnourished, or systemically unwell; diarrhoea ≥14 days; visible severe wasting or oedema of both feet; any child not improving after 4 hours of Plan B.\n\n## Counselling\nShow the caregiver how to mix ORS and watch her give the first cup. Return immediately if: blood in stool, drinking poorly, vomiting everything, fever, or the child becomes weaker. Handwashing with soap, safe water, and continued feeding prevent the next episode.",
    "algorithm": {
      "steps": [
        {
          "step": 1,
          "assess": "Two or more of: lethargic/unconscious, sunken eyes, unable to drink, skin pinch very slow (>2 s)?",
          "ifYes": "SEVERE DEHYDRATION — Plan C: refer urgently for IV fluids; give ORS sips/NG en route; give zinc when able",
          "ifNo": "Go to step 2"
        },
        {
          "step": 2,
          "assess": "Two or more of: restless/irritable, sunken eyes, drinks eagerly/thirsty, skin pinch slow?",
          "ifYes": "SOME DEHYDRATION — Plan B: ORS 75 mL/kg over 4 h at clinic, reassess, then Plan A home; give zinc 10 days",
          "ifNo": "NO DEHYDRATION — Plan A: ORS after each stool at home + zinc 10 days (step 3)"
        },
        {
          "step": 3,
          "assess": "Is there blood in the stool (dysentery)?",
          "ifYes": "Add ciprofloxacin 15 mg/kg twice daily for 3 days; refer if <12 months, malnourished, or unwell",
          "ifNo": "No antibiotics — ORS + zinc + continued feeding only"
        },
        {
          "step": 4,
          "assess": "Diarrhoea for 14 days or more, or severe wasting / oedema of both feet?",
          "ifYes": "Refer (persistent diarrhoea / severe acute malnutrition)",
          "ifNo": "Complete counselling: ORS mixing demo, zinc for full 10 days, return-immediately signs, hygiene"
        },
        {
          "step": 5,
          "assess": "Child on Plan B: improved after 4 hours of ORS?",
          "ifYes": "Switch to Plan A; dispense 6 ORS sachets + zinc; counsel and discharge",
          "ifNo": "Repeat Plan B if stable; if worse or unable to drink, escalate to Plan C and refer"
        }
      ]
    },
    "medications": [
      {
        "name": "Oral Rehydration Salts (low-osmolarity, WHO formula)",
        "form": "Sachet for 1 litre",
        "dose": "Plan A: <2 yr 50–100 mL after each loose stool; ≥2 yr 100–200 mL. Plan B: 75 mL/kg over 4 hours",
        "frequency": "After each loose stool (Plan A) / continuous small sips over 4 h (Plan B)",
        "duration": "Until diarrhoea stops; dispense 6 sachets",
        "notes": "Mix 1 sachet in 1 L clean water; discard after 24 h. Cup and spoon, not bottle."
      },
      {
        "name": "Zinc sulphate",
        "form": "Dispersible tablet 20 mg",
        "dose": "<6 months: 10 mg (half tablet); ≥6 months: 20 mg (one tablet)",
        "frequency": "Once daily",
        "duration": "10 days — complete the course even after recovery",
        "notes": "Disperse in breast milk, ORS, or clean water on a spoon. Reduces duration and severity and prevents recurrence for 2–3 months."
      },
      {
        "name": "Ciprofloxacin (dysentery only)",
        "form": "Tablet 250/500 mg or suspension",
        "dose": "15 mg/kg per dose",
        "frequency": "Twice daily",
        "duration": "3 days",
        "notes": "ONLY for bloody stool. Not for watery diarrhoea. WHO first-line for Shigella dysentery."
      }
    ],
    "contraindications": [
      "No antibiotics for acute watery (non-bloody) diarrhoea",
      "No antimotility agents (loperamide, diphenoxylate) in children — risk of ileus and death",
      "No routine antiemetics in young children",
      "Do not attempt outpatient rehydration for severe dehydration — Plan C requires IV fluids; refer",
      "Do not mix ORS with less than 1 litre of water (hypertonic solution is dangerous) or keep solution beyond 24 hours",
      "Do not stop breastfeeding or withhold food during diarrhoea"
    ],
    "specialConsiderations": "One-day outreach: the caregiver must leave able to do everything herself — physically demonstrate ORS mixing with a real sachet and a 1-litre container, and watch her give the first feeds. Plan B needs a shaded corner with cups, spoons, safe water, and a helper re-checking children every hour; start Plan B early in the day so the 4-hour reassessment happens before the event closes — a child still dehydrated at closing time must be referred, not sent home. Check every diarrhoea child for malnutrition (visible wasting, oedema) and do a malaria RDT if febrile — co-infection is common. In cholera outbreak settings, notify the LGA health authority the same day.",
    "clinicalReferences": "WHO/UNICEF Integrated Management of Childhood Illness (IMCI) Chart Booklet (2014); WHO, The Treatment of Diarrhoea: A Manual for Physicians and Other Senior Health Workers, 4th rev. (2005); WHO/UNICEF Joint Statement: Clinical Management of Acute Diarrhoea (2004); WHO Pocket Book of Hospital Care for Children, 2nd ed. (2013); Nigeria FMOH IMCI national adaptation and Essential Medicines List (2020)."
  }
];

export const PRESCRIPTION_TEMPLATES: PrescriptionTemplateSeed[] = [
  {
    "name": "Adult Uncomplicated Malaria (AL 80/480)",
    "condition": "RDT-confirmed uncomplicated malaria, adult ≥35 kg",
    "description": "Standard 3-day artemether-lumefantrine course for adults and children ≥35 kg, with paracetamol for fever. First dose observed at clinic.",
    "medications": [
      {
        "medication": "Artemether-Lumefantrine 80/480 mg",
        "dosage": "1 tablet",
        "frequency": "Twice daily (first two doses 8 hours apart)",
        "duration": "3 days (6 doses)",
        "quantity": 6,
        "instructions": "Take with food or milk. Take the second dose 8 hours after the first, then morning and evening for 2 more days. Finish all 6 tablets even if you feel better. If you vomit within 30 minutes of a dose, take another tablet."
      },
      {
        "medication": "Paracetamol 500 mg",
        "dosage": "2 tablets",
        "frequency": "Every 8 hours as needed for fever",
        "duration": "3 days",
        "quantity": 18,
        "instructions": "Take 2 tablets when you have fever or body pain, up to 3 times a day. Do not exceed 8 tablets in one day."
      }
    ]
  },
  {
    "name": "Pediatric Malaria (AL Dispersible, by weight)",
    "condition": "RDT-confirmed uncomplicated malaria, child 5 to <35 kg",
    "description": "3-day AL dispersible course. Select tablets per dose by weight band: 5–<15 kg = 1 tab/dose (dispense 6); 15–<25 kg = 2 tabs/dose (dispense 12); 25–<35 kg = 3 tabs/dose (dispense 18). Default quantity is the smallest band — adjust at dispensing.",
    "medications": [
      {
        "medication": "Artemether-Lumefantrine dispersible 20/120 mg",
        "dosage": "1 tablet per dose (5–<15 kg); 2 tablets (15–<25 kg); 3 tablets (25–<35 kg)",
        "frequency": "Twice daily (second dose 8 hours after the first)",
        "duration": "3 days (6 doses)",
        "quantity": 6,
        "instructions": "Dissolve the tablet(s) in a spoon of clean water and give with food or milk. Give the second dose 8 hours after the first, then morning and evening for 2 more days. If the child vomits within 30 minutes, repeat the dose. Finish all doses even if the child seems well."
      },
      {
        "medication": "Paracetamol syrup 120 mg/5 mL",
        "dosage": "15 mg/kg (approx. 5 mL per 8 kg body weight)",
        "frequency": "Every 6–8 hours as needed for fever",
        "duration": "3 days",
        "quantity": 1,
        "instructions": "Give for fever up to 4 times a day. Also sponge the child with lukewarm water if very hot. Return immediately if the child cannot drink, vomits everything, or has a convulsion."
      }
    ]
  },
  {
    "name": "Childhood Diarrhoea (ORS + Zinc)",
    "condition": "Acute watery diarrhoea in a child, no or some dehydration",
    "description": "WHO-recommended home treatment: low-osmolarity ORS after each loose stool plus 10 days of zinc. No antibiotics for watery diarrhoea.",
    "medications": [
      {
        "medication": "Oral Rehydration Salts (low-osmolarity) 1-litre sachet",
        "dosage": "Under 2 years: 50–100 mL (quarter to half cup) after each loose stool; 2 years and older: 100–200 mL (half to one cup)",
        "frequency": "After every loose stool",
        "duration": "Until diarrhoea stops",
        "quantity": 6,
        "instructions": "Mix one full sachet in 1 litre of clean (boiled and cooled) water. Give small sips with a cup and spoon. Throw away leftover solution after 24 hours and mix a fresh one. Keep breastfeeding and feeding normally."
      },
      {
        "medication": "Zinc sulphate dispersible 20 mg",
        "dosage": "Under 6 months: half tablet (10 mg); 6 months and older: 1 tablet (20 mg)",
        "frequency": "Once daily",
        "duration": "10 days",
        "quantity": 10,
        "instructions": "Dissolve the tablet in a spoon of breast milk, ORS, or clean water. Give every day for 10 full days, even after the diarrhoea stops — it protects the child from the next episode. Return immediately if you see blood in the stool or the child cannot drink."
      }
    ]
  },
  {
    "name": "New Hypertension Start (Amlodipine)",
    "condition": "Newly confirmed hypertension in a non-pregnant adult",
    "description": "First-line NHCI/WHO HEARTS initiation: amlodipine 5 mg daily, 30-day supply, with linkage to the nearest facility for refill and review.",
    "medications": [
      {
        "medication": "Amlodipine 5 mg",
        "dosage": "1 tablet",
        "frequency": "Once daily, same time every day",
        "duration": "30 days, then refill at your nearest clinic (long-term treatment)",
        "quantity": 30,
        "instructions": "Take one tablet every day even when you feel completely well — high blood pressure has no symptoms. Do not stop when the tablets finish; go to the clinic written on your card for a refill and blood pressure check. Mild ankle swelling can occur and is not dangerous. Reduce salt and seasoning cubes, walk daily, avoid tobacco."
      }
    ]
  },
  {
    "name": "Adult URTI Symptomatic Relief",
    "condition": "Viral upper respiratory tract infection (common cold/catarrh), adult",
    "description": "Symptomatic treatment only — no antibiotics for uncomplicated URTI. Analgesic/antipyretic plus a once-daily antihistamine for rhinorrhoea and sneezing.",
    "medications": [
      {
        "medication": "Paracetamol 500 mg",
        "dosage": "2 tablets",
        "frequency": "Every 8 hours as needed",
        "duration": "3 days",
        "quantity": 18,
        "instructions": "Take 2 tablets for fever, headache, or body pain, up to 3 times daily. Do not exceed 8 tablets in 24 hours. Drink plenty of fluids and rest."
      },
      {
        "medication": "Cetirizine 10 mg",
        "dosage": "1 tablet",
        "frequency": "Once daily at night",
        "duration": "5 days",
        "quantity": 5,
        "instructions": "Take one tablet at night for runny nose and sneezing. It may cause mild drowsiness. Return to a clinic if you develop difficulty breathing, chest pain, or fever lasting more than 3 days."
      }
    ]
  },
  {
    "name": "Deworming (Albendazole Single Dose)",
    "condition": "Soil-transmitted helminth infection / routine deworming (age ≥2 years)",
    "description": "WHO-recommended single-dose albendazole 400 mg for roundworm, hookworm, and whipworm. Not for children under 12 months; give half dose (200 mg) for 12–23 months per programme policy; avoid in first-trimester pregnancy.",
    "medications": [
      {
        "medication": "Albendazole 400 mg",
        "dosage": "1 tablet (chew or swallow; crush for young children)",
        "frequency": "Single dose",
        "duration": "Once",
        "quantity": 1,
        "instructions": "Chew or swallow the tablet now, with or without food. For a young child, crush the tablet and mix with a little water. This clears common worms; repeat deworming every 6 months. Wash hands with soap and wear footwear to prevent reinfection."
      }
    ]
  },
  {
    "name": "Peptic Ulcer / Dyspepsia (Omeprazole)",
    "condition": "Dyspepsia or suspected peptic ulcer disease, adult",
    "description": "14-day proton pump inhibitor trial with lifestyle advice. Refer if alarm features: vomiting blood, black stools, weight loss, difficulty swallowing, or age >55 with new symptoms.",
    "medications": [
      {
        "medication": "Omeprazole 20 mg",
        "dosage": "1 capsule",
        "frequency": "Once daily, 30 minutes before breakfast",
        "duration": "14 days",
        "quantity": 14,
        "instructions": "Swallow one capsule every morning about 30 minutes before food, for 14 days. Avoid pain-relief tablets like ibuprofen or diclofenac, alcohol, and smoking — they worsen ulcers. Go to hospital immediately if you vomit blood or pass black, tarry stools."
      }
    ]
  },
  {
    "name": "Anaemia in Pregnancy (Iron + Folic Acid)",
    "condition": "Iron-deficiency anaemia in pregnancy (pale palms/conjunctivae)",
    "description": "Therapeutic iron and folic acid for one month, with dietary counselling and referral to ANC for haemoglobin check and continued care. Refer urgently if severe pallor, breathlessness at rest, or oedema.",
    "medications": [
      {
        "medication": "Ferrous sulphate 200 mg (65 mg elemental iron)",
        "dosage": "1 tablet",
        "frequency": "Twice daily (morning and evening)",
        "duration": "30 days, then review at ANC",
        "quantity": 60,
        "instructions": "Take one tablet in the morning and one in the evening, ideally with a source of vitamin C such as orange, and not with tea or milk (they block absorption). Your stools may turn black — this is normal. Keep tablets away from children. Attend antenatal clinic within one month for a blood check."
      },
      {
        "medication": "Folic acid 5 mg",
        "dosage": "1 tablet",
        "frequency": "Once daily",
        "duration": "30 days",
        "quantity": 30,
        "instructions": "Take one tablet every day together with your iron tablet. Eat green leafy vegetables, beans, and eggs. Return to a clinic immediately if you feel breathless, dizzy, or your palms become very pale."
      }
    ]
  }
];
