# Credential history review

Review date: 2026-09-24. Reviewer: Claude (automated review for the owner).
Status: **findings open. Action needed now for finding 1.**

This document records what the Git history of `cokobah16-creator/mBHR`
holds in the way of credentials, how each one is classified under the
owner's Decision 5, and the runbook for a history purge. **No purge has been
done.** No secret value is written here: each one is named by the file and
commit it appears in and, at most, its first two characters.

## Decision 5 (owner, verbatim)

> Do not rewrite Git history solely for the old admin PIN unless the actual
> plaintext credential or a still-valid credential secret was committed.
> Rotate the PIN/credential everywhere regardless. If the repository ever
> contained a reusable plaintext PIN, API key, password, service-role key, or
> similar secret, purge it from history and rotate it. If it only contained
> an obsolete hash/reference that cannot authenticate anything, rotation plus
> documenting the incident is usually sufficient.

Classes used below:

- **A. Reusable plaintext secret**: purge from history and rotate.
- **B. Obsolete or non-authenticating**: rotate (or retire) and document.
- **C. Public by design**: no purge; rotate only if there is another reason.
- **D. Not a secret**: placeholder, test fixture or local default.

## Summary

| # | What | Where (first seen) | Still in the current tree? | Class | Action |
| --- | --- | --- | --- | --- | --- |
| 1 | Resend API key, second key (starts `re`) | `NEXT_STEPS.md`, `QUICK_REFERENCE_CARD.md`, `RESEND_API_KEY_SETUP.md`, `scripts/set-resend-key.sh` (`00bbd11`, 2025-10-26); `EMAIL_NOW_WORKING.md` and hard-coded fallback in `supabase/functions/send-otp-email/index.ts` (`42c9153`, 2025-10-26) | **Yes.** 16 occurrences in 5 files on `mainone` and `mbhr-next` (list below) | **A** | Revoke in Resend now; remove from the tree; purge |
| 2 | Resend API key, first key (starts `re`) | Hard-coded fallback in `supabase/functions/send-otp-email/index.ts` (`b0fbf23`, 2025-10-26); replaced by key 1 in `42c9153` the same day | No (history only) | **A** | Revoke in Resend; purge |
| 3 | Old permanent admin PIN (6 digits, starts `07`) | `src/db/seed.ts` from `d430b47` (2025-09-30); also `src/utils/testPins.ts`, `src/components/UserManagement.tsx`, `ADMIN_PINS.md` (later `docs/archive/development-history/ADMIN_PINS.md`), committed `dist/` bundles, and two commit messages (`2b3cc11`, `da661d9`) | No. Removed from the tree in `b622c6b` (2026-09-23) | **A** (was reusable) | Rotate; purge in the same rewrite as 1 and 2 |
| 4 | The five demo staff PINs (sequential digits) | `src/db/seed.ts` since 2025-09-30 | Yes, in `src/db/seed.ts` (development builds only) | **B** | Keep retired; never use for a real account |
| 5 | Supabase anon key (legacy JWT, role `anon`, starts `ey`) | `.gitignore` (`92e4682`, 2025-09-30, removed in `dc7b320`), `EMAIL_NOW_WORKING.md`, committed `dist/` bundles | Yes, in `docs/archive/development-history/EMAIL_NOW_WORKING.md` | **C** | No purge needed; optional move to the new publishable key |
| 6 | Placeholders, test fixtures, local defaults | See "Not secrets" | Some | **D** | None |

Nothing else was found: no service-role key or service-role JWT, no
`sb_secret_` key, no Termii key value, no database password for a Supabase
project, no private key, no AWS, GitHub, Google, Stripe, Slack or SendGrid
token, and no `.env` file other than `.env.example` (empty or placeholder
values).

## How the review was done

- A mirror clone of the GitHub repository taken on 2026-09-24: every branch
  and every pull-request ref (110 branches, 126 `refs/pull/*` refs, no tags,
  802 commits). The working clone used for development holds only part of
  this history (334 commits), so the mirror is the one that counts.
