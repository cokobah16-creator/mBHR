/*
  # Who did it, who sent it: attribution of dispenses, stock and merges

  From the signed-in functions check of 28 Sept 2026
  (/mnt/project-files/hris-transform/secdef-audit-2026-09-28.md, fix 3:
  attribution). What the server stores today:
  /mnt/project-files/hris-transform/attribution-survey-2026-09-28.md.

  ## What was wrong
  The pharmacy and merge functions stored the performer the device sent
  (p_requested_by, and each history row's dispensed_by) as the dispenser,
  the stock mover and the merger, without checking it. A pharmacist could
  record a dispense or a stock count under any name or id; an auditor could
  record a merge as someone else's. Work done offline is sent later, and a
  merge backfill or an onboarding history import legitimately names someone
  other than the sender, so the claim cannot simply be replaced by the
  sender (see role-fix-sync-paths-2026-09-28.md).

  ## Changes
  1. public.app_attributed_performer(text, text[]): the performer to
     record for a claim. The claim is kept when it is the signed-in
     account itself, or an active staff member whose role holds one of the
     given permissions; otherwise the signed-in account is recorded. A
     staff uuid is stored in lower case. With no signed-in account (the
     service role, migrations) the claim is kept as sent. Internal: no
     grant to anon or authenticated.
  2. dispenses: new server-set columns received_by (the account that sent
     the row) and received_at (server clock), for every row, whoever writes
     it; an update cannot change them. On a prescription dispense (written
     only by rx_dispense and rx_import_history) dispensed_by is checked as
     in 1 against 'dispense'; a replaced claim is kept in
     dispensed_by_claimed. A visit dispense (plain sync) keeps a display
     name as its dispensed_by; a staff id there is checked the same way,
     on insert and when an update changes it (the app shows a staff id as
     that person's name).
  3. stock_movements: requested_by is checked as in 1 ('dispense' for a
     dispense, 'inventory' for receipts, opening balances, adjustments and
     expiry, either for a reversal); a replaced claim is kept in
     requested_by_claimed. recorded_at (server clock) can no longer be
     supplied by the writer. actor_id (the sending account) is unchanged.
  4. prescriptions: a newly set dispensed_by, or a missing one on a
     prescription becoming dispensed or partial, is checked as in 1
     against 'dispense' or 'inventory' (history import records the
     uploader). The claim stays in command_receipts.requested_by.
  5. patient_merges: merged_by is checked as in 1 against
     'merge_patients'; actor_id is the sending account. The claim stays in
     requested_by as before.

  Device times (dispensed_at, occurred_at, requested_at) are kept as the
  device's clock; the server's received time is beside each one:
  dispenses.received_at (new), stock_movements.recorded_at,
  patient_merges.created_at and command_receipts.created_at.

  ## Not changed
  - Commands are still sent only under their author's online sign-in, so
    for a device's own work the claim is the sender and nothing changes.
  - A claim naming another active staff member who holds the permission is
    kept (a colleague's offline work, a merge backfill, an onboarding
    import); the sender is recorded beside it (received_by, actor_id). The
    server cannot tell whether that colleague really did the work.
  - History or a merge backfill naming someone no longer active (left,
    deactivated, demoted) or a device-only id is credited to the sender,
    with the device's value kept beside it; the app shows the server's
    dispenser after its next download.
  - A login banned only in the Auth dashboard (auth.users.banned_until)
    still counts as active staff here, as in app_staff_role_of; the
    staff-admin disable action also demotes the role, which is checked.
  - The client is unchanged: it shows the performer the server returns on
    its next download.
  - Plain table sync outside the pharmacy ledger still stores the device's
    names: consultations.provider_name, queue assigned_name, allergies
    created_by, conflict_audit_logs actor, visit dispenses; vitals have no
    performer column. Queue tickets are credited to the account that
    uploads them. Listed for a later fix.
  - Existing rows are not rewritten (production has none of these today).

  ## Rollback
    DROP TRIGGER zz_attribution ON public.dispenses, public.stock_movements,
    public.prescriptions and public.patient_merges; DROP FUNCTION the four
    tg_*_attribution() functions and
    public.app_attributed_performer(text, text[]). The new columns can
    stay (nullable, unused without the triggers).
*/

SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Which performer to record
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_attributed_performer(p_claim text, p_permissions text[])
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN p_claim;
  END IF;
  IF p_claim ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    IF p_claim::uuid = v_uid THEN
      RETURN v_uid::text;
    END IF;
    v_role := public.app_staff_role_of(p_claim::uuid);
    IF v_role IS NOT NULL AND EXISTS (
         SELECT 1 FROM unnest(p_permissions) AS perm
          WHERE public.app_role_has_permission(v_role, perm)) THEN
      RETURN p_claim::uuid::text;
    END IF;
  END IF;
  RETURN v_uid::text;
END;
$$;

COMMENT ON FUNCTION public.app_attributed_performer(text, text[]) IS
  'The performer to record for a device''s claim: the claim when it is the signed-in account or an active staff member holding one of the permissions, else the signed-in account (20260927100160).';

