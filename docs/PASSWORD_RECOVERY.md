# Password recovery

Covers accounts that sign in with **email + password through Supabase**: online
staff sign-in (`/login` → Online) and the patient portal (`/patient/login`).

| Step | Route | What happens |
| --- | --- | --- |
| 1. Request | `/forgot-password` (staff), `/patient/forgot-password` (patients), or Patient portal → Account → Security | `supabase.auth.resetPasswordForEmail` sends a one-time link that comes back to `/reset-password?for=staff\|patient`. The confirmation is identical whether or not the address has an account. |
| 2. Land | `/reset-password` | supabase-js exchanges the link's token for a recovery session. Expired/used links show "Request a new link". A visit without a recovery token in the URL is refused. `?for=` decides where the page's "sign in" links point; a link that lost it (see the Site URL fallback below) gets that from the recovery session instead (staff = has an `app_users` row, whose `id` is the account's user id). If the token in the link names a different account than the session the page ends up with, the page refuses (see "Session check" below). |
| 3. Set | `/reset-password` | New password (min 8 chars, confirmed) saved with `updateUser`, then `signOut({ scope: "global" })` ends every session for the account. Staff accounts also get the password-set marker (below). User is sent back to the correct login page. |

Code: `src/services/passwordReset.ts`, `src/pages/ForgotPassword.tsx`,
`src/pages/ResetPassword.tsx`, `src/lib/recoveryLanding.ts`.

## Staff invitations

A staff member added on the Users screen gets an invitation email from the
`staff-admin` edge function. The invitation lands on the same `/reset-password`
page, which then says "Set your password" instead of "Choose a new password".
The page accepts two link formats:

| Format | What the link looks like | What the page does |
| --- | --- | --- |
| Documented template (preferred; see [deployment/STAFF_INVITE_EMAIL.md](deployment/STAFF_INVITE_EMAIL.md)) | `https://mbhr.app/reset-password?for=staff&link=invite&token_hash=…&type=invite` | Shows "Welcome to mBHR. Press Continue to set your password." with a **Continue** button. Only pressing it redeems the code (`verifyOtp({ token_hash, type: "invite" })`). Nothing happens on page load, so a mail scanner that opens the link does not use it up. Any session already stored in the browser is ignored until Continue succeeds. |
| Supabase's default template (`{{ .ConfirmationURL }}`) | Supabase's `/verify` link, which redirects to `https://mbhr.app/reset-password?for=staff&link=invite#access_token=…&type=invite` | supabase-js turns the hash token into a session (a `SIGNED_IN` event, not `PASSWORD_RECOVERY`) and the page shows the password form, as for a reset. A scanner that opens the link first does use it up. |

- `link=invite` is what makes the page word things as an invitation when
  the link has expired: Supabase's error redirect keeps the query string but
  drops `type`. An expired or used invitation shows "This invitation link has
  expired or was already used. Ask your administrator to send a new one." and
  no "Request a new link" button, because only an administrator can send a
  new invitation.
- An invitation token that lands on another page (for example the home page,
  after a Site URL fallback) is moved to `/reset-password` just like a
  recovery token (`src/lib/recoveryLanding.ts`). Signup confirmations are
  never moved.
- After saving, the page says "Your password is set. Sign in with your email
  and this password. The first time you sign in on a device, you'll also
  choose a PIN for offline use."

### Password-set marker

When a staff account (`?for=staff`, or an `app_users` row) or an invitation
saves a password, the page also writes `user_metadata.mbhr_password_set_at`
(the time, in ISO format) in the same `updateUser` call. Patient resets do not
write it. The Users screen uses it only to label an account's status (for
example, whether an invited person has set a password yet). It is **display
only**: `user_metadata` can be edited by the signed-in user themselves, so
nothing may use it to grant or refuse access.

### Session check

When the link carries an access token in the hash (a reset, or a
default-template invitation), the page reads the token's `sub` claim (the
account id; the token itself is verified by Supabase, not by the page). If the
session the page ends up with belongs to a different account, the page shows
"This link is for a different account than the one signed in on this browser.
Sign out, then open the link again." and never offers the password form. This
stops the page from setting a password on whichever account happens to be
signed in on a shared browser. The token_hash format needs no such check: the
session comes straight from redeeming the code.

## Not covered (by design)

- **Offline staff PINs** live only on the device. An administrator resets them under **Users** (edit the user, set a new PIN). The login screen says so.
- **Offline patient PINs** are reset by clinic staff.

## Supabase setup (hosted project)

These settings live in the Supabase dashboard for the project, not in this
repository. `supabase/config.toml` carries the same values for the local stack
only.

### 1. Authentication → URL Configuration