- Every added line in `git log --all -p` was scanned for: JWTs (`eyJ...`,
  with the `role` claim decoded), `sb_secret_` / `sb_publishable_` keys,
  `service_role`, Resend (`re_...`), Termii (`TERMII_API_KEY`, `VITE_TERMII*`),
  private key blocks, AWS / GitHub / Google / Stripe / Slack / SendGrid token
  formats, Postgres connection strings with a password, and assignments to
  `password`, `secret`, `token`, `api_key` and similar names.
- `git log --all -S<value>` and `git log --all --grep=<value>` for each value
  found, to list every commit and commit message that adds or removes it.
- `git grep <value> <ref>` on every ref, to see which branch and PR tips
  still hold it.
- Files ever added whose names suggest secrets (`.env*`, `*.pem`, `*.key`,
  `credentials*`, `secrets.*`).

To repeat a check without printing a value, keep the value in a file outside
the repository and search with it, for example
`git log --all --format=%h -S"$(cat /secure/path/value.txt)"`.

Not covered by this review: GitHub pull-request descriptions, review
comments and issue text (not part of Git history), Vercel and Supabase
environment variables, and old Vercel deployments. Check them as part of the
rotation steps below.

## Findings

### 1. Resend API key, second key: still in the current tree (class A)

- **Where.** Added in `00bbd11` and `42c9153` (2025-10-26). It was the
  hard-coded fallback for `RESEND_API_KEY` in
  `supabase/functions/send-otp-email/index.ts` from `42c9153` until
  `b02cabe` (2026-01-17), so the deployed email function used it whenever the
  secret was not set. That makes it a live, working key at least until
  January 2026.
- **Still present now**, 16 occurrences at the tip of `mainone` (the default
  branch) and of `mbhr-next`:
  - `docs/archive/development-history/EMAIL_NOW_WORKING.md`
  - `docs/archive/development-history/NEXT_STEPS.md`
  - `docs/archive/development-history/RESEND_API_KEY_SETUP.md`
  - `docs/guides/QUICK_REFERENCE_CARD.md`
  - `scripts/set-resend-key.sh`
- A commit that redacts it from those files exists (`34057ad`, 2026-08-13)
  but only on the branch `claude/database-seed-script-8meqf5`, which was
  never merged. 230 of the 236 refs on GitHub still hold the key at their
  tip.
- **Can it authenticate?** The repository cannot say whether it was revoked.
  Treat it as live until the Resend dashboard shows it revoked.
- **Decision 5:** a reusable plaintext API key. **Revoke, remove from the
  tree, purge.**

Actions (owner):

- [ ] In the Resend dashboard, check the key's last use, then revoke it.
- [ ] Create a new key and set it only as a Supabase secret:
      `supabase secrets set RESEND_API_KEY=... --project-ref <ref>` (never a
      `VITE_` variable, never in a file). Redeploy `send-otp-email` and send a
      test email.
- [ ] Merge a change that replaces the key in the five files above with a
      placeholder (the redaction in `34057ad` can be reused). This needs doing
      even before a purge, so the current tree stops publishing it.
- [ ] Purge from history (runbook below).

### 2. Resend API key, first key: history only (class A)

- **Where.** Hard-coded fallback in
  `supabase/functions/send-otp-email/index.ts`, added in `b0fbf23` and
  replaced by key 1 in `42c9153`, both on 2025-10-26. Not in the current tree.
  Most refs hold it in their history.
- **Decision 5:** a reusable plaintext API key. **Revoke and purge.**

Actions (owner):

- [ ] Revoke it in the Resend dashboard if it still exists there.
- [ ] Purge with key 1 (same rewrite).

### 3. Old permanent admin PIN (class A: it could authenticate)

**Was the plaintext committed?** Yes. The six-digit PIN (starts `07`) of the
permanent admin account seeded under the owner's name was committed in
plaintext:

