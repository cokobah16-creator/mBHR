import { useEffect, useRef, useState } from "react";
import { isStaffRole } from "@/auth/roles";
import {
  reactivateStaffAccount,
  type AccountView,
  type OverviewResponse,
  type ReactivateResponse,
} from "@/services/staffAccounts";
import { ConfirmDialog } from "./ConfirmDialog";
import { inviteRoleOptions, roleName, STAFF_COPY, type StaffMessage } from "./staffAccountView";

interface ReactivateDialogProps {
  /** The disabled account. */
  account: AccountView;
  /** The server's overview: the roles on offer when a role must be chosen. */
  overview: Pick<OverviewResponse, "roles" | "adminRoleNeedsPermanent" | "caller">;
  /** Closes the dialog. Not called while a request is running. */
  onClose: () => void;
  /** The account is active again. The dialog calls onClose straight after. */
  onReactivated: (message: StaffMessage, data: ReactivateResponse) => void;
}

const COPY = STAFF_COPY.reactivate;

/**
 * Reactivate a disabled staff account. The server restores the role they
 * had before; when it has none to restore it replies `role_needed`, and a
 * role picker appears.
 *
 * Render it only while it is open.
 */
export default function ReactivateDialog({
  account,
  overview,
  onClose,
  onReactivated,
}: ReactivateDialogProps) {
  const [needsRole, setNeedsRole] = useState(false);
  const [role, setRole] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const roleRef = useRef<HTMLSelectElement>(null);

  // When the server asks for a role, take keyboard and screen reader users
  // straight to the picker; its hint says why Reactivate is waiting.
  useEffect(() => {
    if (needsRole) roleRef.current?.focus();
  }, [needsRole]);

  const options = inviteRoleOptions(overview);
  // A partly disabled account still has its staff role on the server.
  const knownRole = isStaffRole(account.role) ? account.role : null;

  const confirm = async () => {
    if (busy) return;
    if (needsRole && !role) {
      setProblem(COPY.chooseRole);
      return;
    }
    setProblem(null);
    setBusy(true);
    const result = await reactivateStaffAccount(account.userId, needsRole ? role : undefined);
    setBusy(false);
    if (result.ok === false) {
      if (result.code === "role_needed") {
        setNeedsRole(true);
        setProblem(null);
        return;
      }
      setProblem(result.message);
      return;
    }
    onReactivated(
      { tone: "success", title: COPY.doneTitle, body: COPY.done(account.fullName) },
      result.data,
    );
    onClose();
  };

  return (
    <ConfirmDialog
      open
      title={COPY.title(account.fullName)}
      confirmLabel={COPY.confirm}
      busy={busy}
      busyLabel={COPY.busy}
      confirmDisabled={needsRole && !role}
      onConfirm={() => void confirm()}
      onCancel={onClose}
    >
      <p>
        {needsRole && role
          ? COPY.body(roleName(role))
          : knownRole && !needsRole
            ? COPY.body(roleName(knownRole))
            : COPY.bodyNoRole}
      </p>
      {needsRole && (
        <div>
          <label htmlFor="reactivate-role" className="field-label">
            {COPY.role}
          </label>
          <select
            ref={roleRef}
            id="reactivate-role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            disabled={busy}
            className="input-field"
            aria-describedby="reactivate-role-hint"
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
          <p id="reactivate-role-hint" className="field-hint" role="status">
            {COPY.chooseRole}
          </p>
        </div>
      )}
      {problem && (
        <p className="field-error" role="alert">
          {problem}
        </p>
      )}
    </ConfirmDialog>
  );
}
