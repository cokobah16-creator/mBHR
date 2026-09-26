import { useRef, useState, type FormEvent } from "react";
import { ExclamationTriangleIcon, InformationCircleIcon } from "@heroicons/react/24/outline";
import type { Role } from "@/auth/roles";
import { useDialogFocus } from "@/features/appointments/useDialogFocus";
import {
  createStaffAccount,
  newStaffId,
  type CreateResponse,
  type OverviewResponse,
} from "@/services/staffAccounts";
import {
  describeRoleAccess,
  validateStaffForm,
  type StaffFormErrors,
  type StaffFormValues,
} from "./staffForm";
import {
  createResultMessage,
  inviteRoleCaption,
  inviteRoleOptions,
  STAFF_COPY,
  type StaffMessage,
} from "./staffAccountView";

type Field = "fullName" | "email" | "role";

interface InviteStaffDialogProps {
  /** The server's overview: the roles on offer and how long a link lasts. */
  overview: Pick<
    OverviewResponse,
    "roles" | "adminRoleNeedsPermanent" | "caller" | "inviteLifetimeSeconds"
  >;
  /** Closes the dialog. Not called while a request is running. */
  onClose: () => void;
  /**
   * The account was created. `message` is the toast to show (the invitation
   * may not have gone out). The dialog calls onClose straight after.
   */
  onCreated: (message: StaffMessage, data: CreateResponse) => void;
  /**
   * The dialog is closing after a request whose outcome was never confirmed,
   * so the account may exist: refresh the list. Called just before onClose.
   */
  onMaybeCreated?: () => void;
}

const COPY = STAFF_COPY.invite;

function isField(value: unknown): value is Field {
  return value === "fullName" || value === "email" || value === "role";
}

/**
 * Add Staff (server mode): name, work email and role. The server creates the
 * login and staff record and emails an invitation; there is no PIN here, as
 * each person chooses their own PIN on a device at their first online
 * sign-in.
 *
 * Render it only while it is open. It keeps one new staff id for as long as
 * it is open, so pressing Send invitation again after a lost reply resumes
 * the same account instead of creating a second one.
 */
export default function InviteStaffDialog({
  overview,
  onClose,
  onCreated,
  onMaybeCreated,
}: InviteStaffDialogProps) {
  const [userId, setUserId] = useState(() => newStaffId());
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  const [errors, setErrors] = useState<StaffFormErrors>({});
  const [problem, setProblem] = useState<{ tone: "danger" | "warning"; text: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  // A create went unconfirmed and no later one succeeded.
  const unconfirmed = useRef(false);

  /** Closes without creating: refresh first if an account may exist. */
  const cancel = () => {
    if (busy) return;
    if (unconfirmed.current) onMaybeCreated?.();
    onClose();
  };

  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, cancel);

  const options = inviteRoleOptions(overview);
  const allowedRoles = options.filter((o) => !o.disabled).map((o) => o.value);
  const roleCaption = inviteRoleCaption(overview);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const values: StaffFormValues = {
      fullName,
      email,
      // The server's role names; checked against allowedRoles below.
      role: role as StaffFormValues["role"],
      phone: "",
      pin: "",
      confirmPin: "",
    };
    const found = validateStaffForm(values, "invite", allowedRoles);
    setErrors(found);
    setProblem(null);
    if (Object.keys(found).length > 0) return;

    const name = fullName.replace(/\s+/g, " ").trim();
    const address = email.trim();
    setBusy(true);
    const result = await createStaffAccount({ userId, fullName: name, email: address, role });
    setBusy(false);

    if (result.ok === false) {
      if (result.failure === "unreachable") {
        // The account may exist: the same id is sent again on the next press.
        unconfirmed.current = true;
        setProblem({ tone: "warning", text: COPY.unconfirmed });
        return;
      }
      if (result.failure === "server_error") {
        // A server error (a gateway timeout, or a login made without its
        // staff record) may leave the account behind: refresh the list on
        // close. The same id is kept, so pressing Send again resumes it.
        unconfirmed.current = true;
      }
      if (result.code === "id_conflict") setUserId(newStaffId());
      const field = result.body?.field;
      if (result.failure === "refused" && isField(field)) {
        const next: StaffFormErrors = {};
        next[field] = result.message;
        setErrors(next);
        return;
      }
      setProblem({ tone: "danger", text: result.message });
      return;
    }

    const data = result.data;
    unconfirmed.current = false;
    onCreated(
      createResultMessage(name, address, data.invitation, overview.inviteLifetimeSeconds),
      data,
    );
    onClose();
  };

  const fieldProps = (field: Field) => ({
    "aria-invalid": errors[field] ? true : undefined,
    "aria-describedby":
      [
        field === "email" ? "invite-staff-email-hint" : null,
        errors[field] ? `invite-staff-${field}-error` : null,
      ]
        .filter(Boolean)
        .join(" ") || undefined,
  });

  const fieldError = (field: Field) =>
    errors[field] ? (
      <p id={`invite-staff-${field}-error`} className="field-error">
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
        aria-labelledby="invite-staff-title"
        className="max-h-full w-full max-w-lg overflow-y-auto rounded-lg border border-line bg-surface shadow-2xl"
      >
        <form onSubmit={submit} noValidate>
          <div className="panel-header">
            <h2 id="invite-staff-title" className="panel-title">
              {COPY.title}
            </h2>
          </div>
          <div className="panel-body space-y-4">
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
              <label htmlFor="invite-staff-fullName" className="field-label">
                {COPY.fullName}
              </label>
              <input
                id="invite-staff-fullName"
                type="text"
                autoComplete="off"
                data-autofocus
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                disabled={busy}
                className="input-field"
                {...fieldProps("fullName")}
              />
              {fieldError("fullName")}
            </div>

            <div>
              <label htmlFor="invite-staff-email" className="field-label">
                {COPY.email}
              </label>
              <input
                id="invite-staff-email"
                type="email"
                autoComplete="off"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={busy}
                className="input-field"
                placeholder="name@example.com"
                {...fieldProps("email")}
              />
              <p id="invite-staff-email-hint" className="field-hint">
                {COPY.emailHint}
              </p>
              {fieldError("email")}
            </div>

            <div>
              <label htmlFor="invite-staff-role" className="field-label">
                {COPY.role}
              </label>
              <select
                id="invite-staff-role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                disabled={busy}
                className="input-field"
                aria-invalid={errors.role ? true : undefined}
                aria-describedby={
                  [
                    role ? "invite-staff-role-access" : null,
                    roleCaption ? "invite-staff-role-caption" : null,
                    errors.role ? "invite-staff-role-error" : null,
                  ]
                    .filter(Boolean)
                    .join(" ") || undefined
                }
              >
                <option value="" disabled>
                  Choose a role
                </option>
                {options.map((o) => (
                  <option key={o.value} value={o.value} disabled={o.disabled}>
                    {o.label}
                  </option>
                ))}
              </select>
              {role && (
                <p id="invite-staff-role-access" className="field-hint">
                  {COPY.roleAccess(describeRoleAccess(role as Role))}
                </p>
              )}
              {roleCaption && (
                <p id="invite-staff-role-caption" className="field-hint">
                  {roleCaption}
                </p>
              )}
              {fieldError("role")}
            </div>

            <div className="banner banner-info">
              <InformationCircleIcon className="h-5 w-5 shrink-0" aria-hidden />
              <div className="space-y-1">
                <p>{COPY.offlineInfo}</p>
                <p>{COPY.notYetInfo}</p>
              </div>
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