- `src/db/seed.ts` from `d430b47` (2025-09-30) until `b622c6b` (2026-09-23);
- `src/utils/testPins.ts` and `src/components/UserManagement.tsx` (a
  table of demo PINs shown in development builds);
- `ADMIN_PINS.md`, later moved to
  `docs/archive/development-history/ADMIN_PINS.md`;
- compiled into the committed `dist/` bundles (`467ddb3`, `eb479e0`,
  `c79c7fa`, `d38d57a`); those bundles were also what the web host served, so
  the PIN was public on the internet, not only in Git;
- two commit messages: `2b3cc11` (its subject line) and `da661d9` (its body).

It is not in the current tree. 214 of the 236 refs on GitHub still hold it
at their tip (older branches and PR refs).

**Could it authenticate?** Yes, for a period:

- Until `da661d9` (2026-09-10), production builds ran `src/db/seed.ts` on
  every device and created that account as an active, permanent admin with a
  PBKDF2 hash of this PIN. Anyone with the PIN and physical access to such a
  device could sign in offline as a permanent admin on that device.
- The hash was only ever on devices. PIN hashes were never uploaded: the
  sync upload map for staff has no PIN fields, and nothing in the history of
  `src/sync/` wrote `pin_hash`. (A legacy `public.users` table with
  `pin_hash` / `pin_salt` columns exists from
  `20251024080033_add_missing_advanced_tables.sql`; nothing in the app writes
  it. Confirm it is empty, see below.)

**Does the current code still accept it?** Not on an updated device:

- `da661d9`: demo seeding runs only in development builds.
- `53ccfc0` (2026-09-10): device migration `0003-retire-demo-users` runs at
  start-up in production builds and switches off every seeded demo account
  (matched on full name plus the `<role>@local` email the seeder always
  used, which covers every version of the seeder). Offline PIN sign-in
  accepts only accounts with `isActive === 1`. The stored hash stays on the
  device, but it no longer signs anyone in. The account is marked permanent,
  so the Users screen cannot switch it back on.
- PR #125 (`229cf24`, merged in `d2b20df`): PINs are device-only, never
  uploaded or downloaded; offline sign-in checks only the chosen person's
  device hash. There is no fixed, master or fallback PIN anywhere in `src/`
  (the only six-digit literals left are the five demo PINs in
  `src/db/seed.ts`, development only, and an email test code).

Remaining exposure:

- A device that has not opened an app version from 2026-09-10 or later still
  has the seeded account switched on.
- A staff-list download sets a local account's active flag from the server.
  If the server's `app_users` ever received a row with the same id as a
  device's seeded demo account, that download could switch it back on, with
  the old PIN hash still on the device. Check the server (below).
- If the same six digits are used anywhere else (another device, phone,
  bank card or service), they are exposed there too.

**Decision 5:** the actual plaintext of a PIN that could sign in was
committed, so this is a reusable plaintext credential: **rotate everywhere,
and purge**. A purge is needed anyway for findings 1 and 2, so adding the PIN
to the same rewrite costs nothing extra; do not run a separate rewrite for it.

Actions (owner):

- [ ] Open the current app on every device that ever ran an older build
      (so migration 0003 runs), or reset those devices.
- [ ] Give the owner's real account a new device PIN on every device, not
      the old one or any variation of it.
- [ ] Stop using the same six digits anywhere else.
- [ ] On the production database:
      `select id, role from public.app_users where email like '%@local';`
      must return no rows (delete or switch off any it returns), and
      `select count(*) from public.users;` should be 0 (the legacy table is
      unused; if it has rows, check whether they hold PIN hashes and delete
      them).
- [ ] Delete old Vercel deployments built before 2026-09-10 (their bundles
      contain the PIN), or make sure they are not publicly reachable.
- [ ] Include the PIN in the purge, in file contents and commit messages.

### 4. The five demo staff PINs (class B)

