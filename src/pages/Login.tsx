import React, { useState, useEffect, startTransition } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuthStore } from "@/stores/auth";
import { isOnlineSyncEnabled } from "@/sync/adapter";
import { needsFirstRunSetup } from "@/db/firstRun";
import { DeviceResetPanel } from "@/components/DeviceResetPanel";

export default function Login() {
  const [mode, setMode] = useState<"offline" | "online">("offline");
  const [pin, setPin] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [loading, setLoading] = useState(false);
  const [checkingSetup, setCheckingSetup] = useState(true);
  const [showRecovery, setShowRecovery] = useState(false);

  const onlineAvailable = isOnlineSyncEnabled();
  const navigate = useNavigate();
  const { login, loginOnline } = useAuthStore();

  // Production builds ship no demo staff, so a freshly installed device has no
  // PIN that could ever work here — first-run setup is the only way in.
  // main.tsx finishes seeding before React mounts, so this count is final
  // rather than racing the seed.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const needed = await needsFirstRunSetup();
        if (cancelled) return;
        if (needed) {
          navigate("/setup", { replace: true });
          return;
        }
      } catch (error) {
        // Fall through to the form: a PIN that works is better than a dead
        // end if the count could not be read.
        console.error("[login] could not check for first-run setup:", error);
      }
      if (!cancelled) setCheckingSetup(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    setErr(null);
    setLoading(true);

    try {
      if (mode === "offline") {
        console.log("[login] attempting offline PIN login");
        const success = await login(pin);
        console.log("[login] result:", success);

        if (success) {
          console.log("[login] success - navigating to dashboard");
          startTransition(() => {
            navigate("/dashboard");
          });
        } else {
          console.log("[login] failed - invalid PIN");
          setErr("Invalid PIN");
          setAttempts((a) => a + 1);
        }
      } else {
        // Online mode
        if (!onlineAvailable) {
          setErr("Online login not available — Supabase is not configured");
          return;
        }
        const success = await loginOnline(email, password);
        if (success) {
          startTransition(() => navigate("/dashboard"));
        } else {
          setErr("Invalid email or password");
          setAttempts((a) => a + 1);
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (ex: any) {
      console.error("[login] error:", ex);
      setAttempts((a) => a + 1);
      setErr(ex?.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  // Held until the user count is known so a device that needs first-run setup
  // never flashes a PIN form no PIN can satisfy.
  if (checkingSetup) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 via-white to-blue-50">
        <p className="text-gray-600">Checking this device…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-green-50 via-white to-blue-50">
      <div className="w-full max-w-md">
        <Link
          to="/"
          className="block text-center mb-4 text-sm text-gray-600 hover:text-gray-800 underline"
        >
          ← Back to home
        </Link>

        <div className="text-center mb-6">
          <img
            src="/brand/mbhr-mark.svg"
            alt=""
            aria-hidden
            className="inline-block w-16 h-16 rounded-2xl mb-4"
          />
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">
            MedBridge Health Reach
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            Bridging Care, Reaching All.
          </p>
        </div>

        <div className="bg-white rounded-lg shadow-md border border-gray-100 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">
            Staff Sign In
          </h2>
          <p className="text-sm text-gray-500 mb-5">
            Healthcare personnel only.
          </p>

          <div className="flex mb-4 gap-2">
            <button
              type="button"
              className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                mode === "offline"
                  ? "bg-primary text-white border-primary"
                  : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
              }`}
              onClick={() => {
                console.log("[login] switching to offline mode");
                setMode("offline");
              }}
            >
              Offline PIN
            </button>
            <button
              type="button"
              className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                mode === "online"
                  ? "bg-primary text-white border-primary"
                  : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
              } disabled:opacity-50 disabled:cursor-not-allowed`}
              onClick={() => {
                console.log("[login] switching to online mode");
                setMode("online");
              }}
              disabled={!onlineAvailable}
              title={onlineAvailable ? "" : "Online auth not configured"}
            >
              Online
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "offline" && (
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-900">PIN</label>
                <input
                  aria-label="PIN"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  value={pin}
                  onChange={(e) => {
                    const newPin = e.target.value
                      .replace(/\D/g, "")
                      .slice(0, 6);
                    setPin(newPin);
                  }}
                  className="h-12 px-4 text-base bg-white rounded-lg border border-gray-300 outline-none transition focus:ring-2 focus:ring-primary focus:border-transparent"
                  placeholder="Enter your 6-digit PIN"
                  required
                />
                {attempts > 0 && (
                  <span className="text-xs text-amber-600">
                    Failed attempts: {attempts}/5
                  </span>
                )}
                <span className="text-xs text-gray-500">
                  Forgot your PIN? Ask an administrator to set a new one under
                  Users.
                </span>
              </div>
            )}

            {mode === "online" && (
              <>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-gray-900">
                    Email
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-12 px-4 text-base bg-white rounded-lg border border-gray-300 outline-none transition focus:ring-2 focus:ring-primary focus:border-transparent"
                    placeholder="staff@example.com"
                    required
                    autoComplete="email"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-gray-900">
                    Password
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-12 px-4 text-base bg-white rounded-lg border border-gray-300 outline-none transition focus:ring-2 focus:ring-primary focus:border-transparent"
                    placeholder="Your password"
                    required
                    autoComplete="current-password"
                  />
                  <Link
                    to="/forgot-password"
                    className="self-end text-sm text-blue-600 hover:text-blue-800 underline"
                  >
                    Forgot password?
                  </Link>
                </div>
              </>
            )}

            {err && <div className="text-sm text-red-600">{err}</div>}

            <button
              type="submit"
              disabled={loading}
              className="w-full h-12 bg-primary text-white font-medium rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-primary"
            >
              {loading ? "Signing in…" : "Sign In"}
            </button>
          </form>

          {/* Recovery for a device nobody can sign in to (e.g. corrupted
              data). Erasing it needs an administrator's PIN — see
              DeviceResetPanel — so this link alone does nothing. */}
          <div className="mt-4 pt-4 border-t border-gray-100 text-sm">
            {showRecovery ? (
              <DeviceResetPanel onCancel={() => setShowRecovery(false)} />
            ) : (
              <button
                type="button"
                onClick={() => setShowRecovery(true)}
                className="text-gray-500 hover:text-gray-700 underline"
              >
                Device recovery
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
