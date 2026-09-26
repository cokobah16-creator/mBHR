# Staff admin function (`staff-admin`)

`staff-admin` is the server side of staff accounts. It adds staff members,
sends their invitation and password reset emails, and disables and
reactivates their accounts. It runs as a Supabase edge function, because
those jobs need the project's service key, which must never reach a browser.

Only signed-in administrators can use it (a PIN unlock is not enough). It
never accepts or stores a PIN: PINs stay on each device.

**Merging code does not deploy it.** It changes nothing for anyone until you
deploy it, and the Users screen only starts using it in a later update.
This holds even with "Deploy to production" on in Supabase's GitHub
integration, because that integration deploys only the functions declared in
`supabase/config.toml`, and none is. Keep it that way: the workflow's check
fails if a `[functions.<name>]` section is added there.

Two rules are built in:

- **Disable** blocks the person's sign-in and also removes their role until
  they are reactivated. Reactivate gives the role back.
- **Only a permanent administrator can add or restore an administrator.**
  Any administrator can give the other staff roles: volunteer, registration
  lead, nurse, doctor, pharmacist, lead clinician and auditor. Setting
  `ADMIN_ACCOUNTS_ENABLED` to `false` in
  `supabase/functions/_shared/staff/constants.ts` (then redeploying)
  refuses every administrator change instead.

This page covers, in order:

