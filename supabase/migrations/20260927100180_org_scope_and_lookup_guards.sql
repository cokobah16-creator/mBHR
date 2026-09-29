/*
  # Organization memberships, merged-record lookups and opening stock

  From the signed-in functions check of 28 Sept 2026
  (/mnt/project-files/hris-transform/secdef-audit-2026-09-28.md, G4-1,
  G4-2 and F2).

  ## What was wrong
  - G4-1: canonical_patient_id told any signed-in caller where a merged
    patient record went. A portal patient (or a guest account) who knew a
    record's id could learn the surviving record's id, which patient
    row security hides from them.
  - G4-2: a holder of 'users' (admins) could change the organization on
    their own membership row to any other organization, which then gave
    them that organization's referrals, flags, follow-ups and reviews and
    its membership rows. Any member of an organization, a volunteer
    included, could rename it, switch it off or delete it (the delete
    removed all its sites and memberships), and do the same to its sites.
  - F2: opening stock for a site could be uploaded onto a medicine from a
    different site's stock list, and it claimed that site's one opening
    upload.

  ## Changes
  1. canonical_patient_id: a signed-in caller who is not staff gets the
     surviving record only when it is one of their own portal records;
     otherwise the id comes back unchanged, as for a record that was never
     merged. Staff, the service role and the functions and triggers acting
     for staff keep the full lookup.
  2. user_org_sites: adding a membership, or changing who, which
     organization or which site a membership is for, needs 'users' and an
     organization the caller already belongs to, and the site has to be in
     that organization. Changing only is_default (the app's one change to
     its own rows) is unchanged.
  3. organizations and sites: members still read them. Changing an
     organization, or adding or changing a site, needs 'users' in that
     organization. Deleting either is left to the service role.
  4. rx_receive_stock: opening stock for a site is accepted only on a
     medicine of that site's stock list (or one with no site). Otherwise
     it is refused ('site_mismatch'); the device keeps the counted
     quantity, as for any refused opening stock. An opening upload refused
     because its lot belongs to another medicine ('batch_item_mismatch')
     no longer takes the site's one opening upload first.

  ## Not changed
  - The server does not know which site a pharmacist works at (a site key
    is the name set on the device; user_org_sites is not used by the
    pharmacy). An inventory holder can still take another site's opening
    upload by first registering a medicine for that site. The claim
    records who took it (claimed_by), and clearing a wrong claim still
    needs the dashboard.
  - A medicine with no site takes opening stock from any site, as the
    server's own list may have medicines without one.
  - A device id shown in pharmacy_site_onboarding still lets another
    device add opening stock for that site. It gives nothing a plain
    stock receipt does not.
  - A caller with no signed-in account (the service role, migrations, and
    the merged-record trigger on a sign-in-less insert) keeps the full
    lookup; anon cannot run canonical_patient_id itself.
  - Grants, and every function's signature.

  ## Rollback
    CREATE OR REPLACE canonical_patient_id from
    20260925100000_sync_authority_foundation.sql and rx_receive_stock from
    20260925100400_pharmacy_stock_ledger.sql;
    DROP TRIGGER user_org_sites_scope ON public.user_org_sites;
    DROP FUNCTION public.tg_user_org_sites_scope();
    DROP POLICY organizations_update_users ON public.organizations;
    DROP POLICY sites_insert_users ON public.sites;
    DROP POLICY sites_update_users ON public.sites;
    and re-create "Admins can manage their organizations" and
    "Admins can manage sites in their organizations" as they were in
    20260517211155_wrap_auth_uid_in_rls_policies.sql.
*/

SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Merged-record lookup (G4-1)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.canonical_patient_id(p_id text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_cur text := p_id;
  v_next text;
  i integer := 0;
BEGIN
  IF p_id IS NULL THEN
    RETURN NULL;
  END IF;
  LOOP
    SELECT p.merged_into::text INTO v_next
      FROM public.patients AS p
     WHERE p.id::text = v_cur;
    EXIT WHEN v_next IS NULL OR i >= 10;
    v_cur := v_next;
    i := i + 1;
  END LOOP;
  -- A signed-in caller who is not staff (a portal patient, a guest) is told
  -- where a merged record went only when it went to one of their own
  -- records (20260927100180).
  IF v_cur IS DISTINCT FROM p_id
     AND auth.uid() IS NOT NULL
     AND NOT public.app_is_staff()
     AND v_cur NOT IN (SELECT public.app_portal_patient_ids()) THEN
    RETURN p_id;
  END IF;
  RETURN v_cur;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. Membership changes stay within the caller's organizations (G4-2)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_user_org_sites_scope()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  -- The service role and migrations (no signed-in account) are not limited.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT'
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.org_id IS DISTINCT FROM OLD.org_id
     OR NEW.site_id IS DISTINCT FROM OLD.site_id THEN
    IF NOT public.app_has_permission('users')
       OR NEW.org_id IS NULL
       OR NEW.org_id::text NOT IN (SELECT public.app_org_ids()) THEN
      RAISE EXCEPTION 'This account can add or move memberships only within its own organizations.'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.site_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.sites AS s
          WHERE s.id = NEW.site_id AND s.org_id = NEW.org_id) THEN
      RAISE EXCEPTION 'That site is not in that organization.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_user_org_sites_scope() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS user_org_sites_scope ON public.user_org_sites;
CREATE TRIGGER user_org_sites_scope
  BEFORE INSERT OR UPDATE ON public.user_org_sites
  FOR EACH ROW EXECUTE FUNCTION public.tg_user_org_sites_scope();

-- ---------------------------------------------------------------------------
-- 3. Organizations and sites: members read, 'users' holders change (G4-2)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admins can manage their organizations" ON public.organizations;
DROP POLICY IF EXISTS organizations_update_users ON public.organizations;
CREATE POLICY organizations_update_users ON public.organizations
  FOR UPDATE TO authenticated
  USING ((SELECT public.app_has_permission('users')) AND id::text IN (SELECT public.app_org_ids()))
  WITH CHECK ((SELECT public.app_has_permission('users')) AND id::text IN (SELECT public.app_org_ids()));

DROP POLICY IF EXISTS "Admins can manage sites in their organizations" ON public.sites;
DROP POLICY IF EXISTS sites_insert_users ON public.sites;
DROP POLICY IF EXISTS sites_update_users ON public.sites;
CREATE POLICY sites_insert_users ON public.sites
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.app_has_permission('users')) AND org_id::text IN (SELECT public.app_org_ids()));
CREATE POLICY sites_update_users ON public.sites
  FOR UPDATE TO authenticated
  USING ((SELECT public.app_has_permission('users')) AND org_id::text IN (SELECT public.app_org_ids()))
  WITH CHECK ((SELECT public.app_has_permission('users')) AND org_id::text IN (SELECT public.app_org_ids()));

-- ---------------------------------------------------------------------------
-- 4. Opening stock goes onto that site's medicines (F2)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rx_receive_stock(p_command_id uuid, p_movement_id text, p_batch jsonb, p_qty integer, p_reason text DEFAULT 'receipt'::text, p_occurred_at timestamp with time zone DEFAULT now(), p_requested_by text DEFAULT NULL::text, p_site_key text DEFAULT NULL::text, p_device_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_prior jsonb;
  v_item text := public.app_rx_item_id(p_batch ->> 'item_id');
  v_batch_id text := p_batch ->> 'id';
  v_claim text;
  v_new_claim text;
  v_batch public.pharmacy_batches%ROWTYPE;
  v_item_row public.pharmacy_items%ROWTYPE;
