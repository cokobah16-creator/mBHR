# Staff invitation email

When an administrator adds a staff member on the **Users** screen, the
`staff-admin` edge function asks Supabase to send that person an invitation
email. Supabase builds the email from its **Invite user** template. This page
gives the template to install and explains why it looks the way it does.

Nothing else in mBHR uses the Invite user template (patients are invited by a
different email, sent by `send-otp-email`), so changing it affects staff only.

## Before you start

- **Outgoing email must be set up** (Authentication > Emails > SMTP settings).
  Until it is, Supabase only delivers to members of your Supabase
  organisation, and everyone else's invitation fails. See section 2 of
  [PASSWORD_RECOVERY.md](../PASSWORD_RECOVERY.md).
- **The Site URL must be exactly `https://mbhr.app`**, with no slash at the
  end (Authentication > URL Configuration). The link below starts with the
  Site URL, so a trailing slash would give a broken `//reset-password` link.

## Install the template

1. Open the Supabase dashboard and choose the mBHR production project.
2. Go to **Authentication > Emails > Templates** and choose **Invite user**.
3. Replace the **Subject** with the subject below.
4. Replace the **Message body** with the HTML body below. Copy it exactly,
   including the curly brackets.
5. If the page also shows a separate plain text box, paste the plain text
   body there. If it does not, skip this step.
6. Press **Save**.
7. Leave every other template alone. In particular, do not change **Reset
   password**: patients use it too.

### Subject

```text
You've been added to mBHR
```

### HTML body

```html
<h2>You've been added to mBHR</h2>

<p>{{ if .Data.full_name }}Hello {{ .Data.full_name }},{{ else }}Hello,{{ end }}</p>

<p>An administrator has created an mBHR staff account for you. To start,
set your password:</p>

<p><a href="{{ .SiteURL }}/reset-password?for=staff&link=invite&token_hash={{ .TokenHash }}&type=invite">Set your password</a></p>

<p>The page that opens has a <strong>Continue</strong> button. Press it, then
choose your password. After that, sign in at mbhr.app with this email address
and your new password. The first time you sign in on a device, you'll also
choose a PIN for offline use.</p>

<p>This link works once and only for a limited time. If it has expired, ask
your administrator to send a new invitation.</p>

<p>If you weren't expecting this email, you can ignore it. No one can use
the account until a password is set.</p>
```

### Plain text body

```text
You've been added to mBHR

{{ if .Data.full_name }}Hello {{ .Data.full_name }},{{ else }}Hello,{{ end }}

An administrator has created an mBHR staff account for you. To start, set your password by opening this link:

{{ .SiteURL }}/reset-password?for=staff&link=invite&token_hash={{ .TokenHash }}&type=invite

The page that opens has a Continue button. Press it, then choose your password. After that, sign in at mbhr.app with this email address and your new password. The first time you sign in on a device, you'll also choose a PIN for offline use.

This link works once and only for a limited time. If it has expired, ask your administrator to send a new invitation.

If you weren't expecting this email, you can ignore it. No one can use the account until a password is set.
```

## What the pieces mean

| Piece | Meaning |
| --- | --- |
| `{{ .Data.full_name }}` | The name the administrator typed on the Users screen. If it is missing, the greeting is just "Hello,". |
| `{{ .SiteURL }}` | The Site URL from Authentication > URL Configuration (`https://mbhr.app`). |
| `{{ .TokenHash }}` | The one-time code that proves the link came from this email. |
| `for=staff` | Tells the page to send the person to the staff sign-in afterwards. |
| `link=invite` | Tells the page this is an invitation, so it shows invitation wording even when the link has expired. |
| `type=invite` | Tells the page which kind of code to redeem. |

## Why the link has a Continue button

Some email systems (for example Microsoft's Safe Links) open every link in an
email to scan it before the person sees it. With Supabase's default link, that
scan uses up the one-time code, and the person then gets "link expired" the
first time they click.

The link above only opens the page. Nothing is used up until the person
presses **Continue**, which a scanner does not do.

## If you keep the default template

The default Invite user template (with `{{ .ConfirmationURL }}`) also works:
the function asks for the person to be sent to
`https://mbhr.app/reset-password?for=staff&link=invite`, and the page handles
that too. For that to work, the Redirect URLs list (Authentication > URL
Configuration) must include `https://mbhr.app/reset-password**`.

The risk is the scanner problem above. If someone reports that their link had
expired straight away, use **Resend invitation** on the Users screen, and
install the template on this page.

## Other things to know

- **How long the link works** is set by **Email OTP Expiration**
  (Authentication > Sign In / Providers > Email; the default is 1 hour). Put
  the same number of seconds in the `STAFF_INVITE_LIFETIME_SECONDS` secret so
  the Users screen marks invitations as expired at the right time. See
  [STAFF_ADMIN_FUNCTION.md](STAFF_ADMIN_FUNCTION.md).
- **Resend invitation** sends this email again while the person has not
  opened their link. Once they have opened it (or a scanner has), Supabase
  will not send another invitation, so the function sends a password reset
  email instead, which uses the **Reset password** template.
- **Test it** with your own spare email address before inviting real staff:
  add yourself as a test staff member, check the email arrives, looks right,
  and that the link opens the "Set your password" page with a Continue button.