1. [Before you deploy](#1-before-you-deploy)
2. [Set the function's secrets](#2-set-the-functions-secrets)
3. [Try it on a spare project](#3-try-it-on-a-spare-project)
4. [Deploy to production (the normal way)](#4-deploy-to-production-the-normal-way)
5. [Check it answers](#5-check-it-answers)
6. [Test it end to end](#6-test-it-end-to-end)
7. [Fallback: deploy from the command line](#7-fallback-deploy-from-the-command-line)
8. [Undo a deploy](#8-undo-a-deploy)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. Before you deploy

Do these once, in the Supabase dashboard for the production project.

1. **Make sure the old leaked Resend keys cannot send mail as mBHR.** Revoke
   every Resend key that has ever appeared in this repository's history. If
   Supabase's outgoing email uses Resend, create a new key and put it only in
   the Supabase dashboard, never in the repository. Do not send any
   invitation until this is done.
2. **Set up outgoing email:** Authentication > Emails > SMTP settings. Without
   it, invitations only reach members of your Supabase organisation. Details
   are in section 2 of [PASSWORD_RECOVERY.md](../PASSWORD_RECOVERY.md).
3. **Check the addresses:** Authentication > URL Configuration.
   - **Site URL** is exactly `https://mbhr.app` (no slash at the end).
   - **Redirect URLs** include `https://mbhr.app/reset-password**` (with the
     two stars). The full list is in section 1 of
     [PASSWORD_RECOVERY.md](../PASSWORD_RECOVERY.md).
4. **Install the invitation email:** follow
   [STAFF_INVITE_EMAIL.md](STAFF_INVITE_EMAIL.md) to paste the template into
   Authentication > Emails > Templates > **Invite user**. Leave the **Reset
   password** template alone: patients use it too.
5. **Note the link lifetime:** Authentication > Sign In / Providers > Email,
   the setting **Email OTP Expiration**. The default is 3600 seconds (1 hour).
   You need this number in the next section.
6. **Check the rate-limit database function exists.** Open the SQL editor,
   run this (it only reads), and check the answer is not empty (`NULL`):

   ```sql
   select to_regprocedure('public.check_and_increment_rate_limit(text,text,integer,integer)');
   ```

   If it is empty, every staff account action will say it is paused. Apply
   the database migrations first (Actions > Database migrations).
7. **Check GitHub will ask for your approval.** In GitHub, go to the
   repository's Settings > Environments > **production**. Under **Required
   reviewers**, you should be listed. The same environment must hold two
   secrets, which the Database migrations workflow already uses:
   `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF`.

## 2. Set the function's secrets

The function reads its settings from the project's edge function secrets.
Secrets are shared by every edge function in the project, so some of these
may already be set.

1. Open the Supabase dashboard and choose the production project.
2. Go to **Edge Functions > Secrets**.
3. For each row in the table below, check whether the name is already there.
   Add any that are missing (name on the left, value on the right) and press
   **Save**.
4. You do not need to redeploy after changing a secret. New requests use the
   new value.

| Name | Needed? | Example value | What it does |
| --- | --- | --- | --- |
| `ALLOWED_ORIGINS` | **Required** | `https://mbhr.app,https://m-bhr.vercel.app` | The web addresses allowed to call the function, separated by commas, each with no slash at the end. Without it, every staff action replies "Staff account setup isn't finished on this server yet." It is shared with the other functions: if it is already set, just make sure `https://mbhr.app` is in it. |
| `RATE_LIMIT_KEY_SALT` | **Required** | a long random value, at least 40 characters | Scrambles email addresses before the function counts how many emails each address has been sent, so the counts never store an address. Make it with a password manager's generator. The SMS functions use it too: if it is already set, leave it as it is. |
| `STAFF_APP_ORIGIN` | Recommended | `https://mbhr.app` | The app address that invitation and password reset links point to. It must start with `https://` and have nothing after the domain. If it is missing or not valid, the function uses `https://mbhr.app`. Only staff invitations and staff reset links use it. Patient invitations use `PORTAL_APP_ORIGIN`. |
| `STAFF_INVITE_LIFETIME_SECONDS` | Recommended | `3600` | The **Email OTP Expiration** number from section 1, step 5. A whole number from 300 to 86400. It only decides when the Users screen shows an invitation as expired; Supabase decides how long the link really works, so the two must match. If missing, 3600 is used. |
| `STAFF_ADMIN_LAUNCHED_AT` | Optional | `2026-09-26` | The day you start using the Users screen to add staff (year-month-day). When it is set, Account Health also lists staff records created after that day that were not added from the Users screen, for information only. Set it to the day you deploy. |

Never set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_ANON_KEY`
yourself: Supabase provides them.

## 3. Try it on a spare project

Supabase does not document some of what the function relies on, so it must
be proven once on a throwaway project before the Users screen update (the
next pull request) is merged. This step needs a developer, because the
workflow below only deploys to production.

1. Create a new, empty Supabase project. Set it up as in sections 1 and 2.
2. The developer deploys the function there with the command line
   (section 7, with the spare project's reference).
3. Using your own spare email address, confirm each of these:
   1. a login can be created with an id chosen in advance;
   2. an invitation can be sent to that login while it is not yet confirmed;
   3. both invitation link formats (the template in
      [STAFF_INVITE_EMAIL.md](STAFF_INVITE_EMAIL.md), and the default one)
      open `/reset-password` and let you set a password;
   4. after Disable, the login shows a "banned until" date;
   5. a banned login cannot sign in (Supabase refuses it with `user_banned`);
   6. updating a login's hidden settings (`app_metadata`) keeps the settings
      that were already there;
   7. adding the same id twice, and the same email twice, give clear errors.
4. Delete the spare project when you are done.

## 4. Deploy to production (the normal way)

Deploying is done from GitHub with the **Deploy edge functions** workflow. It
type-checks the function first (on pull requests it also type-checks
`staff-admin` automatically), and it only deploys after you type a confirmation phrase and approve the run.

**First, check the function** (safe, changes nothing):

1. Make sure the change that contains `staff-admin` has been merged into
   `mainone`.
2. In GitHub, open the repository and go to the **Actions** tab.
3. In the list on the left, choose **Deploy edge functions**.
4. Press **Run workflow** (on the right). Fill in the form:
   - **Use workflow from:** `mainone`
   - **action:** `check`
   - **function:** `staff-admin`
   - **confirm:** leave empty
   - **typecheck:** leave ticked
5. Press the green **Run workflow** button. After a few seconds the run
   appears in the list; open it.
6. Wait for a green tick. This needs no approval. If it turns red, stop here:
   open the **Check** job, copy the error from the "Type-check the function"
   step, and pass it to a developer.

**Then deploy:**

7. Press **Run workflow** again. Fill in the form:
   - **Use workflow from:** `mainone`
   - **action:** `deploy`
   - **function:** `staff-admin`
   - **confirm:** `deploy to production` (exactly, in lower case, without
     quotes)
   - **typecheck:** leave ticked
8. Press **Run workflow** and open the new run. The check runs again first.
9. The run then stops at **Production** with "Waiting for review". Press
   **Review deployments**, tick **production**, and press **Approve and
   deploy**.
10. Wait for a green tick. Open the **Production** job: the step "Functions
    deployed on production afterwards" lists `staff-admin` as `ACTIVE`, with
    a version number and today's date.
11. Write down the date. The function uses the newest version of the Supabase
    library that exists on the day it is deployed, so the date helps trace a
    problem that appears after a redeploy.
12. Check the secrets from section 2 are all there, then go to section 5.

**To see what is deployed** without changing anything, run the workflow with
**action** `list`. It needs your approval too, because it signs in to
production.

**Redeploy after a change.** Run the same steps whenever a change to
`supabase/functions/staff-admin` or to `supabase/functions/_shared` is merged.
Each function carries its own copy of the shared code, so a change to
`_shared` only reaches the functions you redeploy.

### What the workflow's error messages mean

| Message | What to do |
| --- | --- |
| "To deploy to production, type exactly: deploy to production" | Run it again and retype the phrase in the confirm box. |
| "Deploy from mainone, the branch production is deployed from" | Run it again and choose `mainone` under **Use workflow from**. |
| "Missing secrets in the production environment: ..." | Add the named secret under Settings > Environments > production. `SUPABASE_ACCESS_TOKEN` comes from your Supabase account page (Access Tokens); `SUPABASE_PROJECT_REF` is the project's reference, shown in its settings. |
| "supabase/functions/staff-admin/index.ts does not exist on this branch" | The branch you chose does not have the function yet. Merge it first, or choose the right branch. |
| "supabase/config.toml declares an edge function" | Someone added a `[functions.<name>]` section. Remove it: Supabase's GitHub integration would deploy that function on every merge. |
| The run never stops for approval | Nobody is set as a required reviewer. Fix it as in section 1, step 7, before deploying again. |

## 5. Check it answers

This sends the function a harmless "are you there?" request.

1. In the Supabase dashboard, go to Project Settings > API Keys and copy the
   **anon** key (the long one that starts with `eyJ`). It is a public key.
2. Note the project reference (Project Settings > General).
3. On a computer with a terminal, run this, with your values in place of the
   two `<...>` parts:

   ```sh
   curl -X POST "https://<project-ref>.supabase.co/functions/v1/staff-admin" \
     -H "Authorization: Bearer <anon key>" \
     -H "Content-Type: application/json" \
     -d '{"action":"ping"}'
   ```

4. The reply should contain `"fn":"staff-admin"` and `"success":true`, plus a
   version number.

If the reply says the function was not found, the deploy did not happen. If it is
"Invalid JWT" or similar, the project may be using the newer publishable keys,
which this test cannot use; the app itself is not affected, because it calls
the function with the signed-in administrator's own session. Check the
function is listed as `ACTIVE` (section 4, step 10) instead.

## 6. Test it end to end

Once the Users screen update is live:

1. Sign in online at mbhr.app as yourself.
2. On **Users**, add a test staff member with an email address you control.
3. Open the invitation email, press the link, press **Continue**, and set a
   password.
4. Sign in at mbhr.app as the test person and choose a PIN.
5. Back as yourself, **Disable** the test person, check they can no longer
   sign in, then **Reactivate** them and check they can.

From then on, add and change staff only on the **Users** screen. Never create
or edit staff in the Supabase dashboard. If something looks wrong, check
**Account Health** on the Users screen first.

## 7. Fallback: deploy from the command line

Use this only if the workflow cannot be used, or to deploy to a spare project.
It needs the Supabase CLI, Deno and a Supabase access token on your computer.

```sh
# From the repository root. Type-check first: nothing else does.
DENO_NO_PACKAGE_JSON=1 deno check supabase/functions/staff-admin/index.ts

# Then deploy. <project-ref> is production's or the spare project's reference.
supabase functions deploy staff-admin --project-ref <project-ref>

# Confirm it is ACTIVE.
supabase functions list --project-ref <project-ref>
```

`DENO_NO_PACKAGE_JSON=1` stops Deno from using the web app's `package.json`,
so it does not look for a `node_modules` folder.

**Never add `--no-verify-jwt`.** The CLI checks the caller's JWT by
default, and that flag would turn it off.

## 8. Undo a deploy

To take the function away, delete it: in the dashboard go to Edge Functions,
open `staff-admin` and delete it, or run
`supabase functions delete staff-admin --project-ref <project-ref>`.

The Users screen then says staff account setup isn't available on this
server yet. Nothing
else changes: existing accounts, sign-in and PINs keep working. Deploy again
(section 4) when the problem is fixed.

To go back to an earlier version instead, revert the change on `mainone` and
deploy again.

## 9. Troubleshooting

| What you see on the Users screen | Likely cause | Fix |
| --- | --- | --- |
| "Staff account setup isn't available on this server yet" | The function is not deployed. | Section 4. |
| "Staff account setup isn't finished on this server yet" | `ALLOWED_ORIGINS` is not set. | Section 2. |
| "Staff account changes are paused for a moment" | The rate-limit database function is missing, or the database could not be reached. | Section 1, step 6. |
| The invitation never arrives | Outgoing email is not set up, or the address is not a member of your Supabase organisation while the built-in sender is in use. | Section 1, step 2. |
| The invitation link opens the home page | The Site URL or Redirect URLs are wrong. | Section 1, step 3. |
| The link says it expired the first time it is used | A mail scanner used up a default-template link. | Install the template in [STAFF_INVITE_EMAIL.md](STAFF_INVITE_EMAIL.md), then use **Resend invitation**. |
| Invitations show as expired too early or too late | `STAFF_INVITE_LIFETIME_SECONDS` does not match Email OTP Expiration. | Section 2. |