BEGIN
  IF NOT public.app_has_permission('inventory') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;
  v_prior := public.app_command_prior_result(p_command_id, 'rx_receive_stock');
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;

  IF p_qty IS NULL OR p_qty <= 0 THEN
    RETURN public.app_command_record(p_command_id, 'rx_receive_stock', 'rejected',
      jsonb_build_object('reason', 'invalid_quantity'), p_requested_by, p_occurred_at);
  END IF;
  IF p_reason NOT IN ('receipt', 'opening_balance') OR v_batch_id IS NULL OR p_movement_id IS NULL THEN
    RETURN public.app_command_record(p_command_id, 'rx_receive_stock', 'rejected',
      jsonb_build_object('reason', 'invalid_request'), p_requested_by, p_occurred_at);
  END IF;

  -- Lock order: medicine, then lot.
  SELECT * INTO v_item_row FROM public.pharmacy_items WHERE id = v_item FOR UPDATE;
  IF NOT FOUND THEN
    RETURN public.app_command_record(p_command_id, 'rx_receive_stock', 'rejected',
      jsonb_build_object('reason', 'item_not_found'), p_requested_by, p_occurred_at);
  END IF;

  IF p_reason = 'opening_balance' THEN
    IF NULLIF(p_site_key, '') IS NULL OR NULLIF(p_device_id, '') IS NULL THEN
      RETURN public.app_command_record(p_command_id, 'rx_receive_stock', 'rejected',
        jsonb_build_object('reason', 'invalid_request'), p_requested_by, p_occurred_at);
    END IF;
    -- A site's opening stock goes onto that site's medicines (20260927100180).
    IF NULLIF(v_item_row.site_key, '') IS NOT NULL AND v_item_row.site_key <> p_site_key THEN
      RETURN public.app_command_record(p_command_id, 'rx_receive_stock', 'rejected',
        jsonb_build_object('reason', 'site_mismatch'), p_requested_by, p_occurred_at);
    END IF;
    -- A refused upload does not take the site's opening slot (20260927100180).
    IF EXISTS (SELECT 1 FROM public.pharmacy_batches AS b WHERE b.id = v_batch_id AND b.item_id <> v_item) THEN
      RETURN public.app_command_record(p_command_id, 'rx_receive_stock', 'rejected',
        jsonb_build_object('reason', 'batch_item_mismatch'), p_requested_by, p_occurred_at);
    END IF;
    INSERT INTO public.pharmacy_site_onboarding (site_key, device_id)
    VALUES (p_site_key, p_device_id)
    ON CONFLICT (site_key) DO NOTHING
    RETURNING site_key INTO v_new_claim;
    SELECT device_id INTO v_claim FROM public.pharmacy_site_onboarding WHERE site_key = p_site_key;
    IF v_claim IS DISTINCT FROM p_device_id THEN
      RETURN public.app_command_record(p_command_id, 'rx_receive_stock', 'rejected',
        jsonb_build_object('reason', 'opening_stock_already_uploaded'), p_requested_by, p_occurred_at);
    END IF;
  END IF;

  INSERT INTO public.pharmacy_batches (id, item_id, lot_number, expiry_date, qty_on_hand, received_at, supplier)
  VALUES (
    v_batch_id, v_item, COALESCE(p_batch ->> 'lot_number', ''),
    (p_batch ->> 'expiry_date')::date, 0,
    COALESCE(((p_batch ->> 'received_at')::timestamptz AT TIME ZONE 'Africa/Lagos')::date,
             (now() AT TIME ZONE 'Africa/Lagos')::date),
    NULLIF(p_batch ->> 'supplier', ''))
  ON CONFLICT (id) DO NOTHING;

  SELECT * INTO v_batch FROM public.pharmacy_batches WHERE id = v_batch_id FOR UPDATE;
  IF v_batch.item_id <> v_item THEN
    -- The lot was made for another medicine at the same moment: a claim
    -- this upload just took is given back (20260927100180).
    IF v_new_claim IS NOT NULL THEN
      DELETE FROM public.pharmacy_site_onboarding
       WHERE site_key = p_site_key AND device_id = p_device_id;
    END IF;
    RETURN public.app_command_record(p_command_id, 'rx_receive_stock', 'rejected',
      jsonb_build_object('reason', 'batch_item_mismatch'), p_requested_by, p_occurred_at);
  END IF;

  INSERT INTO public.stock_movements (
    id, item_id, batch_id, qty_delta, reason, command_id, requested_by, occurred_at)
  VALUES (p_movement_id, v_item, v_batch_id, p_qty, p_reason, p_command_id, p_requested_by,
          COALESCE(p_occurred_at, now()));
  UPDATE public.pharmacy_batches SET qty_on_hand = qty_on_hand + p_qty WHERE id = v_batch_id;
  UPDATE public.pharmacy_items SET on_hand_qty = on_hand_qty + p_qty WHERE id = v_item;

  RETURN public.app_command_record(p_command_id, 'rx_receive_stock', 'applied',
    jsonb_build_object(
      'batch_id', v_batch_id,
      'items', (SELECT jsonb_agg(jsonb_build_object('id', id, 'on_hand_qty', on_hand_qty, 'row_version', row_version))
                  FROM public.pharmacy_items WHERE id = v_item),
      'batches', (SELECT jsonb_agg(jsonb_build_object('id', id, 'qty_on_hand', qty_on_hand, 'row_version', row_version))
                    FROM public.pharmacy_batches WHERE id = v_batch_id)),
    p_requested_by, p_occurred_at);
END;
$function$;
