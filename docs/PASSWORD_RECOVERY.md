# Password recovery

Covers accounts that sign in with **email + password through Supabase**: online
staff sign-in (`/login` → Online) and the patient portal (`/patient/login`).

| Step | Route | What happens |
| --- | --- | --- |
| 1. Request | `/forgot-password` (staff), `/patient/forgot-password` (patients), or Patient portal → Account → Security | `supabase.auth.resetPasswordForEmail` sends a one-time link that comes back to `/reset-password`. The confirmation is identical whether or not the address has an account. |
| 2. Land | `/reset-password` | supabase-js exchanges the link's token for a recovery session. Expired/used links show "Request a new link". Visiting without a recovery link is refused, so a signed-in session alone cannot change the password here. The page looks up whether the account is staff (`staff_roles` row) or a patient, which only decides where its "sign in" links point. |
| 3. Set | `/reset-password` | New password (min 8 chars, confirmed) saved with `updateUser`, then `signOut({ scope: "global" })` ends every session for the account. User is sent back to the correct login page. |

Code: `src/services/passwordReset.ts`, `src/pages/ForgotPassword.tsx`,
`src/pages/ResetPassword.tsx`, `src/lib/recoveryLanding.ts`.

## Not covered (by design)

- **Offline staff PINs** live only on the device. An administrator resets them under **Users** (edit the user, set a new PIN). The login screen says so.
- **Offline patient PINs** are reset by clinic staff.

## Supabase setup (hosted project)

Both settings live in the Supabase dashboard for the project, not in this
repository. `supabase/config.toml` carries the same values for the local
stack only.

### 1. Authentication → URL Configuration

Supabase only sends a user to the URL the app asked for (`redirectTo`) when
that URL is on the **Redirect URLs** allow list. If it is not, there is no
error: the email link silently redirects to the **Site URL** instead, with the
token still in the URL. With the Site URL pointing at the home page, a reset
link just opens the home page and nothing happens.

| Setting | Value |
| --- | --- |
| Site URL | `https://m-bhr.vercel.app` |
| Redirect URLs | `https://m-bhr.vercel.app/reset-password` |
| | `https://m-bhr.vercel.app/auth/callback` |
| | `https://*-cokobah16-3045s-projects.vercel.app/**` (Vercel preview deployments) |
| | `http://localhost:5173/**` (only if you run the app locally against the hosted project) |

Rules that matter here:

- An entry matches the whole URL. `*` never crosses `.` or `/`; `**` matches
  anything, including a query string. The app therefore keeps its redirect
  URLs free of query strings, so the exact entries above are enough.
- Any URL on the Site URL's host is accepted, so the two `m-bhr.vercel.app`
  entries are belt-and-braces; the preview wildcard is what makes preview
  deployments work.
- Never allow-list `https://*.vercel.app/...`. Anyone can request a reset for
  any address with the public anon key and name their own Vercel site as the
  redirect, so that pattern would hand recovery tokens to an attacker.
- If the production domain changes (for example a custom domain), update the
  Site URL and add the two exact entries for the new host.

### 2. Authentication → Emails → SMTP settings

Configure a real SMTP sender (for example Resend or Postmark). Until you do,
Supabase's built-in sender **only delivers to email addresses of members of
the Supabase organisation**; every other address fails with "Email address
not authorized", and the app cannot tell the user that (it must answer the
same way whether or not an account exists). The built-in sender is also
rate-limited to a handful of messages per hour and has no delivery guarantee.

### 3. Optional: Reset Password email template

Authentication → Emails → Templates → Reset Password. Keep
`{{ .ConfirmationURL }}` as the link.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| The link in the email opens the home page (or any page other than `/reset-password`) and nothing happens. | The redirect URL is not on the allow list, so Supabase sent the user to the Site URL. | Step 1 above. The app now moves a recovery token that lands on the wrong page to `/reset-password` on its own, but the link still lands wherever the Site URL points, so fix the settings anyway. |
| "This reset link has expired or has already been used." | Links work once and expire after an hour. The first click already consumed it, even if that click only showed the home page. Some mail clients also open links to scan them. | Request a new link. |
| "Check your email" but nothing arrives, for anyone who is not on the Supabase team. | Built-in sender. | Step 2 above. |
| Auth logs show `POST /recover` followed by `GET /verify … redirect_to=<Site URL>` | Same as the first row; the `redirect_to` on the verify link is the fallback, not the URL the app asked for. | Step 1 above. |

The project's auth logs are under Logs → Auth in the dashboard; each reset
shows up as `user_recovery_requested`, `mail.send`, then the `/verify` request
when the link is clicked.