REVOKE ALL ON FUNCTION public.app_attributed_performer(text, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_attributed_performer(text, text[]) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. dispenses: who sent it and when; a checked dispenser
-- ---------------------------------------------------------------------------
ALTER TABLE public.dispenses
  ADD COLUMN IF NOT EXISTS received_by uuid,
  ADD COLUMN IF NOT EXISTS received_at timestamptz,
  ADD COLUMN IF NOT EXISTS dispensed_by_claimed text;

COMMENT ON COLUMN public.dispenses.received_by IS 'Account that sent the row to the server (server-set, 20260927100160).';
COMMENT ON COLUMN public.dispenses.received_at IS 'When the server received the row (server clock; dispensed_at is the device''s).';
COMMENT ON COLUMN public.dispenses.dispensed_by_claimed IS 'The dispenser the device named, when the server recorded someone else (20260927100160).';

CREATE OR REPLACE FUNCTION public.tg_dispenses_attribution()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_by text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.received_by := OLD.received_by;
    NEW.received_at := OLD.received_at;
    NEW.dispensed_by_claimed := OLD.dispensed_by_claimed;
    IF NEW.dispensed_by IS NOT DISTINCT FROM OLD.dispensed_by THEN
      RETURN NEW;
    END IF;
  ELSE
    NEW.received_by := auth.uid();
    NEW.received_at := clock_timestamp();
    NEW.dispensed_by_claimed := NULL;
  END IF;
  -- A prescription dispense always names a staff id. A visit dispense
  -- names a display name, which is kept; a staff id there is checked too,
  -- since the app shows it as that person's name.
  IF NEW.prescription_id IS NOT NULL
     OR NEW.dispensed_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_by := public.app_attributed_performer(NEW.dispensed_by, ARRAY['dispense']);
    IF v_by IS DISTINCT FROM NEW.dispensed_by THEN
      IF v_by IS DISTINCT FROM lower(NEW.dispensed_by) THEN
        NEW.dispensed_by_claimed := NEW.dispensed_by;
      END IF;
      NEW.dispensed_by := v_by;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_dispenses_attribution() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zz_attribution ON public.dispenses;
CREATE TRIGGER zz_attribution
  BEFORE INSERT OR UPDATE ON public.dispenses
  FOR EACH ROW EXECUTE FUNCTION public.tg_dispenses_attribution();

-- ---------------------------------------------------------------------------
-- 3. stock_movements: a checked mover; the server's clock
-- ---------------------------------------------------------------------------
ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS requested_by_claimed text;

COMMENT ON COLUMN public.stock_movements.requested_by_claimed IS 'The performer the device named, when the server recorded someone else (20260927100160).';

CREATE OR REPLACE FUNCTION public.tg_stock_movements_attribution()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_by text;
BEGIN
  NEW.recorded_at := clock_timestamp();
  NEW.requested_by_claimed := NULL;
  v_by := public.app_attributed_performer(NEW.requested_by,
    CASE NEW.reason
      WHEN 'dispense' THEN ARRAY['dispense']
      WHEN 'reversal' THEN ARRAY['dispense', 'inventory']
      ELSE ARRAY['inventory']
    END);
  IF v_by IS DISTINCT FROM NEW.requested_by THEN
    IF v_by IS DISTINCT FROM lower(NEW.requested_by) THEN
      NEW.requested_by_claimed := NEW.requested_by;
    END IF;
    NEW.requested_by := v_by;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_stock_movements_attribution() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zz_attribution ON public.stock_movements;
CREATE TRIGGER zz_attribution
  BEFORE INSERT ON public.stock_movements
  FOR EACH ROW EXECUTE FUNCTION public.tg_stock_movements_attribution();

-- ---------------------------------------------------------------------------
-- 4. prescriptions: a checked dispenser
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_prescriptions_attribution()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF (NEW.dispensed_by IS NOT NULL OR NEW.status IN ('dispensed', 'partial'))
     AND (TG_OP = 'INSERT'
          OR NEW.dispensed_by IS DISTINCT FROM OLD.dispensed_by
          OR NEW.status IS DISTINCT FROM OLD.status) THEN
    NEW.dispensed_by := public.app_attributed_performer(NEW.dispensed_by, ARRAY['dispense', 'inventory']);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_prescriptions_attribution() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zz_attribution ON public.prescriptions;
CREATE TRIGGER zz_attribution
  BEFORE INSERT OR UPDATE ON public.prescriptions
  FOR EACH ROW EXECUTE FUNCTION public.tg_prescriptions_attribution();

-- ---------------------------------------------------------------------------
-- 5. patient_merges: a checked merger; the sending account
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_patient_merges_attribution()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    NEW.actor_id := auth.uid();
    NEW.merged_by := public.app_attributed_performer(NEW.merged_by, ARRAY['merge_patients']);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_patient_merges_attribution() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zz_attribution ON public.patient_merges;
CREATE TRIGGER zz_attribution
  BEFORE INSERT ON public.patient_merges
  FOR EACH ROW EXECUTE FUNCTION public.tg_patient_merges_attribution();
