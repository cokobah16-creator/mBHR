/*
  # Public read access for announced outreach events

  The patient-portal "Find Outreach Near Me" page (OutreachFinder) is used by
  patients who authenticate via portal OTP sessions on the anon key — but
  outreach_events has org-member-only SELECT policies, so the portal could
  never list events. Outreach days are public information (they are announced
  by SMS broadcast), so allow read-only access to upcoming announced events
  and to the active sites that host them.

  Scope kept deliberately narrow:
  - only events with status 'planned' or 'active' (not cancelled/completed
    history), and
  - only active sites (needed for the embedded site name/address in the
    portal listing).
  Writes remain governed by the existing org-membership policies.
*/

DROP POLICY IF EXISTS "Public can view announced outreach events" ON outreach_events;
CREATE POLICY "Public can view announced outreach events"
  ON outreach_events FOR SELECT
  TO anon, authenticated
  USING (status IN ('planned', 'active'));

DROP POLICY IF EXISTS "Public can view active sites" ON sites;
CREATE POLICY "Public can view active sites"
  ON sites FOR SELECT
  TO anon, authenticated
  USING (is_active = true);
