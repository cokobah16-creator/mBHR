import React, { useState, useEffect, useMemo, startTransition } from "react";
import { useNavigate, Link } from "react-router-dom";
import { ArrowLeftIcon, MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import {
  ExclamationCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  SignalSlashIcon,
} from "@heroicons/react/20/solid";
import { useAuthStore, type SignInRefusal } from "@/stores/auth";
import { useToast } from "@/stores/toast";
import { useSyncStore } from "@/stores/syncStore";
import { isOnlineSyncEnabled } from "@/sync/adapter";
import { pullStaffRoster } from "@/sync/staffRoster";
import {
  deviceAccount,
  hasDevicePin,
  offlineSignInState,
  olderDeviceEntry,
  type OfflineSignInState,
} from "@/db/offlineAccess";
import { setDevicePin } from "@/db/devicePin";
import { getRoleDisplayName, type Role } from "@/auth/roles";
import { STAFF_IDLE_LOCK_MS, isIdleExpired } from "@/auth/idle";
import { useIdleTimeout } from "@/hooks/useIdleTimeout";
import { CANONICAL_ORIGIN, isOffCanonicalOrigin } from "@/config/canonicalOrigin";
import type { User } from "@/db";
import { LegalLinks } from "@/pages/legal/LegalLinks";

/** Mirrors MAX_FAILED_ATTEMPTS in stores/auth.ts; used for display only. */
const MAX_ATTEMPTS = 5;

/** How long a sign-in waits for the staff directory before going on. */
const ROSTER_WAIT_MS = 10_000;

/** Show the name search once the list is long enough to need it. */
const SEARCH_FROM = 6;

/** Shown when an online sign-in was ended because its PIN setup was left. */
const PIN_SETUP_TIMED_OUT =
  "PIN setup was not finished in time, so that sign-in was ended. Sign in online again to choose your PIN.";

interface LoginError {
  title: string;
  detail?: string;
}

function lockoutError(until: number): LoginError {
  const minutes = Math.max(1, Math.ceil((until - Date.now()) / 60_000));
  return {
    title: "Too many incorrect attempts",
    detail: `Sign-in is paused on this device for ${minutes} minute${
      minutes === 1 ? "" : "s"
    }. Try again after that, or ask an administrator for help.`,
  };
}

/** The store records a lockout when a failed attempt reaches the limit. */
function activeLockout(): number | null {
  const until = useAuthStore.getState().lockoutUntil;
  return until && until > Date.now() ? until : null;
}

/**
 * Why an online sign-in was refused although the password was right (or,
 * for a disabled account, whatever password was typed).
 */
function refusalError(reason: SignInRefusal): LoginError {
  switch (reason) {
    case "deactivated_on_device":
      return {
        title: "This account is switched off on this device",
        detail:
          "An administrator deactivated it here. Signing in online does not switch it back on: ask an administrator to review it under Users.",
      };
    case "not_staff":
      return {
        title: "This is not a staff account",
        detail:
          "The email and password are right, but this login has no staff account. Patients sign in through the patient portal. If you're staff, ask your administrator to check your account under Users.",
      };
    case "account_disabled":
      return {
        title: "This account has been disabled",
        detail:
          "An administrator has disabled your staff account. Ask them if you think this is wrong.",
      };
    case "staff_check_failed":
      return {
        title: "Your staff record could not be checked",
        detail:
          "Your password was accepted, but the server could not confirm your staff account. Check the connection and try again. If it keeps happening, ask an administrator to check the server.",
      };
    default:
      return {
        title: "This account has been deactivated",
        detail:
          "Your organisation has switched off this staff account, so it cannot sign in on this device. Ask an administrator if you think this is wrong.",
      };
  }
}

// Spelled out rather than Intl: "en-GB" gives "Sept" in newer ICU data.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "23 Sep 2026", or null when the person has never signed in online here. */
function lastVerifiedLabel(value: Date | string | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

const firstName = (fullName: string) => fullName.trim().split(/\s+/)[0] || fullName;

const onlyDigits = (value: string) => value.replace(/\D/g, "").slice(0, 6);

const roleLabel = (role: string) => getRoleDisplayName(role as Role);

/**
 * Bring the staff directory down after an online sign-in, without holding
 * the person up for long: the directory also arrives with the next sync.
 */
async function refreshRoster(): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      pullStaffRoster(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ROSTER_WAIT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export default function Login() {
  const [mode, setMode] = useState<"offline" | "online">("offline");
  const [pin, setPin] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<LoginError | null>(null);
  // How the last sign-in ended, when it matters (PIN setup left unfinished),
  // shown above the sign-in options.
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // null while this device's staff list is being read.
  const [offline, setOffline] = useState<OfflineSignInState | null>(null);
  // Offline sign-in: the person picked from "Who's signing in?".
  const [selected, setSelected] = useState<User | null>(null);
  const [search, setSearch] = useState("");
  // Set once an online sign-in put a person on this device without a PIN:
  // they choose one before entering the app.
  const [pinSetupFor, setPinSetupFor] = useState<User | null>(null);
  // "Forgot PIN?": after the online sign-in, choose a new PIN even though
  // one exists on this device.
  const [resettingPin, setResettingPin] = useState(false);

  const onlineAvailable = isOnlineSyncEnabled();
  const deviceOnline = useSyncStore((s) => s.isOnline);
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const loginOnline = useAuthStore((s) => s.loginOnline);
  const logout = useAuthStore((s) => s.logout);
  const setCurrentUser = useAuthStore((s) => s.setCurrentUser);
  const updateActivity = useAuthStore((s) => s.updateActivity);
  const failedAttempts = useAuthStore((s) => s.failedAttempts);
  const pushToast = useToast((s) => s.push);
  const offCanonical = isOffCanonicalOrigin();

  // main.tsx finishes seeding before React mounts, so the staff list read
  // here is final rather than racing the seed.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Someone signed in online and went to another page before choosing
      // a device PIN: enrollment picks up where it stopped, but only soon
      // after. Left longer, the sign-in ends, so whoever uses the tablet
      // next cannot choose that person's PIN. (After a reload there is
      // nothing to pick up: src/stores/auth.ts never restores it.)
      const { isAuthenticated, currentUser, lastActivityAt } = useAuthStore.getState();
      if (isAuthenticated && currentUser) {
        const record = await deviceAccount(currentUser.id).catch(() => undefined);
        if (cancelled) return;
        if (!hasDevicePin(record ?? currentUser)) {
          if (isIdleExpired(lastActivityAt, Date.now())) {
            await logout();
            if (cancelled) return;
            setNotice(PIN_SETUP_TIMED_OUT);
          } else {
            setPinSetupFor(record ?? currentUser);
          }
        }
      }

      let state: OfflineSignInState;
      try {
        state = await offlineSignInState();
      } catch (error) {
        console.error(
          "[login] could not read this device's staff list:",
          error instanceof Error ? error.name : error,
        );
        state = { kind: "not-set-up" };
      }
      if (cancelled) return;
      if (state.kind !== "ready" && onlineAvailable) setMode("online");
      setOffline(state);
    })();
    return () => {
      cancelled = true;
    };
  }, [onlineAvailable, logout]);

  const switchMode = (next: "offline" | "online") => {
    setMode(next);
    setErr(null);
    setNotice(null);
    if (next === "offline") setResettingPin(false);
  };

  /** Forgot PIN: a PIN can only be replaced, after an online sign-in. */
  const startPinReset = () => {
    setResettingPin(true);
    setSelected(null);
    setPin("");
    setMode("online");
    setErr(null);
  };

  const chooseAccount = (user: User | null) => {
    setSelected(user);
    setPin("");
    setErr(null);
  };

  const finishSignIn = () => {
    startTransition(() => {
      navigate("/dashboard");
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    setErr(null);
    setNotice(null);

    if (mode === "online") {
      if (!onlineAvailable) {
        setErr({
          title: "Online sign-in is not set up on this device",
          detail: "Use your offline PIN instead.",
        });
        return;
      }
      if (!deviceOnline) {
        setErr({
          title: "This device is offline",
          detail:
            "Online sign-in needs an internet connection. Use your offline PIN, or try again when you are connected.",
        });
        return;
      }
    } else if (!selected) {
      setErr({ title: "Choose your account first" });
      return;
    }

    setLoading(true);

    try {
      if (mode === "offline" && selected) {
        const success = await login(selected.id, pin);

        if (success) {
          const verified = lastVerifiedLabel(selected.lastOnlineVerifiedAt);
          pushToast({
            id: `offline-welcome-${Date.now()}`,
            tone: "info",
            title: `Welcome, ${firstName(selected.fullName)}`,
            body: `Offline mode. ${
              verified ? `Last verified online: ${verified}. ` : ""
            }Changes stay on this device until you sign in online and sync.`,
          });
          finishSignIn();
        } else {
          const until = activeLockout();
          setErr(
            until
              ? lockoutError(until)
              : {
                  title: "Invalid PIN",
                  detail: `That is not ${selected.fullName}'s PIN on this device. Check the 6 digits and try again.`,
                },
          );
          setPin("");
        }
      } else {
        const success = await loginOnline(email, password);
        if (success) {
          // Bring down the organisation's staff directory so everyone is
          // known to this device, then make sure this person can sign in
          // here offline next time.
          await refreshRoster();
          const signedIn = useAuthStore.getState().currentUser;
          const record = signedIn
            ? ((await deviceAccount(signedIn.id).catch(() => undefined)) ?? signedIn)
            : null;
          if (record && (resettingPin || !hasDevicePin(record))) {
            setPinSetupFor(record);
          } else {
            finishSignIn();
          }
        } else {
          const until = activeLockout();
          const refusal = useAuthStore.getState().signInRefusal;
          setErr(
            until
              ? lockoutError(until)
              : refusal
                ? refusalError(refusal)
                : {
                  title: "Invalid email or password",
                  detail:
                    "Check both and try again. If you have forgotten your password, reset it below.",
                },
          );
        }
      }
    } catch (ex) {
      console.error("[login] error:", ex instanceof Error ? ex.name : ex);
      setErr({
        title: "Sign-in could not be completed",
        detail: "Try again. If it keeps happening, reload the page.",
      });
    } finally {
      setLoading(false);
    }
  };

  const accounts = useMemo(
    () => (offline?.kind === "ready" ? offline.accounts : []),
    [offline],
  );
  const visibleAccounts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter(
      (u) =>
        u.fullName.toLowerCase().includes(q) ||
        roleLabel(u.role).toLowerCase().includes(q),
    );
  }, [accounts, search]);

  // Held until the staff list is known so the page never flashes a PIN
  // form on a device where no PIN can work.
  if (offline === null) {
    return (
      <div
        className="min-h-screen flex items-center justify-center bg-canvas p-4"
        role="status"
      >
        <p className="text-body text-ink-muted">Checking this device…</p>
      </div>
    );
  }

  if (pinSetupFor) {
    const endPinSetup = async () => {
      await logout();
      setPinSetupFor(null);
      setResettingPin(false);
      setPassword("");
    };
    return (
      <LoginShell subtitle="Staff sign-in" offCanonical={offCanonical}>
        <DevicePinSetup
          user={pinSetupFor}
          replacing={resettingPin && hasDevicePin(pinSetupFor)}
          onDone={(updated) => {
            setCurrentUser(updated);
            // Choosing the PIN was activity: the workspace opens unlocked.
            updateActivity();
            finishSignIn();
          }}
          onCancel={endPinSetup}
          onIdle={async () => {
            await endPinSetup();
            setNotice(PIN_SETUP_TIMED_OUT);
          }}
        />
      </LoginShell>
    );
  }

  const notSetUp = offline.kind === "not-set-up";
  const offlineReady = offline.kind === "ready";
  // Without online sign-in in this build, the only way onto an empty device
  // is first-run setup, so the form would be a dead end. With online
  // sign-in, a device is set up by an authorised staff member signing in.
  const showForm = !notSetUp || onlineAvailable;
  const offerSetup = notSetUp && !onlineAvailable;

  const modeButton = (active: boolean) =>
    `min-h-touch-target rounded-md px-3 text-label transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:text-ink-disabled ${
      active
        ? "bg-surface text-ink border border-line-strong shadow-sm"
        : "text-ink-secondary hover:bg-surface-hover hover:text-ink"
    }`;

  return (
    <LoginShell subtitle="Staff sign-in" offCanonical={offCanonical}>
      <div className="panel">
        <div className="panel-header flex-col items-start gap-0.5">
          <h2 className="panel-title">Staff Sign In</h2>
          <p className="text-caption text-ink-muted">
            Healthcare personnel only.
          </p>
        </div>

        <div className="panel-body space-y-4">
          {notice && (
            <div className="banner banner-info" role="status">
              <InformationCircleIcon
                className="h-5 w-5 shrink-0 mt-0.5"
                aria-hidden
              />
              <p>{notice}</p>
            </div>
          )}

          {notSetUp && (
            <div className="banner banner-info" role="status">
              <InformationCircleIcon
                className="h-5 w-5 shrink-0 mt-0.5"
                aria-hidden
              />
              <div>
                <p className="font-medium">
                  This device hasn't been set up for mBHR yet.
                </p>
                <p className="text-caption mt-0.5">
                  {onlineAvailable
                    ? "Connect to the internet and sign in with the staff account your administrator created for you to set up offline access."
                    : "Online sign-in is not set up in this build, so set up this device with its first administrator. They can then add everyone else under Users."}
                </p>
              </div>
            </div>
          )}

          {showForm && (
            <>
              <div>
                <div
                  role="group"
                  aria-label="Sign-in method"
                  className="grid grid-cols-2 gap-1 rounded-md border border-line bg-surface-sunken p-1"
                >
                  <button
                    type="button"
                    aria-pressed={mode === "offline"}
                    className={modeButton(mode === "offline")}
                    onClick={() => switchMode("offline")}
                    disabled={!offlineReady}
                    aria-describedby={
                      offlineReady ? undefined : "login-pin-unavailable"
                    }
                  >
                    Offline PIN
                  </button>
                  <button
                    type="button"
                    aria-pressed={mode === "online"}
                    className={modeButton(mode === "online")}
                    onClick={() => switchMode("online")}
                    disabled={!onlineAvailable}
                    aria-describedby={
                      onlineAvailable ? undefined : "login-online-unavailable"
                    }
                  >
                    Online
                  </button>
                </div>
                {!onlineAvailable && (
                  <p id="login-online-unavailable" className="field-hint">
                    Online sign-in is not set up on this device.
                  </p>
                )}
                {!offlineReady && (
                  <p id="login-pin-unavailable" className="field-hint">
                    {offline.kind === "no-pins"
                      ? "Offline sign-in hasn't been set up on this device yet. Sign in online once to create your offline PIN."
                      : "Offline sign-in becomes available here after you sign in online once and choose a PIN."}
                  </p>
                )}
                {offlineReady || onlineAvailable ? (
                  <p className="field-hint">
                    {mode === "online"
                      ? "Use online sign-in when internet access is available. This also enables synchronization."
                      : "Use this when internet access is unavailable. Changes remain on this device until you sign in online and sync."}
                  </p>
                ) : null}
              </div>

              {mode === "online" && resettingPin && (
                <div className="banner banner-info" role="status">
                  <InformationCircleIcon
                    className="h-5 w-5 shrink-0 mt-0.5"
                    aria-hidden
                  />
                  <p>
                    A forgotten PIN cannot be recovered, only replaced. Sign in
                    online and you'll choose a new PIN for this device.
                  </p>
                </div>
              )}

              {mode === "online" && !deviceOnline && (
                <div className="banner banner-warning" role="status">
                  <SignalSlashIcon
                    className="h-5 w-5 shrink-0 mt-0.5"
                    aria-hidden
                  />
                  <p>
                    This device is offline. Online sign-in needs an internet
                    connection.{" "}
                    {offlineReady
                      ? "Use your offline PIN, or try again when you are connected."
                      : "Try again when you are connected."}
                  </p>
                </div>
              )}

              {mode === "offline" && offlineReady && !selected && (
                <AccountPicker
                  accounts={visibleAccounts}
                  total={accounts.length}
                  search={search}
                  onSearch={setSearch}
                  onChoose={chooseAccount}
                  onForgotPin={onlineAvailable ? startPinReset : undefined}
                />
              )}

              {(mode === "online" || selected) && (
                <form onSubmit={handleSubmit} className="space-y-4">
                  {mode === "offline" && selected && (
                    <>
                      <div className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface-sunken px-3 py-2">
                        <div className="min-w-0">
                          <p className="text-caption text-ink-muted">
                            Signing in as
                          </p>
                          <p className="truncate font-medium text-ink">
                            {selected.fullName}
                            <span className="text-ink-muted font-normal">
                              {" "}
                              · {roleLabel(selected.role)}
                            </span>
                          </p>
                          {lastVerifiedLabel(selected.lastOnlineVerifiedAt) && (
                            <p className="text-caption text-ink-muted">
                              Last verified online:{" "}
                              {lastVerifiedLabel(selected.lastOnlineVerifiedAt)}
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => chooseAccount(null)}
                          className="min-h-touch-target shrink-0 rounded-md px-2 text-label text-primary hover:text-primary-hover underline"
                        >
                          Not you?
                        </button>
                      </div>
                      <div>
                        <label htmlFor="login-pin" className="field-label">
                          PIN
                        </label>
                        <input
                          id="login-pin"
                          aria-label="PIN"
                          aria-describedby="login-pin-hint"
                          type="password"
                          inputMode="numeric"
                          autoComplete="off"
                          autoFocus
                          pattern="\d{6}"
                          maxLength={6}
                          value={pin}
                          onChange={(e) => setPin(onlyDigits(e.target.value))}
                          className="input-field h-12 text-base tabular-nums"
                          placeholder="Enter your 6-digit PIN"
                          required
                        />
                        <p id="login-pin-hint" className="field-hint">
                          A forgotten PIN can't be recovered, only replaced.{" "}
                          {onlineAvailable ? (
                            <>
                              Choose{" "}
                              <button
                                type="button"
                                onClick={startPinReset}
                                className="underline text-primary hover:text-primary-hover"
                              >
                                Forgot PIN?
                              </button>{" "}
                              and sign in online on this device to choose a new
                              one, or ask an administrator to reset it under
                              Users.
                            </>
                          ) : (
                            "Ask an administrator to reset it under Users."
                          )}
                        </p>
                      </div>
                    </>
                  )}

                  {mode === "online" && (
                    <>
                      <div>
                        <label htmlFor="login-email" className="field-label">
                          Email
                        </label>
                        <input
                          id="login-email"
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          className="input-field h-12 text-base"
                          placeholder="staff@example.com"
                          required
                          autoComplete="email"
                        />
                      </div>
                      <div>
                        <label htmlFor="login-password" className="field-label">
                          Password
                        </label>
                        <input
                          id="login-password"
                          type="password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="input-field h-12 text-base"
                          placeholder="Your password"
                          required
                          autoComplete="current-password"
                        />
                        <div className="mt-1 flex justify-end">
                          <Link
                            to="/forgot-password"
                            className="inline-flex min-h-touch-target items-center rounded-md px-1 text-label text-primary hover:text-primary-hover underline"
                          >
                            Forgot password?
                          </Link>
                        </div>
                      </div>
                    </>
                  )}

                  <div className="space-y-2">
                    {err && (
                      <div className="banner banner-danger" role="alert">
                        <ExclamationCircleIcon
                          className="h-5 w-5 shrink-0 mt-0.5"
                          aria-hidden
                        />
                        <div>
                          <p className="font-medium">{err.title}</p>
                          {err.detail && (
                            <p className="text-caption mt-0.5">{err.detail}</p>
                          )}
                        </div>
                      </div>
                    )}

                    {failedAttempts > 0 && (
                      <p className="flex items-center gap-1.5 text-caption text-warning-fg">
                        <ExclamationTriangleIcon
                          className="h-4 w-4 shrink-0"
                          aria-hidden
                        />
                        Failed attempts: {failedAttempts}/{MAX_ATTEMPTS}
                      </p>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="btn-primary w-full h-12"
                  >
                    {loading ? "Signing in…" : "Sign In"}
                  </button>

                  {mode === "online" && (
                    <p className="text-caption text-ink-muted">
                      New staff member? Your administrator creates your account
                      and emails you a link to set your password. You can't
                      create a staff account yourself.
                    </p>
                  )}
                </form>
              )}
            </>
          )}

          {offerSetup && (
            <div className="space-y-2">
              <Link
                to="/setup"
                className="btn-primary w-full h-12 inline-flex items-center justify-center"
              >
                Set up this device
              </Link>
              <p className="text-caption text-ink-muted">
                Creates the first administrator, who then adds the rest of the
                staff under Users.
              </p>
            </div>
          )}
        </div>
      </div>
    </LoginShell>
  );
}

/** "Who's signing in?": the people with offline access on this device. */
function AccountPicker({
  accounts,
  total,
  search,
  onSearch,
  onChoose,
  onForgotPin,
}: {
  accounts: User[];
  total: number;
  search: string;
  onSearch: (value: string) => void;
  onChoose: (user: User) => void;
  onForgotPin?: () => void;
}) {
  return (
    <div className="space-y-3">
      <h3 id="login-who" className="text-label font-medium text-ink">
        Who's signing in?
      </h3>
      {total >= SEARCH_FROM && (
        <div className="relative">
          <MagnifyingGlassIcon
            className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-muted"
            aria-hidden
          />
          <input
            type="search"
            aria-label="Search staff"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            className="input-field h-12 pl-10 text-base"
            placeholder="Search by name or role"
          />
        </div>
      )}
      <ul aria-labelledby="login-who" className="max-h-80 space-y-2 overflow-y-auto">
        {accounts.map((user) => (
          <li key={user.id}>
            <button
              type="button"
              onClick={() => onChoose(user)}
              className="flex min-h-touch-target w-full items-center justify-between gap-3 rounded-md border border-line bg-surface px-3 py-2 text-left hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <span className="truncate font-medium text-ink">
                {user.fullName}
              </span>
              <span className="shrink-0 text-caption text-ink-muted">
                {roleLabel(user.role)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {accounts.length === 0 && (
        <p className="text-caption text-ink-muted">
          Nobody matches that search. Staff appear here once they have chosen a
          PIN on this device.
        </p>
      )}
      <p className="text-caption text-ink-muted">
        Not listed? Offline access isn't set up for your account on this
        device. Sign in online to create your PIN.
        {onForgotPin && (
          <>
            {" "}
            <button
              type="button"
              onClick={onForgotPin}
              className="underline text-primary hover:text-primary-hover"
            >
              Forgot your PIN?
            </button>
          </>
        )}
      </p>
    </div>
  );
}

function LoginShell({
  subtitle,
  offCanonical,
  children,
}: {
  subtitle: string;
  offCanonical: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-canvas px-4 py-8 sm:p-6">
      <div className="w-full max-w-md">
        <Link
          to="/"
          className="mx-auto mb-4 flex min-h-touch-target w-fit items-center gap-1.5 rounded-md px-2 text-label text-ink-muted hover:text-ink hover:underline"
        >
          <ArrowLeftIcon className="h-4 w-4" aria-hidden />
          Back to home
        </Link>

        <div className="text-center mb-6">
          <img
            src="/brand/mbhr-mark.svg"
            alt=""
            aria-hidden
            className="inline-block w-14 h-14 rounded-lg mb-4"
          />
          <h1 className="text-h1 text-ink">MedBridge Health Reach</h1>
          <p className="text-body text-ink-muted mt-1">{subtitle}</p>
        </div>

        {offCanonical && (
          <div className="banner banner-warning mb-4" role="status">
            <ExclamationTriangleIcon
              className="h-5 w-5 shrink-0 mt-0.5"
              aria-hidden
            />
            <div>
              <p className="font-medium">This is not the main mBHR address.</p>
              <p className="text-caption mt-0.5">
                Staff, PINs and records saved on this address stay here only.
                For real work use{" "}
                <a
                  href={`${CANONICAL_ORIGIN}/login`}
                  className="underline font-medium"
                >
                  {CANONICAL_ORIGIN.replace(/^https?:\/\//, "")}
                </a>
                .
              </p>
            </div>
          </div>
        )}

        {children}

        <LegalLinks className="mt-6" />
      </div>
    </div>
  );
}

/**
 * Required after a person's first online sign-in on this device: they choose
 * a PIN before entering the app, so the device works for them offline from
 * then on. Cancelling signs them out again.
 */
function DevicePinSetup({
  user,
  replacing = false,
  onDone,
  onCancel,
  onIdle,
}: {
  user: User;
  /** Forgot PIN: the new PIN replaces the one already on this device. */
  replacing?: boolean;
  onDone: (updated: User) => void;
  onCancel: () => void | Promise<void>;
  /** Left untouched for STAFF_IDLE_LOCK_MS: the sign-in is ended. */
  onIdle: () => void | Promise<void>;
}) {
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // This person's older offline entry on this device, under another name
  // perhaps: the new PIN replaces its PIN, so the screen says so.
  const [older, setOlder] = useState<User | null>(null);

  useEffect(() => {
    let cancelled = false;
    olderDeviceEntry(user)
      .then((found) => {
        if (!cancelled) setOlder(found ?? null);
      })
      .catch(() => {
        // Only the wording depends on it.
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Nothing is saved until the PIN is chosen and confirmed. A form left
  // untouched signs the person out, so the next person on the tablet
  // cannot choose a PIN for them.
  useIdleTimeout(STAFF_IDLE_LOCK_MS, () => void onIdle(), !saving);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setSaving(true);
    try {
      const updated = await setDevicePin({ userId: user.id, pin, confirmPin });
      onDone(updated);
    } catch (ex) {
      console.error(
        "[login] could not save the device PIN:",
        ex instanceof Error ? ex.name : ex,
      );
      setErr(
        ex instanceof Error && ex.message
          ? ex.message
          : "The PIN was not saved. Try again.",
      );
      setSaving(false);
    }
  };

  const signedInAs = user.email ? `${user.fullName} (${user.email})` : user.fullName;

  return (
    <div className="panel">
      <div className="panel-header flex-col items-start gap-0.5">
        <h2 className="panel-title">
          {replacing ? "Choose a new PIN for this device" : "Choose a PIN for this device"}
        </h2>
        <p className="text-caption text-ink-muted">
          {replacing
            ? `You are signed in as ${signedInAs}. Your old PIN stops working on this device once you save a new one.`
            : `You are signed in as ${signedInAs}. This is your account, not a new one: the PIN lets you sign in to it on this device without internet.`}
        </p>
        {!replacing && older && (
          <p className="text-caption text-ink-muted">
            {older.fullName === user.fullName
              ? "It replaces your older offline PIN on this device."
              : `It replaces the older offline PIN this device had for you as ${older.fullName}.`}
          </p>
        )}
      </div>

      <form onSubmit={handleSubmit} className="panel-body space-y-4">
        <div>
          <label className="field-label" htmlFor="device-pin">
            Choose a 6-digit PIN
          </label>
          <input
            id="device-pin"
            aria-label="New PIN"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            pattern="\d{6}"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(onlyDigits(e.target.value))}
            className="input-field h-12 text-base tabular-nums"
            placeholder="Enter a 6-digit PIN"
            required
          />
        </div>

        <div>
          <label className="field-label" htmlFor="device-confirm-pin">
            Confirm PIN
          </label>
          <input
            id="device-confirm-pin"
            aria-label="Confirm PIN"
            aria-describedby="device-pin-note"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            pattern="\d{6}"
            maxLength={6}
            value={confirmPin}
            onChange={(e) => setConfirmPin(onlyDigits(e.target.value))}
            className="input-field h-12 text-base tabular-nums"
            placeholder="Re-enter the PIN"
            required
          />
          <p id="device-pin-note" className="field-hint">
            This PIN is stored only on this device and is never sent to the
            server. If you forget it, choose Forgot PIN? on the sign-in screen
            and sign in online here to choose a new one.
          </p>
        </div>

        {err && (
          <div className="banner banner-danger" role="alert">
            <ExclamationCircleIcon
              className="h-5 w-5 shrink-0 mt-0.5"
              aria-hidden
            />
            <p>{err}</p>
          </div>
        )}

        <button
          type="submit"
          disabled={saving}
          className="btn-primary w-full h-12"
        >
          {saving ? "Saving PIN…" : "Save PIN and continue"}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => void onCancel()}
          className="btn-ghost w-full h-12"
        >
          Cancel and sign out
        </button>
      </form>
    </div>
  );
}
