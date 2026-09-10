import React, { useState, useEffect, startTransition } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuthStore } from "@/stores/auth";
import { isOnlineSyncEnabled } from "@/sync/adapter";
import { db } from "@/db";
import { needsFirstRunSetup } from "@/db/firstRun";
import { derivePinHash } from "@/utils/pin";

export default function Login() {
  const [mode, setMode] = useState<"offline" | "online">("offline");
  const [pin, setPin] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [loading, setLoading] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [checkingSetup, setCheckingSetup] = useState(true);

  const onlineAvailable = isOnlineSyncEnabled();
  const navigate = useNavigate();
  const { login, loginOnline } = useAuthStore();

  // Debug panel state
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [debugUsers, setDebugUsers] = useState<any[]>([]);
  const [computed, setComputed] = useState<string>("");

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

  // Reset local data function
  const resetLocal = async () => {
    const confirmed = window.confirm(
      "This deletes every patient, visit and staff account stored on this device. " +
        "Anything not yet synced is lost, and you will have to set the device up again. Continue?",
    );
    if (!confirmed) return;

    try {
      setLoading(true);
      await db.delete();
      localStorage.clear();
      sessionStorage.clear();

      // Clear Zustand persisted state
      const keys = Object.keys(localStorage);
      keys.forEach((key) => {
        if (key.includes("mbhr") || key.includes("auth")) {
          localStorage.removeItem(key);
        }
      });

      alert(
        "Local data cleared. The app will now reload and ask you to set up this device again.",
      );
      window.location.reload();
    } catch (e) {
      console.error("Failed to reset local data:", e);
      alert("Failed to reset local data. Check console for details.");
    } finally {
      setLoading(false);
    }
  };

  // Load debug users
  useEffect(() => {
    if (showDebug) {
      (async () => {
        try {
          const users = await db.users.where("isActive").equals(1).toArray();
          setDebugUsers(
            users.map((u) => ({
              name: u.fullName,
              role: u.role,
              salt: u.pinSalt?.slice(0, 10) + "…",
              hash: u.pinHash?.slice(0, 12) + "…",
            })),
          );
        } catch (error) {
          console.error("Error loading debug users:", error);
          setDebugUsers([]);
        }
      })();
    }
  }, [showDebug, attempts]);

  // Compute hash for debugging
  useEffect(() => {
    if (pin && debugUsers.length > 0) {
      (async () => {
        try {
          const first = await db.users.where("isActive").equals(1).first();
          if (first?.pinSalt) {
            const h = await derivePinHash(pin, first.pinSalt);
            setComputed(h.slice(0, 12) + "…");
          } else {
            setComputed("");
          }
        } catch (error) {
          console.error("Error computing hash:", error);
          setComputed("Error");
        }
      })();
    } else {
      setComputed("");
    }
  }, [pin, debugUsers]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log("[login] form submitted, mode:", mode, "pin:", pin);

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
                    console.log("[login] PIN changed:", newPin);
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

            {/* Utility buttons */}
            <div className="flex items-center justify-between text-sm mt-2 pt-4 border-t border-gray-100">
              <button
                type="button"
                onClick={resetLocal}
                className="text-red-600 hover:text-red-800 underline"
                disabled={loading}
              >
                Reset local data
              </button>
              <button
                type="button"
                onClick={() => setShowDebug((s) => !s)}
                className="text-blue-600 hover:text-blue-800 underline"
              >
                {showDebug ? "Hide" : "Show"} debug
              </button>
            </div>
          </form>
        </div>

        {/* Debug panel */}
        {showDebug && (
          <div className="mt-4 rounded-lg border p-3 bg-gray-50 text-sm">
            <div className="font-semibold mb-2">Debug Panel (Offline Mode)</div>
            <div className="mb-2">Active users: {debugUsers.length}</div>

            {debugUsers.length > 0 ? (
              <div className="space-y-2">
                {debugUsers.map((user, index) => (
                  <div
                    key={index}
                    className="bg-white p-2 rounded border text-xs"
                  >
                    <div>
                      <strong>{user.name}</strong> ({user.role})
                    </div>
                    <div>
                      Salt: <code>{user.salt}</code>
                    </div>
                    <div>
                      Hash: <code>{user.hash}</code>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-gray-600 italic">
                No users found. This device needs first-run setup.
              </div>
            )}

            {pin && computed && (
              <div className="mt-3 p-2 bg-blue-50 rounded">
                <div className="text-xs">
                  <strong>
                    Computed hash for PIN "{pin}" (using first user's salt):
                  </strong>
                </div>
                <code className="text-xs">{computed}</code>
              </div>
            )}

            {/* Demo staff are seeded in development only, so these PINs do not
                exist in a production build — showing them there would be a
                lie. Keep this list in step with src/db/seed.ts. */}
            {import.meta.env.DEV && (
              <div className="mt-3 text-xs text-gray-600 border-t pt-2">
                <strong>Demo PINs (development only):</strong>
                <br />
                • 123456 (Admin User)
                <br />
                • 234567 (Dr. Sarah Johnson)
                <br />
                • 345678 (Nurse Mary)
                <br />
                • 456789 (Pharmacist John)
                <br />• 567890 (Volunteer Mike)
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
