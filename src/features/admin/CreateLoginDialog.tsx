import { useRef, useState, type FormEvent } from "react";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { useDialogFocus } from "@/features/appointments/useDialogFocus";
import { createLoginForStaffRecord, type CreateResponse } from "@/services/staffAccounts";
import { validateStaffForm } from "./staffForm";
import { createResultMessage, STAFF_COPY, type StaffMessage } from "./staffAccountView";

type Field = "confirmFullName" | "email";

interface CreateLoginDialogProps {
  /** The staff record that has no login. */
  userId: string;
  /** The name on their staff record, which the administrator types to confirm. */
  fullName: string;
  /** How long an invitation link lasts, from the server's overview. */
  inviteLifetimeSeconds: number;
  /** Closes the dialog. Not called while a request is running. */
  onClose: () => void;
  /**
   * The login was created. `message` is the toast to show (the invitation
   * may not have gone out). The dialog calls onClose straight after.
   */
  onCreated: (message: StaffMessage, data: CreateResponse) => void;
  /**
   * The dialog is closing after a request whose outcome was never confirmed,
   * so the login may exist: refresh the list. Called just before onClose.
   */
  onMaybeCreated?: () => void;
}

const COPY = STAFF_COPY.createLogin;

function cleanName(name: string): string {
  return name.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
}

function isField(value: unknown): value is Field {
  return value === "confirmFullName" || value === "email";
}

/**
 * Account Health repair: a login for a staff record that has none, and an
 * invitation to set a password. The administrator types the person's full
 * name to confirm who it is for, and the email they'll use.
 *
 * Render it only while it is open.
 */
export default function CreateLoginDialog({
  userId,
  fullName,
  inviteLifetimeSeconds,
  onClose,
  onCreated,
  onMaybeCreated,
}: CreateLoginDialogProps) {
  const [typedName, setTypedName] = useState("");
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [problem, setProblem] = useState<{ tone: "danger" | "warning"; text: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  // A request went unconfirmed and no later one succeeded.
  const unconfirmed = useRef(false);

  /** Closes without creating: refresh first if it may have been created. */
  const cancel = () => {
    if (busy) return;
    if (unconfirmed.current) onMaybeCreated?.();
    onClose();
  };

  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, cancel);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setProblem(null);

    const found: Partial<Record<Field, string>> = {};
    // The same email rules as Add Staff.
    const checked = validateStaffForm(
      { fullName: typedName, email, role: "volunteer", phone: "", pin: "", confirmPin: "" },
      "invite",
      ["volunteer"],
    );
    if (!typedName.trim()) found.confirmFullName = checked.fullName;
    else if (cleanName(typedName) !== cleanName(fullName)) found.confirmFullName = COPY.nameMismatch;
    if (checked.email) found.email = checked.email;
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const address = email.trim();
    setBusy(true);
    const result = await createLoginForStaffRecord({
      userId,
      email: address,
      confirmFullName: typedName.replace(/\s+/g, " ").trim(),
    });
    setBusy(false);
    if (result.ok === false) {
      if (result.failure === "unreachable" || result.failure === "server_error") {
        // The login may have been created before the reply was lost, and
        // this repair can't be resumed: check the list before trying again.
        unconfirmed.current = true;
        setProblem({ tone: "warning", text: COPY.unconfirmed });
        return;
      }
      const field = result.body?.field;
      if (result.failure === "refused" && isField(field)) {
        const next: Partial<Record<Field, string>> = {};
        next[field] = result.message;
        setErrors(next);
        return;
      }
      setProblem({ tone: "danger", text: result.message });
      return;
    }

    const data = result.data;
    unconfirmed.current = false;
    const message = createResultMessage(fullName, address, data.invitation, inviteLifetimeSeconds);
    onCreated(
      message.tone === "success" ? { ...message, title: COPY.doneTitle } : message,
      data,
    );
    onClose();
  };

  const describedBy = (field: Field, hint?: string) =>
    [hint, errors[field] ? `create-login-${field}-error` : null].filter(Boolean).join(" ") ||
    undefined;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby="create-login-title"
        aria-describedby="create-login-desc"
        className="max-h-full w-full max-w-lg overflow-y-auto rounded-lg border border-line bg-surface shadow-2xl"
      >
        <form onSubmit={submit} noValidate>
          <div className="panel-header">
            <h2 id="create-login-title" className="panel-title">
              {COPY.title}
            </h2>
          </div>
          <div className="panel-body space-y-4">
            <p id="create-login-desc" className="text-body text-ink-secondary">
              {COPY.body(fullName)}
            </p>

            {problem && (
              <div
                className={`banner ${problem.tone === "warning" ? "banner-warning" : "banner-danger"}`}
                role="alert"
              >
                <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
                <span>{problem.text}</span>
              </div>
            )}

            <div>
              <label htmlFor="create-login-confirmFullName" className="field-label">
                {COPY.fullName}
              </label>
              <input
                id="create-login-confirmFullName"
                type="text"
                autoComplete="off"
                data-autofocus
                value={typedName}
                onChange={(e) => setTypedName(e.target.value)}
                disabled={busy}
                className="input-field"
                aria-invalid={errors.confirmFullName ? true : undefined}
                aria-describedby={describedBy("confirmFullName")}
              />
              {errors.confirmFullName && (
                <p id="create-login-confirmFullName-error" className="field-error">
                  {errors.confirmFullName}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="create-login-email" className="field-label">
                {COPY.email}
              </label>
              <input
                id="create-login-email"
                type="email"
                autoComplete="off"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={busy}
                className="input-field"
                placeholder="name@example.com"
                aria-invalid={errors.email ? true : undefined}
                aria-describedby={describedBy("email", "create-login-email-hint")}
              />
              <p id="create-login-email-hint" className="field-hint">
                {COPY.emailHint}
              </p>
              {errors.email && (
                <p id="create-login-email-error" className="field-error">
                  {errors.email}
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-col-reverse gap-2 border-t border-line px-4 py-3 sm:flex-row sm:justify-end">
            <button type="button" onClick={cancel} disabled={busy} className="btn-secondary">
              {COPY.cancel}
            </button>
            <button type="submit" disabled={busy} className="btn-primary">
              {busy ? COPY.submitting : COPY.submit}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
