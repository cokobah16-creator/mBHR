# Password recovery

Covers accounts that sign in with **email + password through Supabase**: online
staff sign-in (`/login` → Online) and the patient portal (`/patient/login`).

| Step | Route | What happens |
| --- | --- | --- |
| 1. Request | `/forgot-password` (staff), `/patient/forgot-password` (patients), or Patient portal → Account → Security | `supabase.auth.resetPasswordForEmail` sends a one-time link to `/reset-password?for=staff\|patient`. The confirmation is identical whether or not the address has an account. |
| 2. Land | `/reset-password` | supabase-js exchanges the link's token for a recovery session. Expired/used links show "Request a new link". Visiting without a recovery link is refused, so a signed-in session alone cannot change the password here. |
| 3. Set | `/reset-password` | New password (min 8 chars, confirmed) saved with `updateUser`, then `signOut({ scope: "global" })` ends every session for the account. User is sent back to the correct login page. |

Code: `src/services/passwordReset.ts`, `src/pages/ForgotPassword.tsx`, `src/pages/ResetPassword.tsx`.

## Not covered (by design)

- **Offline staff PINs** live only on the device. An administrator resets them under **Users** (edit the user, set a new PIN). The login screen says so.
- **Offline patient PINs** are reset by clinic staff.

## Supabase setup (hosted project)

1. **Authentication → URL Configuration → Redirect URLs**: add
   `https://<your-domain>/reset-password` (and preview domains, e.g. `https://*.vercel.app/reset-password`).
   Local dev is already listed in `supabase/config.toml`.
2. **Authentication → Emails → SMTP**: configure a real SMTP sender (e.g. Resend). The built-in
   sender is heavily rate-limited and only for testing.
3. Optional: edit the **Reset Password** email template wording.
