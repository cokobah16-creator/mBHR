import { useRef, useState, type FormEvent } from "react";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import type { Role } from "@/auth/roles";
import { useDialogFocus } from "@/features/appointments/useDialogFocus";
import {
  createStaffRecordForLogin,
  type CreateStaffRecordResponse,
  type HealthItem,
} from "@/services/staffAccounts";
import { describeRoleAccess, staffNameError } from "./staffForm";
import { roleName, STAFF_COPY, type StaffMessage } from "./staffAccountView";

type Field = "confirmEmail" | "fullName" | "role" | "acknowledged";

interface CreateStaffRecordDialogProps {
  /** The Account Health problem: a login with no staff record. */
  item: Pick<HealthItem, "userId" | "email" | "emailMasked" | "fullName">;
  /** The roles the server offers (overview.roles). Administrator is never offered here. */
  roles: readonly string[];
  /** Closes the dialog. Not called while a request is running. */
  onClose: () => void;
  /** The staff record was created. The dialog calls onClose straight after. */
  onCreated: (message: StaffMessage, data: CreateStaffRecordResponse) => void;
  /**
   * The dialog is closing after a request whose outcome was never confirmed,
   * so the staff record may exist: refresh the list. Called just before
   * onClose.
   */
  onMaybeCreated?: () => void;
}

const COPY = STAFF_COPY.createStaffRecord;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isField(value: unknown): value is Field {
  return (
    value === "confirmEmail" || value === "fullName" || value === "role" || value === "acknowledged"
  );
}

/**
 * Account Health repair: a staff record for a login that has none, so they
 * can open the staff app. The administrator types the login's email in
 * full, chooses a role (never Administrator) and ticks that they know the
 * person. The server refuses any login that may belong to a patient.
 *
 * Render it only while it is open.
 */
export default function CreateStaffRecordDialog({
  item,
  roles,
  onClose,
  onCreated,
  onMaybeCreated,
}: CreateStaffRecordDialogProps) {
  const [confirmEmail, setConfirmEmail] = useState("");
  const [fullName, setFullName] = useState(item.fullName ?? "");
  const [role, setRole] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
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

  const roleOptions = roles.filter((r) => r !== "admin");
  const shownEmail = item.email || item.emailMasked;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setProblem(null);

    const typed = confirmEmail.trim().toLowerCase();
    const found: Partial<Record<Field, string>> = {};
    if (!typed || !EMAIL_PATTERN.test(typed)) {
      found.confirmEmail = "Enter their email address in full, like name@example.com.";
    } else if (item.email && typed !== item.email.trim().toLowerCase()) {
      found.confirmEmail = COPY.emailMismatch;
    }
    const nameError = staffNameError(fullName);
    if (nameError) found.fullName = nameError;
    if (!roleOptions.includes(role)) found.role = "Choose one of the listed roles.";
    if (!acknowledged) found.acknowledged = COPY.acknowledgeRequired;
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const name = fullName.replace(/\s+/g, " ").trim();
    setBusy(true);
    const result = await createStaffRecordForLogin({
      userId: item.userId,
      fullName: name,
      role,
      confirmEmail: typed,
      acknowledged: true,
    });
    setBusy(false);
    if (result.ok === false) {
      if (result.failure === "unreachable" || result.failure === "server_error") {
        // The staff record may have been created before the reply was lost,
        // and this repair can't be resumed: check the list before trying again.
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

    unconfirmed.current = false;
    onCreated({ tone: "success", title: COPY.doneTitle, body: COPY.done(name) }, result.data);
    onClose();
  };

  const describedBy = (field: Field, hint?: string) =>
    [hint, errors[field] ? `create-record-${field}-error` : null].filter(Boolean).join(" ") ||
    undefined;

  const fieldError = (field: Field) =>
    errors[field] ? (
      <p id={`create-record-${field}-error`} className="field-error">
        {errors[field]}
      </p>
    ) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby="create-record-title"
        aria-describedby="create-record-desc"
        className="max-h-full w-full max-w-lg overflow-y-auto rounded-lg border border-line bg-surface shadow-2xl"
      >
        <form onSubmit={submit} noValidate>
          <div className="panel-header">
            <h2 id="create-record-title" className="panel-title">
              {COPY.title}
            </h2>
          </div>
          <div className="panel-body space-y-4">
            <div id="create-record-desc" className="space-y-1 text-body text-ink-secondary">
              {shownEmail && <p className="font-medium text-ink">{shownEmail}</p>}
              <p>{COPY.body}</p>
            </div>

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
              <label htmlFor="create-record-confirmEmail" className="field-label">
                {COPY.confirmEmail}
              </label>
              <input
                id="create-record-confirmEmail"
                type="email"
                autoComplete="off"
                data-autofocus
                value={confirmEmail}
                onChange={(e) => setConfirmEmail(e.target.value)}
                disabled={busy}
                className="input-field"
                placeholder="name@example.com"
                aria-invalid={errors.confirmEmail ? true : undefined}
                aria-describedby={describedBy("confirmEmail")}
              />
              {fieldError("confirmEmail")}
            </div>

            <div>
              <label htmlFor="create-record-fullName" className="field-label">
                {COPY.fullName}
              </label>
              <input
                id="create-record-fullName"
                type="text"
                autoComplete="off"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                disabled={busy}
                className="input-field"
                aria-invalid={errors.fullName ? true : undefined}
                aria-describedby={describedBy("fullName")}
              />
              {fieldError("fullName")}
            </div>

            <div>
              <label htmlFor="create-record-role" className="field-label">
                {COPY.role}
              </label>
              <select
                id="create-record-role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                disabled={busy}
                className="input-field"
                aria-invalid={errors.role ? true : undefined}
                aria-describedby={describedBy("role", "create-record-role-hint")}
              >
                <option value="" disabled>
                  Choose a role
                </option>
                {roleOptions.map((r) => (
                  <option key={r} value={r}>
                    {roleName(r)}
                  </option>
                ))}
              </select>
              <div id="create-record-role-hint">
                {role && <p className="field-hint">{describeRoleAccess(role as Role)}</p>}
                <p className="field-hint">{COPY.noAdmin}</p>
              </div>
              {fieldError("role")}
            </div>

            <div>
              <label
                htmlFor="create-record-acknowledged"
                className="flex min-h-touch-target items-center gap-3 text-body text-ink"
              >
                <input
                  type="checkbox"
                  id="create-record-acknowledged"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                  disabled={busy}
                  className="h-5 w-5 rounded border-line-strong text-primary focus:ring-primary"
                  aria-invalid={errors.acknowledged ? true : undefined}
                  aria-describedby={describedBy("acknowledged")}
                />
                {COPY.acknowledge}
              </label>
              {fieldError("acknowledged")}
            </div>
          </div>
          <div className="flex flex-col-reverse gap-2 border-t border-line px-4 py-3 sm:flex-row sm:justify-end">
            <button type="button" onClick={cancel} disabled={busy} className="btn-secondary">
              {COPY.cancel}
            </button>
            <button type="submit" disabled={busy || !acknowledged} className="btn-primary">
              {busy ? COPY.submitting : COPY.submit}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
