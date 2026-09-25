-- ============================================================================
-- Phase D WS10 (part 1): add 37 missing FK indexes + drop 4 duplicate indexes
-- ============================================================================
-- Closes the `unindexed_foreign_keys` and `duplicate_index` advisor entries.
--
-- The bigger `auth_rls_initplan` (94 entries) and `multiple_permissive_policies`
-- (79 entries) work ships as a follow-up — those require per-policy rewrites
-- that are too large to bundle here safely.
--
-- The 129 `unused_index` drops are deliberately omitted: dropping indexes is
-- not reversible without losing query plans, and we want to confirm via
-- pg_stat_user_indexes over a longer window before dropping anything.
--
-- Rollback for this migration: DROP INDEX IF EXISTS each idx_… line below,
-- and recreate the dropped duplicates if absolutely needed (their twins
-- remain in place; the duplicates are by definition redundant).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Missing FK indexes — 37 entries from the advisor (verbatim)
-- ----------------------------------------------------------------------------
-- CREATE INDEX IF NOT EXISTS so this is safely re-runnable.

CREATE INDEX IF NOT EXISTS idx_alerts_nm_item_id                       ON public.alerts_nm(item_id);
CREATE INDEX IF NOT EXISTS idx_appointments_created_by                 ON public.appointments(created_by);
CREATE INDEX IF NOT EXISTS idx_consultation_reviews_event_id           ON public.consultation_reviews(event_id);
CREATE INDEX IF NOT EXISTS idx_consultation_reviews_org_id             ON public.consultation_reviews(org_id);
CREATE INDEX IF NOT EXISTS idx_consultation_reviews_site_id            ON public.consultation_reviews(site_id);
CREATE INDEX IF NOT EXISTS idx_consultations_patient_id                ON public.consultations(patient_id);
CREATE INDEX IF NOT EXISTS idx_consultations_visit_id                  ON public.consultations(visit_id);
CREATE INDEX IF NOT EXISTS idx_dispenses_patient_id                    ON public.dispenses(patient_id);
CREATE INDEX IF NOT EXISTS idx_dispenses_visit_id                      ON public.dispenses(visit_id);
CREATE INDEX IF NOT EXISTS idx_doctor_analytics_org_id                 ON public.doctor_analytics(org_id);
CREATE INDEX IF NOT EXISTS idx_doctor_analytics_site_id                ON public.doctor_analytics(site_id);
CREATE INDEX IF NOT EXISTS idx_follow_up_schedules_org_id              ON public.follow_up_schedules(org_id);
CREATE INDEX IF NOT EXISTS idx_follow_up_schedules_scheduled_event_id  ON public.follow_up_schedules(scheduled_event_id);
CREATE INDEX IF NOT EXISTS idx_follow_up_schedules_site_id             ON public.follow_up_schedules(site_id);
CREATE INDEX IF NOT EXISTS idx_lab_orders_ordered_by                   ON public.lab_orders(ordered_by);
CREATE INDEX IF NOT EXISTS idx_lab_orders_visit_id                     ON public.lab_orders(visit_id);
CREATE INDEX IF NOT EXISTS idx_lab_results_reviewed_by                 ON public.lab_results(reviewed_by);
CREATE INDEX IF NOT EXISTS idx_medication_reminders_dispense_id        ON public.medication_reminders(dispense_id);
CREATE INDEX IF NOT EXISTS idx_notifications_ticket_id                 ON public.notifications(ticket_id);
CREATE INDEX IF NOT EXISTS idx_palaver_messages_parent_id              ON public.palaver_messages(parent_id);
CREATE INDEX IF NOT EXISTS idx_patient_allergies_created_by            ON public.patient_allergies(created_by);
CREATE INDEX IF NOT EXISTS idx_patient_flags_org_id                    ON public.patient_flags(org_id);
CREATE INDEX IF NOT EXISTS idx_patient_flags_site_id                   ON public.patient_flags(site_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_batches_item_id                ON public.pharmacy_batches(item_id);
CREATE INDEX IF NOT EXISTS idx_protocol_library_org_id                 ON public.protocol_library(org_id);
CREATE INDEX IF NOT EXISTS idx_protocol_library_site_id                ON public.protocol_library(site_id);
CREATE INDEX IF NOT EXISTS idx_queue_patient_id                        ON public.queue(patient_id);
CREATE INDEX IF NOT EXISTS idx_referrals_org_id                        ON public.referrals(org_id);
CREATE INDEX IF NOT EXISTS idx_referrals_site_id                       ON public.referrals(site_id);
CREATE INDEX IF NOT EXISTS idx_stage_events_ticket_id                  ON public.stage_events(ticket_id);
CREATE INDEX IF NOT EXISTS idx_stock_moves_nm_item_id                  ON public.stock_moves_nm(item_id);
CREATE INDEX IF NOT EXISTS idx_stock_moves_rx_batch_id                 ON public.stock_moves_rx(batch_id);
CREATE INDEX IF NOT EXISTS idx_stock_moves_rx_item_id                  ON public.stock_moves_rx(item_id);
CREATE INDEX IF NOT EXISTS idx_user_org_sites_site_id                  ON public.user_org_sites(site_id);
CREATE INDEX IF NOT EXISTS idx_visits_patient_id                       ON public.visits(patient_id);
CREATE INDEX IF NOT EXISTS idx_vitals_patient_id                       ON public.vitals(patient_id);
CREATE INDEX IF NOT EXISTS idx_vitals_visit_id                         ON public.vitals(visit_id);

-- ----------------------------------------------------------------------------
-- 2. Drop duplicate indexes (4 pairs)
-- ----------------------------------------------------------------------------
-- For each pair, we keep the longer, more descriptive name and drop the
-- shorter shim. Picks chosen so that any application code referencing the
-- index by name keeps working (the codebase doesn't reference these by name,
-- but it's still a kinder default).

DROP INDEX IF EXISTS public.idx_med_reminders_patient;
DROP INDEX IF EXISTS public.idx_med_reminders_scheduled;
DROP INDEX IF EXISTS public.idx_triage_patient;
DROP INDEX IF EXISTS public.idx_triage_priority;

-- End.