Five sequential demo PINs for the accounts "Admin User", "Dr. Sarah
Johnson", "Nurse Mary", "Pharmacist John" and "Volunteer Mike" have been in
`src/db/seed.ts` since 2025-09-30 and still are, for development builds.
Like finding 3, they worked on production devices until 2026-09-10; migration
0003 now switches those accounts off on every updated device. They are
trivial to guess and are meant to be public, so purging them would achieve
nothing.

- [ ] Keep migration 0003 in the app.
- [ ] No real staff account uses any of these PINs. The device PIN form does
      not refuse them today; tell staff not to choose them, or add a check
      that refuses easily guessed PINs (a separate code change).

### 5. Supabase anon key (class C)

A legacy anon JWT (decoded `role` claim: `anon`; long expiry) for the
production project was committed in `.gitignore` (`92e4682`, removed in
`dc7b320`), in `EMAIL_NOW_WORKING.md` (still in
`docs/archive/development-history/`), and in the committed `dist/` bundles.
The anon key is shipped in every browser bundle by design and grants only
what row-level security allows anonymous users. No purge is needed.

Its safety depends on row-level security, which was weak before the
`20260520*` lockdown migrations and is tightened further by the `20260924*`
files. Optional, when convenient: switch the app to Supabase's newer
publishable key and disable the legacy JWT-based keys. Rotating the legacy
JWT secret also invalidates the service-role key and every session, so plan
it as a maintenance task.

### 6. Not secrets (class D)

- `.env.example` in every version: variable names with empty values, or
  public settings (site name, organisation, app address).
- `fine-boy-foods-agent/.env.example` (`8c4553b`): `ANTHROPIC_API_KEY` set to
  a "your key" placeholder.
- `SMS_SETUP_TERMII.md` (`775f19a`): `TERMII_API_KEY` set to a "your key"
  placeholder.
- `scripts/set-resend-key.sh` on `claude/database-seed-script-8meqf5`: the
  redaction placeholder.
- `scripts/inferno/docker-compose.yml` (`399f108`): the default password of
  a local test database container.
- Test files (`notificationWorker.test.ts`, `televisits.test.ts`,
  `ResetPassword.test.tsx`, `passwordReset.test.ts`, `devicePin.test.ts`,
  `staffForm.test.ts`, `Login.test.tsx`, `firstRun.test.ts`): made-up
  passwords, keys and PINs.
- Compiled library code in old `dist/` bundles matched by the "token"
  pattern.
- The production project ref appears in `supabase/config.toml` and several
  docs. It is an identifier, not a credential.

The Termii key: no value was ever committed. The hardening checklist already
asks for any Termii key once set as a `VITE_` variable to be rotated,
because Vite compiles `VITE_` variables into the public bundle. That item
stands.

---

## Purge runbook (owner only; not performed)

A purge rewrites every commit from 2025-09-30 onwards. Every commit id
changes, every open PR breaks, and every clone must be thrown away. Do the
rotation first: a purge does not make a leaked key safe, it only stops the
repository publishing it further.

### Before

1. [ ] Rotate first: findings 1, 2 and 3 above.
2. [ ] Merge the tree redaction for finding 1, so the tip is clean.
3. [ ] Announce a freeze. Merge or close every open PR you want to keep;
       list the rest with `gh pr list --state open` and tell their authors
       they will need to recreate them.
4. [ ] List forks: `gh api repos/cokobah16-creator/mBHR/forks --jq '.[].full_name'`.
       A purge does not reach forks.
5. [ ] Install `git filter-repo` (`pip install git-filter-repo`).
6. [ ] Make a fresh mirror clone in a private working folder:

       git clone --mirror https://github.com/cokobah16-creator/mBHR.git mBHR-purge.git

7. [ ] Keep an untouched copy of that mirror in encrypted storage in case the
       rewrite must be redone. It contains the secrets; delete it when the
       purge is confirmed.

### Rewrite

