import { useRef, useState, type FormEvent } from "react";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import type { Role } from "@/auth/roles";
import { useDialogFocus } from "@/features/appointments/useDialogFocus";
import {
  updateStaffAccount,
  type AccountView,
  type OverviewResponse,
} from "@/services/staffAccounts";
import { describeRoleAccess, gainedAccess, lostAccess, staffNameError } from "./staffForm";
import {
  adminRoleIsOneWay,
  inviteRoleOptions,
  roleName,
  STAFF_COPY,
  type StaffMessage,
} from "./staffAccountView";

type Field = "fullName" | "role";

interface EditStaffAccountDialogProps {
  /** The account being edited, as the server last sent it. */
  account: AccountView;
  /** The server's overview: the roles on offer and who is signed in. */
  overview: Pick<OverviewResponse, "roles" | "adminRoleNeedsPermanent" | "caller">;
  /** Closes the dialog. Not called while a request is running. */
  onClose: () => void;
  /** The server saved the change. The dialog calls onClose straight after. */
  onSaved: (message: StaffMessage, account: AccountView) => void;
}

const COPY = STAFF_COPY.edit;

function cleanName(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

function isField(value: unknown): value is Field {
  return value === "fullName" || value === "role";
}

/**
 * Edit an online staff account's name and role (server mode). Nobody can
 * change their own role, and a permanent administrator keeps the
 * administrator role; the server also refuses both and its message is
 * shown. A PIN is set on each device, from the device's own form.
 *
 * Render it only while it is open.
 */
export default function EditStaffAccountDialog({
  account,
  overview,
  onClose,
  onSaved,
}: EditStaffAccountDialogProps) {
  const [fullName, setFullName] = useState(account.fullName);
  const [role, setRole] = useState(account.role);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, () => {
    if (!busy) onClose();
  });

  const self =
    !!overview.caller?.userId &&
    overview.caller.userId.toLowerCase() === account.userId.toLowerCase();
  const roleLockedReason = self
    ? COPY.ownRole
    : account.adminPermanent
      ? COPY.permanentRole
      : null;

  const options = inviteRoleOptions(overview);
  // Keep the current role in the list even when it can't be given here.
  if (account.role && !options.some((o) => o.value === account.role)) {
    options.unshift({ value: account.role, label: roleName(account.role), disabled: false });
  }

  const roleChanged = role !== account.role;
  const gained = roleChanged ? gainedAccess(account.role as Role, role as Role) : [];
  const lost = roleChanged ? lostAccess(account.role as Role, role as Role) : [];
  // Moving an administrator to another role can't be undone here while the
  // administrator role can't be given from this screen.
  const oneWay = roleChanged && !roleLockedReason && adminRoleIsOneWay(account.role, overview.roles);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setProblem(null);
    const name = cleanName(fullName);
    const nameError = staffNameError(fullName);
    if (nameError) {
      setErrors({ fullName: nameError });
      return;
    }
    setErrors({});

    const changes: { fullName?: string; role?: string } = {};
    if (name !== cleanName(account.fullName)) changes.fullName = name;
    if (roleChanged && !roleLockedReason) changes.role = role;
    if (changes.fullName === undefined && changes.role === undefined) {
      setProblem(COPY.nothingChanged);
      return;
    }

    setBusy(true);
    const result = await updateStaffAccount(account.userId, changes);
    setBusy(false);
    if (result.ok === false) {
      const field = result.body?.field;
      if (result.failure === "refused" && isField(field)) {
        const next: Partial<Record<Field, string>> = {};
        next[field] = result.message;
        setErrors(next);
        return;
      }
      setProblem(result.message);
      return;
    }

    const saved = result.data.account;
    onSaved(
      {
        tone: "success",
        title: COPY.savedTitle,
        body: COPY.saved(saved?.fullName || name),
      },
      saved,
    );
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby="edit-staff-title"
        className="max-h-full w-full max-w-lg overflow-y-auto rounded-lg border border-line bg-surface shadow-2xl"
      >
        <form onSubmit={submit} noValidate>
          <div className="panel-header">
            <h2 id="edit-staff-title" className="panel-title">
              {COPY.title(account.fullName)}
            </h2>
          </div>
          <div className="panel-body space-y-4">
            {problem && (
              <div className="banner banner-danger" role="alert">
                <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
                <span>{problem}</span>
              </div>
            )}

            <div>
              <label htmlFor="edit-staff-fullName" className="field-label">
                {COPY.fullName}
              </label>
              <input
                id="edit-staff-fullName"
                type="text"
                autoComplete="off"
                data-autofocus
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                disabled={busy}
                className="input-field"
                aria-invalid={errors.fullName ? true : undefined}
                aria-describedby={errors.fullName ? "edit-staff-fullName-error" : undefined}
              />
              {errors.fullName && (
                <p id="edit-staff-fullName-error" className="field-error">
                  {errors.fullName}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="edit-staff-role" className="field-label">
                {COPY.role}
              </label>
              <select
                id="edit-staff-role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                disabled={busy || !!roleLockedReason}
                className="input-field"
                aria-invalid={errors.role ? true : undefined}
                aria-describedby="edit-staff-role-hint"
              >
                {options.map((o) => (
                  <option key={o.value} value={o.value} disabled={o.disabled && o.value !== role}>
                    {o.label}
                  </option>
                ))}
              </select>
              <div id="edit-staff-role-hint" className="space-y-1">
                {roleLockedReason ? (
                  <p className="field-hint">{roleLockedReason}</p>
                ) : (
                  role && <p className="field-hint">{describeRoleAccess(role as Role)}</p>
                )}
                {gained.length > 0 && (
                  <p className="field-hint">They will be able to {gained.join(", ")}.</p>
                )}
                {lost.length > 0 && (
                  <p className="field-hint">They will no longer be able to {lost.join(", ")}.</p>
                )}
                {oneWay && <p className="font-medium text-warning-fg">{COPY.adminOneWay}</p>}
              </div>
              {errors.role && <p className="field-error">{errors.role}</p>}
            </div>

            <p className="field-hint">{COPY.pinNote}</p>
          </div>
          <div className="flex flex-col-reverse gap-2 border-t border-line px-4 py-3 sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} disabled={busy} className="btn-secondary">
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
