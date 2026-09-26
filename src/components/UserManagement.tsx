import { useCallback, useEffect, useState, type FormEvent } from "react";
import { db, User, generateId } from "@/db";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/stores/toast";
import { devicePinFields, clearDevicePin } from "@/db/devicePin";
import { hasDevicePin } from "@/db/offlineAccess";
import { countOtherActiveAdmins, LAST_ADMIN_MESSAGE } from "@/db/firstRun";
import { can, getRoleDisplayName } from "@/auth/roles";
import { pullStaffRoster } from "@/sync/staffRoster";
import { formatNigerianDate } from "@/utils/dateFormat";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { ConfirmDialog } from "@/features/admin/ConfirmDialog";
import {
  ASSIGNABLE_ROLES,
  validateStaffForm,
  describeRoleAccess,
  gainedAccess,
  lostAccess,
  type StaffFormErrors,
  type StaffFormValues,
} from "@/features/admin/staffForm";
import {
  disableStaffAccount,
  resendInvitation,
  sendPasswordReset,
  type AccountView,
} from "@/services/staffAccounts";
import { useStaffAccounts, type StaffScreenState } from "@/features/admin/useStaffAccounts";
import {
  adminRoleIsOneWay,
  disableResultMessage,
  mergeStaffRows,
  removedFromServer,
  resendResultMessage,
  resetPasswordResultMessage,
  roleName,
  rowActions,
  STAFF_COPY,
  type RowAction,
  type RowActionKind,
  type StaffMessage,
  type StaffRow,
} from "@/features/admin/staffAccountView";
import StaffStatusBadge from "@/features/admin/StaffStatusBadge";
import InviteStaffDialog from "@/features/admin/InviteStaffDialog";
import EditStaffAccountDialog from "@/features/admin/EditStaffAccountDialog";
import StaffLoginStatusDialog from "@/features/admin/StaffLoginStatusDialog";
import ReactivateDialog from "@/features/admin/ReactivateDialog";
import AccountHealthPanel from "@/features/admin/AccountHealthPanel";
import CreateLoginDialog from "@/features/admin/CreateLoginDialog";
import {
  UserPlusIcon,
  PencilIcon,
  TrashIcon,
  UsersIcon,
  NoSymbolIcon,
  CheckCircleIcon,
  KeyIcon,
  EnvelopeIcon,
  ArrowPathIcon,
  InformationCircleIcon,
  ArchiveBoxIcon,
} from "@heroicons/react/24/outline";

type FormState = StaffFormValues & {
  adminAccess: boolean;
  adminPermanent: boolean;
};

const EMPTY_FORM: FormState = {
  fullName: "",
  role: "volunteer",
  email: "",
  phone: "",
  pin: "",
  confirmPin: "",
  adminAccess: false,
  adminPermanent: false,
};

/** Server actions that ask for confirmation on this screen. */
type PendingServerAction = {
  action: "disable" | "resend_invitation" | "reset_password";
  row: StaffRow;
  account: AccountView;
};

/** The server-mode dialog that is open, if any. */
type ServerDialog =
  | { kind: "invite" }
  | { kind: "edit_account"; account: AccountView }
  | { kind: "login_status"; row: StaffRow }
  | { kind: "reactivate"; row: StaffRow; account: AccountView }
  | { kind: "create_login"; account: AccountView };

const ACTION_ICONS: Record<RowActionKind, typeof PencilIcon> = {
  edit_account: PencilIcon,
  resend_invitation: ArrowPathIcon,
  reset_password: EnvelopeIcon,
  login_status: InformationCircleIcon,
  disable: NoSymbolIcon,
  reactivate: CheckCircleIcon,
  create_login: UserPlusIcon,
  edit_on_device: KeyIcon,
  reset_device_pin: KeyIcon,
  deactivate_on_device: NoSymbolIcon,
  activate_on_device: CheckCircleIcon,
  delete: TrashIcon,
  retire_device_record: ArchiveBoxIcon,
};

/** Only the PIN problems of a form check. */
function pinErrors(found: StaffFormErrors): StaffFormErrors {
  const out: StaffFormErrors = {};
  if (found.pin) out.pin = found.pin;
  if (found.confirmPin) out.confirmPin = found.confirmPin;
  return out;
}

function errorName(error: unknown) {
  return error instanceof Error ? error.name : error;
}

/** The line above the staff list for a server-mode screen state, or null. */
function screenStateText(state: StaffScreenState, failureMessage: string | null): string | null {
  switch (state) {
    case "device_mode":
    case "ready":
      return null;
    case "error":
      return failureMessage || STAFF_COPY.state.error;
    default:
      return STAFF_COPY.state[state];
  }
}

function screenStateBanner(state: StaffScreenState): string {
  if (state === "checking") return "banner-info";
  if (state === "unreachable" || state === "error") return "banner-danger";
  return "banner-warning";
}