Supabase only sends a user to the URL the app asked for (`redirectTo`) when
that URL is on the **Redirect URLs** allow list or on the **Site URL**'s host.
If it is neither, there is no error: the email link silently redirects to the
Site URL instead, with the token still in the URL. With the Site URL pointing
at the home page, a reset link just opens the home page and nothing happens.

| Setting | Value |
| --- | --- |
| Site URL | `https://mbhr.app` |
| Redirect URLs | `https://mbhr.app/reset-password**` |
| | `https://mbhr.app/auth/callback` |
| | `https://m-bhr.vercel.app/reset-password**` (old Vercel alias, redirects to `mbhr.app`; keeps links sent before the move working) |
| | `https://m-bhr.vercel.app/auth/callback` |
| | `http://localhost:5173/**` (only if you run the app locally against the hosted project) |

Rules that matter here:

- An entry matches the whole URL. `*` never crosses `.` or `/`; `**` matches
  anything, including a query string. The reset link carries `?for=`, which is
  why its entry ends in `**`. A plain `https://<host>/reset-password` entry
  only works while that host is the Site URL's host (that is exactly what
  broke the `m-bhr.vercel.app` entries when the Site URL moved).
- Any URL on the Site URL's host is accepted, so the two `mbhr.app` entries
  are belt-and-braces: they keep working if the Site URL is ever moved again.
- **No wildcard hosts.** Not `https://*.vercel.app/...`, and not
  `https://*-cokobah16-3045s-projects.vercel.app/**` either. Vercel hands out
  `.vercel.app` project names and team slugs first come, first served, so a
  stranger can obtain a host that matches such a pattern, request a reset for
  any address with the public anon key, and receive that user's recovery token.
- Preview deployments need no entry. A reset requested from a preview falls
  back to the Site URL, and the production app completes it (the app moves a
  recovery token that lands on any page to `/reset-password`). To exercise the
  reset page on one specific preview, add its exact URL temporarily, e.g.
  `https://m-bhr-git-<branch>-cokobah16-3045s-projects.vercel.app/reset-password**`,
  and remove it afterwards.
- If the production domain changes again, update the Site URL and add the
  same two entries for the new host; keep the old host's entries until every
  link sent before the move has expired (an hour) or the old host stops
  redirecting to the new one.

Optional hardening: Authentication → Sign In / Providers → Email → **Secure
password change** makes Supabase refuse a password change from a session that
did not sign in recently. A recovery link creates a fresh session, so the
reset flow still works, but a stale session that somehow reaches
`updateUser` no longer can.

### 2. Authentication → Emails → SMTP settings

Configure a real SMTP sender (for example Resend, Postmark or Brevo). Until
you do, Supabase's built-in sender **only delivers to email addresses of
members of the Supabase organisation**; every other address fails with "Email
address not authorized", and the app cannot tell the user that (it must answer
the same way whether or not an account exists). The built-in sender is also
rate-limited to a handful of messages per hour and has no delivery guarantee.

### 3. Optional: Reset Password email template

Authentication → Emails → Templates → Reset Password. Keep
`{{ .ConfirmationURL }}` as the link.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| The link in the email opens the home page (or any page other than `/reset-password`). | The redirect URL is not on the allow list and not on the Site URL's host, so Supabase sent the user to the Site URL. | Step 1 above. The app now moves a recovery token that lands on the wrong page to `/reset-password` on its own, so the reset still completes, but fix the settings anyway. |
| "This reset link has expired or has already been used." | Links work once and expire after an hour. The first click already consumed it, even if that click only showed the home page. Some mail clients also open links to scan them. | Request a new link. |
| "This invitation link has expired or was already used." | Same as above, for an invitation. With the default template a mail scanner may have used the link before the person clicked it. | An administrator uses **Resend invitation** on the Users screen. Install the documented template ([deployment/STAFF_INVITE_EMAIL.md](deployment/STAFF_INVITE_EMAIL.md)) so scanners stop using links up. |
| "This link is for a different account than the one signed in on this browser." | Another account's session was found on this browser instead of the one the link was issued for. | Sign out of mBHR in this browser, then open the link from the email again. |
| "Check your email" but nothing arrives, for anyone who is not on the Supabase team. | Built-in sender. | Step 2 above. |
| Auth logs show `POST /recover` followed by `GET /verify … redirect_to=<Site URL>` | Same as the first row; the `redirect_to` on the verify link is the fallback, not the URL the app asked for. | Step 1 above. |

The project's auth logs are under Logs → Auth in the dashboard; each reset
shows up as `user_recovery_requested`, `mail.send`, then the `/verify` request
when the link is clicked.