8. [ ] Write a replacements file **outside** the repository (for example
       `/secure/replacements.txt`), one line per value. Never commit it:

       literal:<resend key 1>==>RESEND_KEY_REMOVED
       literal:<resend key 2>==>RESEND_KEY_REMOVED
       regex:\b<old admin PIN>\b==>PIN_REMOVED

       The word boundaries stop the PIN rule from changing longer numbers
       that happen to contain the same digits. Check first how many places
       each value appears in, for example
       `git -C mBHR-purge.git log --all --format=%h -S"<value>" | wc -l`.

9. [ ] Rewrite file contents and commit messages, and drop the old build
       output (it holds the PIN and nothing else of value):

       cd mBHR-purge.git
       git filter-repo --replace-text /secure/replacements.txt \
                       --replace-message /secure/replacements.txt \
                       --path dist/ --invert-paths

10. [ ] Check nothing is left (each must print nothing):

        git log --all --format=%h -S"<value>"
        git log --all --format=%h --grep="<value>"
        git grep "<value>" $(git for-each-ref --format='%(refname)' refs/heads)

        Also run a secret scanner (for example `gitleaks detect` or
        `trufflehog git file://$PWD`) on the rewritten mirror.

11. [ ] Keep `filter-repo/commit-map` and `filter-repo/first-changed-commits`
        from inside the mirror: GitHub Support asks for them.

### Publish

12. [ ] Allow force pushes on protected branches (`mainone` and any other)
        for the duration, in GitHub, Settings, Branches.
13. [ ] `git filter-repo` removes the `origin` remote. Add it back and
        force-push every branch and tag (pull-request refs are read-only on
        GitHub and cannot be pushed):

        git remote add origin https://github.com/cokobah16-creator/mBHR.git
        git push --force origin 'refs/heads/*:refs/heads/*'
        git push --force origin 'refs/tags/*:refs/tags/*'

        Delete old branches that are no longer needed instead of pushing them
        (`git push origin --delete <branch>`); every branch left on GitHub
        must be a rewritten one.
14. [ ] Restore branch protection.

### After

15. [ ] **GitHub Support.** The old commits stay reachable through the 126
        `refs/pull/*` refs, PR pages, cached views and direct commit URLs.
        Open a request with GitHub Support ("remove sensitive data") for this
        repository, attaching `first-changed-commits` and the list of affected
        PR numbers, and ask them to remove cached views and dereference the old
        PR refs so the old commits are garbage-collected. See GitHub's guide
        "Removing sensitive data from a repository".
16. [ ] **Forks.** Ask each fork owner to delete the fork (or delete and
        re-fork). GitHub Support cannot purge forks you do not own.
17. [ ] **Clones.** Every existing clone (developer machines, CI runners,
        cloud coding sessions, Vercel's Git cache) still holds the old
        history. Delete and re-clone. Never pull or merge from an old clone:
        that brings the old commits back. Rebuild unfinished work by
        cherry-picking onto the new branches, or with
        `git rebase --onto <new-base> <old-base> <branch>`.
18. [ ] **Open PRs.** They point at old commits; close them and open new
        ones from rewritten branches.
19. [ ] **CI and hosting.** Delete old GitHub Actions artifacts and caches
        made before the purge, and old Vercel deployments that served the
        bundles with the PIN (finding 3).
20. [ ] **Record the result here**: date, new tip commit of `mainone`, and
        the GitHub Support ticket number. Then delete the encrypted backup
        mirror and the replacements file.

## Sign-off

| Item | Done by | Date |
| --- | --- | --- |
| Resend key 2 revoked, new key set as a Supabase secret, email tested | | |
| Resend key 1 revoked (or confirmed already gone) | | |
| Resend key removed from the current tree (5 files) | | |
| Admin device PINs changed on every device; old digits not reused anywhere | | |
| Production `app_users` has no `@local` rows; legacy `users` table empty | | |
| Old Vercel deployments with the PIN deleted or private | | |
| History purge done (runbook steps 1 to 20), or owner decision not to purge recorded with the reason | | |
