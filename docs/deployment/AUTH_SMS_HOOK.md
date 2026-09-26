# Patient sign-in codes by text message (auth-send-sms)

Patients can sign in to the portal with a one-time code
(`/patient/sign-in-code`). Supabase Auth makes and checks the code. For
email it sends the code itself; for text messages it calls the
`auth-send-sms` edge function (a Supabase Auth "Send SMS" hook), which
sends the text through Termii using the same provider code and secrets as
`send-otp-sms`.

Nothing here is on until every step below is done. Until then the sign-in
screen is hidden (`VITE_PORTAL_CODE_CHANNELS` is empty) and phone sign-in is
off in Supabase Auth.

Do these steps only when the project owner says phone sign-in can go live,
after the portal database updates it depends on are applied to production.

## How the function is protected

Supabase Auth calls the hook without a user JWT, so the function is deployed
with JWT verification off. It is the only function deployed that way (the
deploy workflow adds `--no-verify-jwt` for `auth-send-sms` alone). Instead:

- Every call must carry a Standard Webhooks signature made with this
  project's hook secret, and be less than five minutes old. Anything else
  gets 401 before the body is used.
- While `SEND_SMS_HOOK_SECRET` is unset, every call is refused.
- It only texts Nigerian mobile numbers, only a fixed sign-in message around
  the code, and at most 5 texts an hour per number (on top of Supabase
  Auth's own SMS limits).
- Logs show a masked number, never the full number or the code.
- If the provider fails, the function says so, and the sign-in screen tells
  the patient the code was not sent. It never reports a failed text as sent.

## Steps (in this order)

1. **Provider secrets.** The function uses `TERMII_API_KEY`,
   `TERMII_SENDER_ID` and `RATE_LIMIT_KEY_SALT`, the same secrets as
   `send-otp-sms` (see [SMS_SETUP_TERMII.md](./SMS_SETUP_TERMII.md)).
   Supabase function secrets are shared by all functions in the project, so
   if `send-otp-sms` already has them there is nothing to add.
2. **Deploy the function.** GitHub > Actions > Deploy edge functions > Run
   workflow, from `mainone`: action `deploy`, function `auth-send-sms`,
   confirm `deploy to production`.
3. **Turn on the hook.** Supabase dashboard > Authentication > Hooks > Send
   SMS hook > HTTPS, URL
   `https://<project-ref>.supabase.co/functions/v1/auth-send-sms`. Generate
   the secret there and copy it (it starts with `v1,whsec_`).
4. **Give the function the hook secret.** Supabase dashboard > Edge
   Functions > Secrets: add `SEND_SMS_HOOK_SECRET` with the value from step
   3. Never put it in the repository, a `VITE_` variable or a message.
5. **Turn on phone sign-in.** Authentication > Sign In / Providers > Phone:
   enable. Leave "Allow new users to sign up" off: a code only goes to a
   phone that already belongs to an account (the app also asks with
   `shouldCreateUser: false`).
6. **Test with your own phone** on an account that has it, before telling
   patients.
7. **Show the screen.** In Vercel, set `VITE_PORTAL_CODE_CHANNELS` to
   `sms,email` (or `sms` alone) for Production, then redeploy. The login
   page then shows "Sign in with a code instead".

## Turning it off

Set `VITE_PORTAL_CODE_CHANNELS` back to empty (hides the screen), and turn
off the Send SMS hook or phone sign-in in Supabase Auth.

## Text wording

The message is English only for now ("Your mBHR sign-in code is 123456. Do
not share it with anyone. If you did not ask for it, ignore this
message."). Other languages are added in
`supabase/functions/_shared/sms/authSmsHook.ts` once their wording has been
checked.