function sameId(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

/**
 * Staff accounts.
 *
 * - Device mode (this device has no server): staff records live on this
 *   device only, each with a PIN, as before.
 * - Server mode: accounts are created, invited, disabled and reactivated
 *   through the server's staff account service. Each person chooses their
 *   own PIN on a device at their first online sign-in; an administrator can
 *   still set or reset a PIN on this device. PINs are only ever typed in:
 *   they are stored as PBKDF2 hashes and never shown again after they are
 *   set.
 */
export function UserManagement() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const { push: pushToast } = useToast();
  const canManage = !!currentUser && can(currentUser.role, "users");

  const staff = useStaffAccounts();
  const serverMode = staff.state !== "device_mode";
  const serverReady = serverMode && staff.state === "ready" && !!staff.overview;

  const [users, setUsers] = useState<User[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  /** The form sets only this device's PIN (a record the server owns). */
  const [pinOnly, setPinOnly] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<StaffFormErrors>({});
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmRoleChange, setConfirmRoleChange] = useState(false);

  const [pendingStatusUser, setPendingStatusUser] = useState<User | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [pendingDeleteUser, setPendingDeleteUser] = useState<User | null>(null);
  const [pendingPinReset, setPendingPinReset] = useState<User | null>(null);
  const [pinResetBusy, setPinResetBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pendingRetire, setPendingRetire] = useState<User | null>(null);

  const [serverDialog, setServerDialog] = useState<ServerDialog | null>(null);
  const [pendingServer, setPendingServer] = useState<PendingServerAction | null>(null);
  const [serverBusy, setServerBusy] = useState(false);

  const loadUsers = useCallback(async () => {
    try {
      const allUsers = await db.users.orderBy("createdAt").toArray();
      setUsers(allUsers);
      setLoadError(false);
    } catch (error) {
      console.error("Error loading users:", errorName(error));
      setLoadError(true);
      setUsers((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const rows = mergeStaffRows(users ?? [], serverMode ? staff.overview : null);

  // A record the server has removed stops working on this device too (see
  // removedFromServer); the list is then read again without it.
  const removedIds =
    serverReady && canManage
      ? removedFromServer(rows, staff.overview, currentUser?.id)
          .map((u) => u.id)
          .join(",")
      : "";
  useEffect(() => {
    if (!removedIds) return;
    let cancelled = false;
    void (async () => {
      try {
        await Promise.all(
          removedIds.split(",").map((id) => db.users.update(id, { isActive: 0 })),
        );
      } catch (error) {
        console.error("Error switching off removed staff:", errorName(error));
        return;
      }
      if (!cancelled) await loadUsers();
    })();
    return () => {
      cancelled = true;
    };
  }, [removedIds, loadUsers]);

  const showMessage = (message: StaffMessage) => {
    pushToast({ id: generateId(), ...message });
  };

  /**
   * After the server changed an account: bring the staff directory down to
   * this device, then read the server's list and this device's records
   * again. The list is read first so that a newly downloaded record never
   * shows beside an older list that does not have it yet.
   */
  const refreshAfterServerChange = async () => {
    await pullStaffRoster();
    await staff.reload();
    await loadUsers();
  };

  const denied = () =>
    pushToast({
      id: generateId(),
      tone: "error",
      title: "Not allowed",
      body: "Only an administrator can change staff accounts.",
    });

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setErrors({});
    setFormError("");
    setShowForm(false);
    setEditingUser(null);
    setPinOnly(false);
    setConfirmRoleChange(false);
  };

  const openCreate = () => {
    // Server mode adds staff with Add Staff (an invitation), never here.
    if (serverMode) return;
    setForm(EMPTY_FORM);
    setErrors({});
    setFormError("");
    setEditingUser(null);
    setPinOnly(false);
    setShowForm(true);
  };

  const startEdit = (user: User, onlyPin = false) => {
    setForm({
      fullName: user.fullName,
      role: user.role,
      email: user.email || "",
      phone: user.phone || "",
      pin: "", // never pre-filled: PINs are stored only as hashes
      confirmPin: "",
      adminAccess: user.adminAccess || false,
      adminPermanent: user.adminPermanent || false,
    });
    setErrors({});
    setFormError("");
    setEditingUser(user);
    setPinOnly(onlyPin);
    setShowForm(true);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setFormError("");
    if (!canManage) {
      denied();
      return;
    }

    if (pinOnly) {
      // Name, role and contact details belong to the online account: only
      // the PIN on this device is checked and saved.
      const found = pinErrors(validateStaffForm(form, "create"));
      setErrors(found);
      if (Object.keys(found).length > 0) {
        setFormError("Check the highlighted fields.");
        return;
      }
      if (editingUser?.adminPermanent && !currentUser?.adminPermanent) {
        setFormError("Only a permanent admin can change a permanent admin account.");
        return;
      }
      void savePin();
      return;
    }

    const found = validateStaffForm(form, editingUser ? "edit" : "create");
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setFormError("Check the highlighted fields.");
      return;
    }

    // Only admins can grant admin access
    if (form.adminAccess && currentUser?.role !== "admin") {
      setFormError("Only an administrator can grant admin access.");
      return;
    }
    // Only permanent admins can create other permanent admins
    if (form.adminPermanent && !currentUser?.adminPermanent) {
      setFormError("Only a permanent admin can make another permanent admin.");
      return;
    }
    // Only permanent admins can modify permanent admin accounts
    if (editingUser?.adminPermanent && !currentUser?.adminPermanent) {
      setFormError("Only a permanent admin can change a permanent admin account.");
      return;
    }

    if (editingUser && editingUser.role !== form.role) {
      setConfirmRoleChange(true);
      return;
    }
    save();
  };

  /** Sets someone's PIN on this device only; their account is not changed. */
  const savePin = async () => {
    const target = editingUser;
    if (!target) return;
    setSaving(true);
    setFormError("");
    try {
      const pinFields = await devicePinFields(form.pin, form.confirmPin);
      await db.users.update(target.id, pinFields);
      pushToast({
        id: generateId(),
        tone: "success",
        title: "Device PIN set",
        body: `A new PIN is set for ${target.fullName} on this device.`,
      });
      resetForm();
      await loadUsers();
    } catch (error) {
      console.error("Error setting device PIN:", errorName(error));
      setFormError("The PIN was not saved. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    if (!canManage) {
      denied();
      return;
    }
    if (serverMode && !editingUser) {
      // New staff are added online with Add Staff, never on this device.
      setFormError("Use Add Staff to add someone.");
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      // Losing the last admin locks user management away permanently:
      // nothing else grants the `users` permission, and first-run setup
      // refuses to run while an active account exists.
      if (
        editingUser &&
        editingUser.role === "admin" &&
        form.role !== "admin" &&
        (await countOtherActiveAdmins(editingUser.id)) === 0
      ) {
        setConfirmRoleChange(false);
        setFormError(LAST_ADMIN_MESSAGE);
        return;
      }

      // Two people may share a PIN: offline sign-in asks who is signing in
      // and checks only that person's PIN.
      const newPin = form.pin !== "";

      const fullName = form.fullName.trim();
      const pinFields = newPin ? await devicePinFields(form.pin, form.confirmPin) : {};

      if (editingUser) {
        await db.users.update(editingUser.id, {
          fullName,
          role: form.role,
          email: form.email.trim() || undefined,
          phone: form.phone.trim() || undefined,
          ...pinFields,
          adminAccess: form.adminAccess,
          adminPermanent: form.adminPermanent,
          _staffEditBy: currentUser?.id,
          updatedAt: new Date(),
        });
      } else {
        const newUser: User = {
          id: generateId(),
          fullName,
          role: form.role,
          email: form.email.trim() || undefined,
          phone: form.phone.trim() || undefined,
          pinHash: "",
          pinSalt: "",
          ...pinFields,
          adminAccess: form.adminAccess,
          adminPermanent: form.adminPermanent,
          _staffEditBy: currentUser?.id,
          isActive: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        await db.users.add(newUser);
      }

      pushToast({
        id: generateId(),
        tone: "success",
        title: editingUser ? "Staff account updated" : "Staff account added",
        body: editingUser
          ? `${fullName} · ${getRoleDisplayName(form.role)}${newPin ? " · new PIN set" : ""}`
          : `${fullName} can now sign in on this device with their PIN.`,
      });
      resetForm();
      await loadUsers();
    } catch (error) {
      console.error("Error saving user:", errorName(error));
      setConfirmRoleChange(false);
      setFormError("The account was not saved. Try again.");
    } finally {
      setSaving(false);
    }
  };

  /** Resolve a review flag by keeping the account deactivated here. */
  const keepDeactivated = async (user: User) => {
    if (!canManage) {
      denied();
      return;
    }
    try {
      await db.users.update(user.id, { accessConflict: 0 });
      await loadUsers();
    } catch (error) {
      console.error("Error resolving access review:", errorName(error));
    }
  };

  /** Remove someone's offline access on this device (they enroll again). */
  const resetDevicePin = async (user: User) => {
    if (!canManage) {
      denied();
      return;
    }
    setPinResetBusy(true);
    try {
      await clearDevicePin(user.id);
      pushToast({
        id: generateId(),
        tone: "success",
        title: "Device PIN reset",
        body: serverMode
          ? `${user.fullName} chooses a new PIN the next time they sign in online here, or you can set one with ${STAFF_COPY.action.set_device_pin}.`
          : `${user.fullName} chooses a new PIN the next time they sign in online here, or you can set one with Edit.`,
      });
      await loadUsers();
    } catch (error) {
      console.error("Error resetting device PIN:", errorName(error));
      pushToast({
        id: generateId(),
        tone: "error",
        title: "Could not reset the PIN",
        body: "Try again.",
      });
    } finally {
      setPinResetBusy(false);
      setPendingPinReset(null);
    }
  };

  /**
   * Switches someone on or off on this device only. `done` replaces the
   * usual confirmation (Retire device-only record uses its own).
   */
  const setActive = async (
    user: User,
    active: boolean,
    done?: { title: string; body: string },
  ) => {
    if (!canManage) {
      denied();
      return;
    }
    const refuse = (body: string) => {
      pushToast({ id: generateId(), tone: "error", title: "Could not change the account", body });
    };
    if (user.id === currentUser?.id) {
      refuse("You cannot deactivate your own account.");
      return;
    }
    if (user.adminPermanent) {
      refuse("Permanent admin accounts cannot be deactivated.");
      return;
    }
    setStatusBusy(true);
    try {
      if (
        !active &&
        user.role === "admin" &&
        (await countOtherActiveAdmins(user.id)) === 0
      ) {
        refuse(LAST_ADMIN_MESSAGE);
        return;
      }
      // A deactivation here is remembered so a download never silently
      // reactivates the person; activating is the authorised resolution.
      await db.users.update(user.id, {
        isActive: active ? 1 : 0,
        disabledLocallyAt: active ? undefined : new Date(),
        accessConflict: 0,
        updatedAt: new Date(),
      });
      pushToast({
        id: generateId(),
        tone: "success",
        title: done?.title ?? (active ? "Account activated" : "Account deactivated"),
        body:
          done?.body ??
          (active
            ? `${user.fullName} can sign in on this device again.`
            : `${user.fullName} can no longer sign in on this device.`),
      });
      await loadUsers();
    } catch (error) {
      console.error("Error toggling user status:", errorName(error));
      refuse("The change was not saved. Try again.");
    } finally {
      setStatusBusy(false);
      setPendingStatusUser(null);
    }
  };

  const retireDeviceRecord = async () => {
    const target = pendingRetire;
    if (!target) return;
    await setActive(target, false, {
      title: STAFF_COPY.retire.doneTitle,
      body: STAFF_COPY.retire.done(target.fullName),
    });
    setPendingRetire(null);
  };

  const deleteUser = async () => {
    const target = pendingDeleteUser;
    if (!target) return;
    if (!canManage) {
      denied();
      setPendingDeleteUser(null);
      return;
    }
    const refuse = (body: string) => {
      setPendingDeleteUser(null);
      pushToast({ id: generateId(), tone: "error", title: "Account not deleted", body });
    };
    if (target.id === currentUser?.id) {
      refuse("You cannot delete your own account.");
      return;
    }
    if (target.adminPermanent) {
      refuse("Permanent admin accounts cannot be deleted.");
      return;
    }
    // In server mode only a record that exists on this device alone can be
    // deleted; an online account is disabled instead.
    if (serverMode && rows.find((r) => r.id === target.id)?.source !== "device_only") {
      refuse("This person has an online account. Use Disable to stop them signing in.");
      return;
    }

    setDeleting(true);
    try {
      if (target.role === "admin" && (await countOtherActiveAdmins(target.id)) === 0) {
        refuse(LAST_ADMIN_MESSAGE);
        return;
      }

      await db.users.delete(target.id);

      setPendingDeleteUser(null);
      pushToast({
        id: generateId(),
        tone: "success",
        title: "Account deleted",
        body: `${target.fullName} was removed from this device.`,
      });
      await loadUsers();
    } catch (error) {
      console.error("Error deleting user:", errorName(error));
      refuse("The account was not deleted. Try again.");
    } finally {
      setDeleting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Server actions

  const runServerAction = async () => {
    const pending = pendingServer;
    if (!pending || serverBusy) return;
    if (!canManage) {
      denied();
      setPendingServer(null);
      return;
    }
    const { action, account } = pending;
    const name = pending.row.fullName || account.fullName;
    const email = account.email || "their email address";
    setServerBusy(true);
    try {
      if (action === "disable") {
        const result = await disableStaffAccount(account.userId);
        if (result.ok === false) {
          showMessage({ tone: "error", title: STAFF_COPY.disable.failedTitle, body: result.message });
          return;
        }
        showMessage(disableResultMessage(name, result.data.rowUpdated));
        setPendingServer(null);
        // Never switched off here by hand: the directory download brings
        // the disabled account to this device, like every other device.
        await refreshAfterServerChange();
        return;
      }
      if (action === "resend_invitation") {
        const result = await resendInvitation(account.userId);
        if (result.ok === false) {
          showMessage({ tone: "error", title: STAFF_COPY.resend.failedTitle, body: result.message });
          return;
        }
        showMessage(resendResultMessage(email, result.data.invitation));
        setPendingServer(null);
        await staff.reload();
        return;
      }
      const result = await sendPasswordReset(account.userId);
      if (result.ok === false) {
        showMessage({
          tone: "error",
          title: STAFF_COPY.resetPassword.failedTitle,
          body: result.message,
        });
        return;
      }
      showMessage(resetPasswordResultMessage(email, result.data.invitation));
    } finally {
      setServerBusy(false);
      setPendingServer(null);
    }
  };

  /** Reactivated on the server: undo a deactivation by hand on this device. */
  const afterReactivate = async (row: StaffRow, message: StaffMessage) => {
    showMessage(message);
    const device = row.device;
    if (device && (device.disabledLocallyAt || device.accessConflict === 1)) {
      try {
        await db.users.update(device.id, {
          isActive: 1,
          disabledLocallyAt: undefined,
          accessConflict: 0,
          updatedAt: new Date(),
        });
      } catch (error) {
        console.error("Error clearing the deactivation on this device:", errorName(error));
      }
    }
    await refreshAfterServerChange();
  };

  const afterServerChange = (message: StaffMessage) => {
    showMessage(message);
    void refreshAfterServerChange();
  };

  const runRowAction = (row: StaffRow, kind: RowActionKind) => {
    if (!canManage) {
      denied();
      return;
    }
    const account = row.account;
    const device = row.device;
    switch (kind) {
      case "edit_account":
        if (account) setServerDialog({ kind: "edit_account", account });
        return;
      case "resend_invitation":
      case "reset_password":
      case "disable":
        if (account) setPendingServer({ action: kind, row, account });
        return;
      case "login_status":
        setServerDialog({ kind: "login_status", row });
        return;
      case "reactivate":
        if (account) setServerDialog({ kind: "reactivate", row, account });
        return;
      case "create_login":
        if (account) setServerDialog({ kind: "create_login", account });
        return;
      case "edit_on_device":
        // Only a record that exists on this device alone is edited in full;
        // for everyone else this form sets their PIN here.
        if (device) startEdit(device, row.source !== "device_only");
        return;
      case "reset_device_pin":
        if (device) setPendingPinReset(device);
        return;
      case "deactivate_on_device":
        if (device) setPendingStatusUser(device);
        return;
      case "activate_on_device":
        if (device) void setActive(device, true);
        return;
      case "delete":
        if (device) setPendingDeleteUser(device);
        return;
      case "retire_device_record":
        if (device) setPendingRetire(device);
        return;
    }
  };

  // ---------------------------------------------------------------------------
  // Rendering

  const isEditing = !!editingUser;
  const roleOptions = ASSIGNABLE_ROLES.includes(form.role)
    ? ASSIGNABLE_ROLES
    : [...ASSIGNABLE_ROLES, form.role];
  const editingSelf = isEditing && editingUser?.id === currentUser?.id;

  const fieldProps = (field: keyof StaffFormErrors) => ({
    "aria-invalid": errors[field] ? true : undefined,
    "aria-describedby": errors[field] ? `staff-${field}-error` : undefined,
  });
  const fieldError = (field: keyof StaffFormErrors) =>
    errors[field] ? (
      <p id={`staff-${field}-error`} className="field-error">
        {errors[field]}
      </p>
    ) : null;

  const pinDescribedBy = ["staff-pin-hint", errors.pin && "staff-pin-error"]
    .filter(Boolean)
    .join(" ");

  const canEditUser = (u: User) => !(u.adminPermanent && !currentUser?.adminPermanent);
  const canChangeStatus = (u: User) => u.id !== currentUser?.id && !u.adminPermanent;
  const canDeleteUser = (u: User) => u.id !== currentUser?.id && !u.adminPermanent;

  /** Device mode: the actions on a record on this device. */
  const renderActions = (u: User, compact = false) => {
    const editable = canEditUser(u);
    const statusable = canChangeStatus(u);
    const deletable = canDeleteUser(u);
    if (!editable && !statusable && !deletable) {
      return <span className="text-caption text-ink-muted">Protected account</span>;
    }
    return (
      <div className={`flex flex-wrap items-center gap-1 ${compact ? "" : "justify-end"}`}>
        {editable && (
          <button
            type="button"
            onClick={() => startEdit(u)}
            className="btn-ghost"
            aria-label={`Edit ${u.fullName}`}
          >
            <PencilIcon className="h-4 w-4" aria-hidden />
            Edit
          </button>
        )}
        {editable && hasDevicePin(u) && (
          <button
            type="button"
            onClick={() => setPendingPinReset(u)}
            className="btn-ghost"
            aria-label={`Reset device PIN for ${u.fullName}`}
          >
            <KeyIcon className="h-4 w-4" aria-hidden />
            Reset PIN
          </button>
        )}
        {statusable &&
          (u.isActive === 1 ? (
            <button
              type="button"
              onClick={() => setPendingStatusUser(u)}
              className="btn-ghost"
              aria-label={`Deactivate ${u.fullName}`}
            >
              <NoSymbolIcon className="h-4 w-4" aria-hidden />
              Deactivate
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setActive(u, true)}
              disabled={statusBusy}
              className="btn-ghost"
              aria-label={`Activate ${u.fullName}`}
            >
              <CheckCircleIcon className="h-4 w-4" aria-hidden />
              Activate
            </button>
          ))}
        {deletable && (
          <button
            type="button"
            onClick={() => setPendingDeleteUser(u)}
            className="btn-ghost text-danger-fg hover:text-danger-fg"
            aria-label={`Delete ${u.fullName}`}
          >
            <TrashIcon className="h-4 w-4" aria-hidden />
            Delete
          </button>
        )}
      </div>
    );
  };

  /** Server mode: the actions a row offers (rowActions). */
  const renderRowActions = (row: StaffRow, compact = false) => {
    if (!canManage) return null;
    const actions: RowAction[] = rowActions(row, {
      currentUserId: currentUser?.id,
      currentUserPermanent:
        staff.overview?.caller?.adminPermanent ?? !!currentUser?.adminPermanent,
      serverReady,
      online: typeof navigator === "undefined" || navigator.onLine !== false,
      offeredRoles: staff.overview?.roles ?? [],
    });
    if (actions.length === 0) {
      const permanent = row.account?.adminPermanent || row.device?.adminPermanent;
      return permanent ? (
        <span className="text-caption text-ink-muted">Protected account</span>
      ) : null;
    }
    return (
      <div className={`flex flex-wrap items-center gap-1 ${compact ? "" : "justify-end"}`}>
        {actions.map((a) => {
          const Icon = ACTION_ICONS[a.kind];
          // Records the server owns only get their PIN set on this device.
          const label =
            a.kind === "edit_on_device" && row.source !== "device_only"
              ? STAFF_COPY.action.set_device_pin
              : a.label;
          return (
            <button
              key={a.kind}
              type="button"
              onClick={() => runRowAction(row, a.kind)}
              disabled={a.kind === "activate_on_device" && statusBusy}
              className={a.danger ? "btn-ghost text-danger-fg hover:text-danger-fg" : "btn-ghost"}
              aria-label={`${label}, ${row.fullName}`}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {label}
            </button>
          );
        })}
      </div>
    );
  };

  const renderAdminFlags = (f: { adminAccess?: boolean; adminPermanent?: boolean }) => (
    <div className="flex flex-wrap gap-1">
      {f.adminPermanent && <StatusBadge tone="info">Permanent admin</StatusBadge>}
      {f.adminAccess && <StatusBadge>Admin access</StatusBadge>}
      {!f.adminAccess && !f.adminPermanent && (
        <span className="text-caption text-ink-muted">None</span>
      )}
    </div>
  );

  const keepDeactivatedButton = (u: User) =>
    canManage ? (
      <button
        type="button"
        onClick={() => keepDeactivated(u)}
        className="btn-ghost"
        aria-label={`Keep ${u.fullName} deactivated`}
      >
        Keep deactivated
      </button>
    ) : null;

  /** Device mode: the record's status on this device. */
  const renderStatus = (u: User) =>
    u.accessConflict === 1 ? (
      <span className="flex flex-col items-start gap-1">
        <StatusBadge tone="warning" icon>
          Needs review
        </StatusBadge>
        <span className="text-caption text-ink-muted">
          Deactivated on this device, still active online.
        </span>
        {keepDeactivatedButton(u)}
      </span>
    ) : u.isActive === 1 ? (
      <StatusBadge tone="success" icon>
        Active
      </StatusBadge>
    ) : (
      <StatusBadge tone="neutral" icon>
        Deactivated
      </StatusBadge>
    );

  /**
   * Server mode: the account's status, and its record on this device. When
   * the server says the account is disabled, a record switched off here is
   * expected and never needs review.
   */
  const renderRowStatus = (row: StaffRow) => {
    const u = row.device;
    const reviewWithoutAccount = !row.account && u?.accessConflict === 1;
    const offWithoutAccount = !row.account && !!u && u.isActive === 0 && u.accessConflict !== 1;
    const review = row.deviceNote === "needs_review" || reviewWithoutAccount;
    return (
      <span className="flex flex-col items-start gap-1">
        <StaffStatusBadge row={row} />
        {reviewWithoutAccount && (
          <>
            <StatusBadge tone="warning" icon>
              {STAFF_COPY.deviceNote.needs_review}
            </StatusBadge>
            <span className="text-caption text-ink-muted">
              {STAFF_COPY.deviceNote.needs_review_detail}
            </span>
          </>
        )}
        {offWithoutAccount && (
          <StatusBadge tone="neutral">{STAFF_COPY.deviceNote.off_on_device}</StatusBadge>
        )}
        {review && u && keepDeactivatedButton(u)}
      </span>
    );
  };

  const renderOfflineAccess = (u: User | null) =>
    u && hasDevicePin(u) ? (
      <StatusBadge tone="success">PIN on this device</StatusBadge>
    ) : (
      <StatusBadge tone="neutral">No PIN here</StatusBadge>
    );

  const statusCell = (row: StaffRow) =>
    serverMode ? renderRowStatus(row) : row.device ? renderStatus(row.device) : null;

  const actionsCell = (row: StaffRow, compact = false) =>
    serverMode
      ? renderRowActions(row, compact)
      : row.device
        ? renderActions(row.device, compact)
        : null;

  const adminFlagsOf = (row: StaffRow) =>
    row.account
      ? { adminAccess: row.account.adminAccess, adminPermanent: row.account.adminPermanent }
      : { adminAccess: !!row.device?.adminAccess, adminPermanent: !!row.device?.adminPermanent };

  const addedOn = (row: StaffRow) =>
    formatNigerianDate(row.device?.createdAt ?? row.account?.createdAt ?? null);

  const oldRole = editingUser?.role;
  const gained = oldRole ? gainedAccess(oldRole, form.role) : [];
  const lost = oldRole ? lostAccess(oldRole, form.role) : [];

  const stateText = serverMode ? screenStateText(staff.state, staff.failureMessage) : null;
  const canRetry = staff.state === "unreachable" || staff.state === "error";
  const pendingCopy = pendingServer
    ? serverConfirmCopy(pendingServer, staff.overview?.roles ?? [])
    : null;
  const inviting = serverDialog?.kind === "invite";
  const editingAccount = serverDialog?.kind === "edit_account" ? serverDialog : null;
  const viewingLogin = serverDialog?.kind === "login_status" ? serverDialog : null;
  const reactivating = serverDialog?.kind === "reactivate" ? serverDialog : null;
  const creatingLogin = serverDialog?.kind === "create_login" ? serverDialog : null;
  // Only records still switched on that no server account covers yet: a
  // record retired at sign-in, or one whose email already has an account,
  // needs no Add Staff.
  const deviceOnlyNames = serverReady
    ? rows
        .filter(
          (r) =>
            r.source === "device_only" && r.device?.isActive === 1 && !r.sameEmailServerAccount,
        )
        .map((r) => r.fullName)
    : [];

  return (
    <div className="space-y-4">
      <div className="banner banner-info">
        <p>
          Staff come from your organisation's online directory. Offline access
          is per device: each person signs in offline here with their own
          6-digit PIN, which is stored scrambled on this device only and never
          sent to the server.
        </p>
      </div>

      {showForm && canManage && (
        <form
          onSubmit={handleSubmit}
          className="panel"
          aria-labelledby="staff-form-title"
          noValidate
        >
          <div className="panel-header">
            <h2 id="staff-form-title" className="panel-title">
              {pinOnly
                ? `Set a PIN for ${editingUser?.fullName ?? "this person"} on this device`
                : isEditing
                  ? `Edit ${editingUser?.fullName}`
                  : "Add staff member"}
            </h2>
          </div>
          <div className="panel-body space-y-4">
            {formError && (
              <div className="banner banner-danger" role="alert">
                {formError}
              </div>
            )}

            {pinOnly && (
              <p className="field-hint">
                {editingUser?.fullName} ({roleName(form.role)}). Their name and role come
                from their online account and are changed with Edit, not here. This
                form only sets their PIN on this device.
              </p>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              {!pinOnly && (
                <>
                  <div>
                    <label htmlFor="staff-fullName" className="field-label">
                      Full name
                    </label>
                    <input
                      id="staff-fullName"
                      type="text"
                      required
                      autoComplete="off"
                      value={form.fullName}
                      onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                      className="input-field"
                      {...fieldProps("fullName")}
                    />
                    {fieldError("fullName")}
                  </div>

                  <div>
                    <label htmlFor="staff-role" className="field-label">
                      Role
                    </label>
                    <select
                      id="staff-role"
                      value={form.role}
                      onChange={(e) => {
                        const next = roleOptions.find((r) => r === e.target.value);
                        if (next) setForm({ ...form, role: next });
                      }}
                      className="input-field"
                      aria-describedby="staff-role-hint"
                      aria-invalid={errors.role ? true : undefined}
                    >
                      {roleOptions.map((r) => (
                        <option key={r} value={r}>
                          {getRoleDisplayName(r)}
                        </option>
                      ))}
                    </select>
                    <p id="staff-role-hint" className="field-hint">
                      {describeRoleAccess(form.role)}
                    </p>
                    {fieldError("role")}
                  </div>

                  <div>
                    <label htmlFor="staff-email" className="field-label">
                      Email <span className="font-normal text-ink-muted">(optional)</span>
                    </label>
                    <input
                      id="staff-email"
                      type="email"
                      autoComplete="off"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      className="input-field"
                      placeholder="name@example.com"
                      {...fieldProps("email")}
                    />
                    {fieldError("email")}
                  </div>

                  <div>
                    <label htmlFor="staff-phone" className="field-label">
                      Phone <span className="font-normal text-ink-muted">(optional)</span>
                    </label>
                    <input
                      id="staff-phone"
                      type="tel"
                      autoComplete="off"
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                      className="input-field"
                      placeholder="0803 123 4567"
                      {...fieldProps("phone")}
                    />
                    {fieldError("phone")}
                  </div>
                </>
              )}

              <div>
                <label htmlFor="staff-pin" className="field-label">
                  {isEditing ? "New PIN (6 digits)" : "PIN (6 digits)"}
                </label>
                <input
                  id="staff-pin"
                  type="password"
                  inputMode="numeric"
                  autoComplete="new-password"
                  maxLength={6}
                  required={!isEditing || pinOnly}
                  value={form.pin}
                  onChange={(e) =>
                    setForm({ ...form, pin: e.target.value.replace(/\D/g, "").slice(0, 6) })
                  }
                  className="input-field tabular-nums"
                  {...fieldProps("pin")}
                  aria-describedby={pinDescribedBy}
                />
                <p id="staff-pin-hint" className="field-hint">
                  {pinOnly
                    ? "Sets this person's PIN on this device only. Hand the device to them to type it."
                    : isEditing
                      ? "Sets this person's PIN on this device only. Leave blank to keep the current one. Hand the device to them to type it."
                      : "Works on this device only. Give the PIN to the person privately. It cannot be shown again."}
                </p>
                {fieldError("pin")}
              </div>

              <div>
                <label htmlFor="staff-confirmPin" className="field-label">
                  {isEditing ? "Confirm new PIN" : "Confirm PIN"}
                </label>
                <input
                  id="staff-confirmPin"
                  type="password"
                  inputMode="numeric"
                  autoComplete="new-password"
                  maxLength={6}
                  required={!isEditing || pinOnly}
                  value={form.confirmPin}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      confirmPin: e.target.value.replace(/\D/g, "").slice(0, 6),
                    })
                  }
                  className="input-field tabular-nums"
                  {...fieldProps("confirmPin")}
                />
                {fieldError("confirmPin")}
              </div>

              {/* Admin flags */}
              {!pinOnly && currentUser?.role === "admin" && (
                <fieldset className="space-y-2 border-t border-line pt-4 md:col-span-2">
                  <legend className="section-label">Admin flags</legend>

                  <label
                    htmlFor="staff-adminAccess"
                    className="flex min-h-touch-target items-center gap-3 text-body text-ink"
                  >
                    <input
                      type="checkbox"
                      id="staff-adminAccess"
                      checked={form.adminAccess}
                      onChange={(e) => setForm({ ...form, adminAccess: e.target.checked })}
                      className="h-5 w-5 rounded border-line-strong text-primary focus:ring-primary"
                    />
                    Admin access
                  </label>

                  {currentUser?.adminPermanent && (
                    <label
                      htmlFor="staff-adminPermanent"
                      className="flex min-h-touch-target items-center gap-3 text-body text-ink"
                    >
                      <input
                        type="checkbox"
                        id="staff-adminPermanent"
                        checked={form.adminPermanent}
                        onChange={(e) =>
                          setForm({ ...form, adminPermanent: e.target.checked })
                        }
                        className="h-5 w-5 rounded border-line-strong text-primary focus:ring-primary"
                      />
                      Permanent admin
                    </label>
                  )}

                  <p className="field-hint">
                    What a person can do is set by their role: choose Admin as the
                    role to let them manage staff and export data. Permanent admin
                    accounts cannot be deactivated or deleted, and only another
                    permanent admin can edit them.
                  </p>
                </fieldset>
              )}
            </div>
          </div>
          <div className="flex flex-col-reverse gap-2 border-t border-line px-4 py-3 sm:flex-row sm:justify-end">
            <button type="button" onClick={resetForm} className="btn-secondary" disabled={saving}>
              Cancel
            </button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving
                ? "Saving…"
                : pinOnly
                  ? "Set PIN"
                  : isEditing
                    ? "Save changes"
                    : "Add staff member"}
            </button>
          </div>
        </form>
      )}

      <section className="panel" aria-labelledby="staff-list-title">
        <div className="panel-header">
          <h2 id="staff-list-title" className="panel-title">
            Staff{users ? ` (${rows.length})` : ""}
          </h2>
          {canManage && serverMode && (
            <button
              type="button"
              onClick={() => setServerDialog({ kind: "invite" })}
              disabled={!serverReady}
              className="btn-primary"
              aria-describedby={stateText ? "staff-server-state" : undefined}
            >
              <UserPlusIcon className="h-5 w-5" aria-hidden />
              {STAFF_COPY.addStaff}
            </button>
          )}
          {canManage && !serverMode && !showForm && (
            <button type="button" onClick={openCreate} className="btn-primary">
              <UserPlusIcon className="h-5 w-5" aria-hidden />
              Add staff member
            </button>
          )}
        </div>

        {stateText && (
          <div
            id="staff-server-state"
            className={`banner ${screenStateBanner(staff.state)} m-4`}
            role={staff.state === "checking" ? "status" : "alert"}
          >
            <span className="flex-1">{stateText}</span>
            {canRetry && (
              <button type="button" onClick={() => void staff.reload()} className="btn-secondary">
                {STAFF_COPY.tryAgain}
              </button>
            )}
          </div>
        )}

        {serverReady && staff.notice && (
          <div className="banner banner-info m-4" role="status">
            <span className="flex-1">{staff.notice}</span>
          </div>
        )}

        {loadError && (
          <div className="banner banner-danger m-4" role="alert">
            <span className="flex-1">Staff accounts could not be loaded from this device.</span>
            <button type="button" onClick={loadUsers} className="btn-secondary">
              Try again
            </button>
          </div>
        )}

        {users === null ? (
          <div>
            <span role="status" className="sr-only">
              Loading staff accounts
            </span>
            <div className="divide-y divide-line" aria-hidden>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="ml-auto h-4 w-24" />
                </div>
              ))}
            </div>
          </div>
        ) : rows.length === 0 ? (
          !loadError &&
          (serverMode ? (
            <EmptyState icon={UsersIcon} title={STAFF_COPY.emptyServer} />
          ) : (
            <EmptyState
              icon={UsersIcon}
              title="No staff accounts on this device"
              description="Add the people who will sign in here, with a role and a 6-digit PIN."
            />
          ))
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Role</th>
                    <th scope="col">Admin flags</th>
                    <th scope="col">Contact</th>
                    <th scope="col">{STAFF_COPY.columns.status}</th>
                    <th scope="col">Offline access</th>
                    <th scope="col">Added</th>
                    <th scope="col">
                      <span className="sr-only">{STAFF_COPY.columns.actions}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-ink">{row.fullName}</span>
                          {sameId(row.id, currentUser?.id) && (
                            <StatusBadge tone="info">You</StatusBadge>
                          )}
                        </span>
                        <span className="block text-caption text-ink-muted tabular-nums">
                          ID {row.id.slice(-8).toUpperCase()}
                        </span>
                      </td>
                      <td>
                        <StatusBadge>{roleName(row.role)}</StatusBadge>
                      </td>
                      <td>{renderAdminFlags(adminFlagsOf(row))}</td>
                      <td className="text-caption text-ink-secondary">
                        {row.email && <span className="block">{row.email}</span>}
                        {row.device?.phone && (
                          <span className="block tabular-nums">{row.device.phone}</span>
                        )}
                        {!row.email && !row.device?.phone && (
                          <span className="text-ink-muted">None</span>
                        )}
                      </td>
                      <td>{statusCell(row)}</td>
                      <td>{renderOfflineAccess(row.device)}</td>
                      <td className="text-caption text-ink-muted tabular-nums">{addedOn(row)}</td>
                      <td className="text-right">{actionsCell(row)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="divide-y divide-line md:hidden">
              {rows.map((row) => {
                const flags = adminFlagsOf(row);
                return (
                  <li key={row.id} className="space-y-2 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-ink">{row.fullName}</span>
                      {sameId(row.id, currentUser?.id) && (
                        <StatusBadge tone="info">You</StatusBadge>
                      )}
                      <StatusBadge>{roleName(row.role)}</StatusBadge>
                      {statusCell(row)}
                      {renderOfflineAccess(row.device)}
                    </div>
                    {(flags.adminAccess || flags.adminPermanent) && renderAdminFlags(flags)}
                    <p className="text-caption text-ink-muted">
                      {[row.email, row.device?.phone].filter(Boolean).join(" · ") ||
                        "No contact details"}
                      {" · "}Added {addedOn(row)}
                    </p>
                    {actionsCell(row, true)}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      {serverMode && canManage && staff.overview && (
        <AccountHealthPanel
          overview={staff.overview}
          deviceOnlyNames={deviceOnlyNames}
          canRepair={serverReady}
          onRepaired={afterServerChange}
          onMaybeRepaired={() => void refreshAfterServerChange()}
        />
      )}

      {inviting && staff.overview && (
        <InviteStaffDialog
          overview={staff.overview}
          onClose={() => setServerDialog(null)}
          onCreated={(message) => afterServerChange(message)}
          onMaybeCreated={() => void refreshAfterServerChange()}
        />
      )}

      {editingAccount && staff.overview && (
        <EditStaffAccountDialog
          account={editingAccount.account}
          overview={staff.overview}
          onClose={() => setServerDialog(null)}
          onSaved={(message) => afterServerChange(message)}
        />
      )}

      {viewingLogin && (
        <StaffLoginStatusDialog
          userId={viewingLogin.row.id}
          fullName={viewingLogin.row.fullName}
          onClose={() => setServerDialog(null)}
        />
      )}

      {reactivating && staff.overview && (
        <ReactivateDialog
          account={reactivating.account}
          overview={staff.overview}
          onClose={() => setServerDialog(null)}
          onReactivated={(message) => void afterReactivate(reactivating.row, message)}
        />
      )}

      {creatingLogin && staff.overview && (
        <CreateLoginDialog
          userId={creatingLogin.account.userId}
          fullName={creatingLogin.account.fullName}
          inviteLifetimeSeconds={staff.overview.inviteLifetimeSeconds}
          onClose={() => setServerDialog(null)}
          onCreated={(message) => afterServerChange(message)}
          onMaybeCreated={() => void refreshAfterServerChange()}
        />
      )}

      {pendingServer && pendingCopy && (
        <ConfirmDialog
          open
          title={pendingCopy.title}
          confirmLabel={pendingCopy.confirm}
          tone={pendingCopy.danger ? "danger" : "primary"}
          busy={serverBusy}
          busyLabel={pendingCopy.busy}
          onConfirm={() => void runServerAction()}
          onCancel={() => setPendingServer(null)}
        >
          <p>{pendingCopy.body}</p>
          {pendingCopy.warning && (
            <p className="font-medium text-warning-fg">{pendingCopy.warning}</p>
          )}
        </ConfirmDialog>
      )}

      <ConfirmDialog
        open={confirmRoleChange && !!editingUser}
        title={`Change ${editingUser?.fullName ?? "this person"}'s role to ${getRoleDisplayName(form.role)}?`}
        confirmLabel={`Change role to ${getRoleDisplayName(form.role)}`}
        busy={saving}
        busyLabel="Saving…"
        onConfirm={save}
        onCancel={() => setConfirmRoleChange(false)}
      >
        <p>
          Their role changes from {oldRole ? getRoleDisplayName(oldRole) : ""} to{" "}
          {getRoleDisplayName(form.role)}.
        </p>
        {gained.length > 0 && <p>They will be able to {gained.join(", ")}.</p>}
        {lost.length > 0 && <p>They will no longer be able to {lost.join(", ")}.</p>}
        {editingSelf ? (
          <p className="font-medium text-warning-fg">
            This is your own account. Your access changes the next time you sign in
            {lost.includes("manage staff accounts")
              ? ", and you will no longer be able to manage staff accounts"
              : ""}
            .
          </p>
        ) : (
          <p>The change applies the next time they sign in on this device.</p>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={!!pendingStatusUser}
        title={
          serverMode
            ? `Deactivate ${pendingStatusUser?.fullName ?? "this account"} on this device?`
            : `Deactivate ${pendingStatusUser?.fullName ?? "this account"}?`
        }
        confirmLabel={serverMode ? STAFF_COPY.action.deactivate_on_device : "Deactivate account"}
        tone="danger"
        busy={statusBusy}
        busyLabel="Deactivating…"
        onConfirm={() => pendingStatusUser && setActive(pendingStatusUser, false)}
        onCancel={() => setPendingStatusUser(null)}
      >
        <p>
          They will not be able to sign in on this device until an administrator
          activates the account again.
        </p>
        {serverMode && (
          <p>
            This only changes this device. To stop them signing in anywhere, use
            Disable.
          </p>
        )}
        <p>Records they created are kept.</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={!!pendingRetire}
        title={STAFF_COPY.retire.title(pendingRetire?.fullName ?? "this person")}
        confirmLabel={STAFF_COPY.retire.confirm}
        busy={statusBusy}
        busyLabel="Saving…"
        onConfirm={() => void retireDeviceRecord()}
        onCancel={() => setPendingRetire(null)}
      >
        <p>{STAFF_COPY.retire.body}</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={!!pendingPinReset}
        title={`Reset ${pendingPinReset?.fullName ?? "this person"}'s PIN on this device?`}
        confirmLabel="Reset PIN"
        busy={pinResetBusy}
        busyLabel="Resetting…"
        onConfirm={() => pendingPinReset && resetDevicePin(pendingPinReset)}
        onCancel={() => setPendingPinReset(null)}
      >
        <p>
          Their current PIN stops working on this device. They choose a new one
          the next time they sign in online here, or you can set one now with{" "}
          {serverMode ? STAFF_COPY.action.set_device_pin : "Edit"}.
        </p>
        <p>Their account and records are not changed.</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={!!pendingDeleteUser}
        title={`Delete ${pendingDeleteUser?.fullName ?? "this account"}?`}
        confirmLabel="Delete account"
        cancelLabel="Keep account"
        tone="danger"
        busy={deleting}
        busyLabel="Deleting…"
        onConfirm={deleteUser}
        onCancel={() => setPendingDeleteUser(null)}
      >
        {serverMode ? (
          <p>{STAFF_COPY.deleteDeviceOnly.body(pendingDeleteUser?.fullName ?? "This person")}</p>
        ) : (
          <p>
            The account is removed from this device and they lose access
            immediately. Records they created are kept.
          </p>
        )}
        {serverMode ? (
          <p>Records they created are kept.</p>
        ) : (
          <p>To stop someone signing in but keep the account, deactivate it instead.</p>
        )}
        <p className="font-medium text-danger-fg">This cannot be undone.</p>
      </ConfirmDialog>
    </div>
  );
}

/**
 * Title, body and button of the confirmation before a server action.
 * `offeredRoles` is overview.roles: disabling an administrator warns when
 * the administrator role can't be given back from this screen.
 */
function serverConfirmCopy(
  pending: PendingServerAction,
  offeredRoles: readonly string[],
): {
  title: string;
  body: string;
  warning: string | null;
  confirm: string;
  busy: string;
  danger: boolean;
} {
  const name = pending.row.fullName || pending.account.fullName;
  switch (pending.action) {
    case "disable":
      return {
        title: STAFF_COPY.disable.title(name),
        body: STAFF_COPY.disable.body,
        warning: adminRoleIsOneWay(pending.account.role, offeredRoles)
          ? STAFF_COPY.disable.adminOneWay
          : null,
        confirm: STAFF_COPY.disable.confirm,
        busy: STAFF_COPY.disable.busy,
        danger: true,
      };
    case "resend_invitation":
      return {
        title: STAFF_COPY.resend.title(name),
        body: STAFF_COPY.resend.body,
        warning: null,
        confirm: STAFF_COPY.resend.confirm,
        busy: STAFF_COPY.resend.busy,
        danger: false,
      };
    default:
      return {
        title: STAFF_COPY.resetPassword.title(name),
        body: STAFF_COPY.resetPassword.body,
        warning: null,
        confirm: STAFF_COPY.resetPassword.confirm,
        busy: STAFF_COPY.resetPassword.busy,
        danger: false,
      };
  }
}
