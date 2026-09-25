import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LockClosedIcon } from "@heroicons/react/24/outline";
import { ExclamationCircleIcon } from "@heroicons/react/20/solid";
import { useAuthStore } from "@/stores/auth";
import { IDLE_CHECK_MS, STAFF_IDLE_LOCK_MS, isIdleExpired } from "@/auth/idle";

const IDLE_MINUTES = Math.round(STAFF_IDLE_LOCK_MS / 60_000);

/**
 * Locks the staff workspace after STAFF_IDLE_LOCK_MS without activity, so a
 * tablet left on a desk does not stay open for the next person. The page
 * stays mounted under the lock (hidden and unreachable), so the same person
 * loses nothing they were typing: they unlock with their device PIN. Anyone
 * else signs out, which ends the session as a normal logout does.
 *
 * Activity is recorded by the shell (updateActivity in Layout). A reload
 * does not reset the clock: see onRehydrateStorage in src/stores/auth.ts.
 */
export function IdleLock({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const currentUser = useAuthStore((s) => s.currentUser);
  const lockedAt = useAuthStore((s) => s.lockedAt);
  const lockSession = useAuthStore((s) => s.lockSession);
  const locked = isAuthenticated && !!currentUser && lockedAt !== null;
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isAuthenticated || locked) return;
    const check = () => {
      if (isIdleExpired(useAuthStore.getState().lastActivityAt, Date.now())) {
        lockSession();
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    check();
    const timer = window.setInterval(check, IDLE_CHECK_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", check);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", check);
    };
  }, [isAuthenticated, locked, lockSession]);

  // Nothing under the lock can be reached by touch, keyboard or screen reader.
  useEffect(() => {
    contentRef.current?.toggleAttribute("inert", locked);
  }, [locked]);

  return (
    <>
      <div ref={contentRef} aria-hidden={locked || undefined}>
        {children}
      </div>
      {locked && currentUser && <LockScreen fullName={currentUser.fullName} />}
    </>
  );
}

function LockScreen({ fullName }: { fullName: string }) {
  const navigate = useNavigate();
  const unlockSession = useAuthStore((s) => s.unlockSession);
  const logout = useAuthStore((s) => s.logout);
  const [pin, setPin] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const signOut = async () => {
    await logout();
    navigate("/login");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      if (await unlockSession(pin)) return;
      const { isAuthenticated, lockoutUntil } = useAuthStore.getState();
      if (!isAuthenticated) {
        // Too many wrong PINs, or the account was switched off: signed out.
        navigate("/login");
        return;
      }
      setErr(
        lockoutUntil && lockoutUntil > Date.now()
          ? "Too many incorrect attempts. Sign out, or try again later."
          : `That is not ${fullName}'s PIN on this device.`,
      );
    } finally {
      setPin("");
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center overflow-y-auto bg-canvas px-4 py-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby="idle-lock-title"
    >
      <form onSubmit={handleSubmit} className="panel w-full max-w-sm p-6 space-y-4">
        <div className="flex items-start gap-3">
          <LockClosedIcon className="h-6 w-6 shrink-0 text-ink-muted mt-1" aria-hidden />
          <div className="min-w-0">
            <h1 id="idle-lock-title" className="text-h2 text-ink">
              Screen locked
            </h1>
            <p className="mt-1 text-body text-ink-secondary">
              Locked after {IDLE_MINUTES} minutes without use. {fullName}, enter
              your PIN to continue where you left off.
            </p>
          </div>
        </div>

        <div>
          <label htmlFor="idle-lock-pin" className="field-label">
            PIN
          </label>
          <input
            id="idle-lock-pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            pattern="\d{6}"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
            className="input-field h-12 text-base tabular-nums"
            placeholder="Your 6-digit PIN"
            aria-invalid={err ? true : undefined}
            aria-describedby={err ? "idle-lock-error" : undefined}
            required
          />
        </div>

        {err && (
          <p
            id="idle-lock-error"
            className="flex items-start gap-1.5 text-body text-danger-fg"
            role="alert"
          >
            <ExclamationCircleIcon className="h-5 w-5 shrink-0 mt-0.5" aria-hidden />
            {err}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || pin.length !== 6}
          className="btn-primary w-full h-12"
        >
          {busy ? "Checking…" : "Unlock"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void signOut()}
          className="btn-ghost w-full h-12"
        >
          Not {fullName}? Sign out
        </button>
      </form>
    </div>
  );
}
