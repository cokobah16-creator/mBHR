import { useCallback, useEffect, useState, type FormEvent } from "react";
import { db, User, generateId } from "@/db";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/stores/toast";
import { devicePinFields, clearDevicePin } from "@/db/devicePin";
import { hasDevicePin } from "@/db/offlineAccess";
import { countOtherActiveAdmins, LAST_ADMIN_MESSAGE } from "@/db/firstRun";
import { can, getRoleDisplayName } from "@/auth/roles";
import { supabase } from "@/lib/supabase";
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
  UserPlusIcon,
  PencilIcon,
  TrashIcon,
  UsersIcon,
  NoSymbolIcon,
  CheckCircleIcon,
  KeyIcon,
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

function errorName(error: unknown) {
  return error instanceof Error ? error.name : error;
}

/**
 * Staff accounts stored on this device. PINs are only ever typed in: they
 * are stored as PBKDF2 hashes and never shown again after they are set.
 */
export function UserManagement() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const { push: pushToast } = useToast();
  const canManage = !!currentUser && can(currentUser.role, "users");

  const [users, setUsers] = useState<User[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
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
    setConfirmRoleChange(false);
  };

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setErrors({});
    setFormError("");
    setEditingUser(null);
    setShowForm(true);
  };

  const startEdit = (user: User) => {
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
    setShowForm(true);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setFormError("");
    if (!canManage) {
      denied();
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

  const save = async () => {
    if (!canManage) {
      denied();
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
        body: `${user.fullName} chooses a new PIN the next time they sign in online here, or you can set one with Edit.`,
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

  const setActive = async (user: User, active: boolean) => {
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
        title: active ? "Account activated" : "Account deactivated",
        body: active
          ? `${user.fullName} can sign in on this device again.`
          : `${user.fullName} can no longer sign in on this device.`,
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

    setDeleting(true);
    try {
      if (target.role === "admin" && (await countOtherActiveAdmins(target.id)) === 0) {
        refuse(LAST_ADMIN_MESSAGE);
        return;
      }

      await db.users.delete(target.id);

      // Staff accounts sync through the server's app_users table. Ask for the
      // deleted row back: row-level security can silently match nothing.
      let serverResult: "none" | "removed" | "not_removed" = "none";
      if (supabase) {
        try {
          const { data, error } = await supabase
            .from("app_users")
            .delete()
            .eq("id", target.id)
            .select("id");
          serverResult = !error && (data?.length ?? 0) > 0 ? "removed" : "not_removed";
        } catch (error) {
          console.error("Error deleting user on server:", errorName(error));
          serverResult = "not_removed";
        }
      }

      setPendingDeleteUser(null);
      const otherDevices =
        " Other devices switch the account off the next time someone signs in online there; until then it may still unlock them with its PIN.";
      if (serverResult === "not_removed") {
        pushToast({
          id: generateId(),
          tone: "warning",
          title: "Deleted on this device only",
          body: `${target.fullName} was removed here, but the server copy was not removed (offline, not permitted, or not on the server). The account may come back after the next sync; delete it again when online.${otherDevices}`,
        });
      } else {
        pushToast({
          id: generateId(),
          tone: "success",
          title: "Account deleted",
          body:
            serverResult === "removed"
              ? `${target.fullName} was removed from this device and from the server.${otherDevices}`
              : `${target.fullName} was removed from this device.`,
        });
      }
      await loadUsers();
    } catch (error) {
      console.error("Error deleting user:", errorName(error));
      refuse("The account was not deleted. Try again.");
    } finally {
      setDeleting(false);
    }
  };

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

  const renderAdminFlags = (u: User) => (
    <div className="flex flex-wrap gap-1">
      {u.adminPermanent && <StatusBadge tone="info">Permanent admin</StatusBadge>}
      {u.adminAccess && <StatusBadge>Admin access</StatusBadge>}
      {!u.adminAccess && !u.adminPermanent && (
        <span className="text-caption text-ink-muted">None</span>
      )}
    </div>
  );

  const renderStatus = (u: User) =>
    u.accessConflict === 1 ? (
      <span className="flex flex-col items-start gap-1">
        <StatusBadge tone="warning" icon>
          Needs review
        </StatusBadge>
        <span className="text-caption text-ink-muted">
          Deactivated on this device, still active online.
        </span>
        {canManage && (
          <button
            type="button"
            onClick={() => keepDeactivated(u)}
            className="btn-ghost"
            aria-label={`Keep ${u.fullName} deactivated`}
          >
            Keep deactivated
          </button>
        )}
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

  const renderOfflineAccess = (u: User) =>
    hasDevicePin(u) ? (
      <StatusBadge tone="success">PIN on this device</StatusBadge>
    ) : (
      <StatusBadge tone="neutral">No PIN here</StatusBadge>
    );

  const oldRole = editingUser?.role;
  const gained = oldRole ? gainedAccess(oldRole, form.role) : [];
  const lost = oldRole ? lostAccess(oldRole, form.role) : [];

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
              {isEditing ? `Edit ${editingUser?.fullName}` : "Add staff member"}
            </h2>
          </div>
          <div className="panel-body space-y-4">
            {formError && (
              <div className="banner banner-danger" role="alert">
                {formError}
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-2">
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
                  required={!isEditing}
                  value={form.pin}
                  onChange={(e) =>
                    setForm({ ...form, pin: e.target.value.replace(/\D/g, "").slice(0, 6) })
                  }
                  className="input-field tabular-nums"
                  {...fieldProps("pin")}
                  aria-describedby={pinDescribedBy}
                />
                <p id="staff-pin-hint" className="field-hint">
                  {isEditing
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
                  required={!isEditing}
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
              {currentUser?.role === "admin" && (
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
              {saving ? "Saving…" : isEditing ? "Save changes" : "Add staff member"}
            </button>
          </div>
        </form>
      )}

      <section className="panel" aria-labelledby="staff-list-title">
        <div className="panel-header">
          <h2 id="staff-list-title" className="panel-title">
            Staff{users ? ` (${users.length})` : ""}
          </h2>
          {canManage && !showForm && (
            <button type="button" onClick={openCreate} className="btn-primary">
              <UserPlusIcon className="h-5 w-5" aria-hidden />
              Add staff member
            </button>
          )}
        </div>

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
        ) : users.length === 0 ? (
          !loadError && (
            <EmptyState
              icon={UsersIcon}
              title="No staff accounts on this device"
              description="Add the people who will sign in here, with a role and a 6-digit PIN."
            />
          )
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
                    <th scope="col">Status</th>
                    <th scope="col">Offline access</th>
                    <th scope="col">Added</th>
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-ink">{u.fullName}</span>
                          {u.id === currentUser?.id && <StatusBadge tone="info">You</StatusBadge>}
                        </span>
                        <span className="block text-caption text-ink-muted tabular-nums">
                          ID {u.id.slice(-8).toUpperCase()}
                        </span>
                      </td>
                      <td>
                        <StatusBadge>{getRoleDisplayName(u.role)}</StatusBadge>
                      </td>
                      <td>{renderAdminFlags(u)}</td>
                      <td className="text-caption text-ink-secondary">
                        {u.email && <span className="block">{u.email}</span>}
                        {u.phone && <span className="block tabular-nums">{u.phone}</span>}
                        {!u.email && !u.phone && <span className="text-ink-muted">None</span>}
                      </td>
                      <td>{renderStatus(u)}</td>
                      <td>{renderOfflineAccess(u)}</td>
                      <td className="text-caption text-ink-muted tabular-nums">
                        {formatNigerianDate(u.createdAt)}
                      </td>
                      <td className="text-right">{renderActions(u)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="divide-y divide-line md:hidden">
              {users.map((u) => (
                <li key={u.id} className="space-y-2 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink">{u.fullName}</span>
                    {u.id === currentUser?.id && <StatusBadge tone="info">You</StatusBadge>}
                    <StatusBadge>{getRoleDisplayName(u.role)}</StatusBadge>
                    {renderStatus(u)}
                    {renderOfflineAccess(u)}
                  </div>
                  {(u.adminAccess || u.adminPermanent) && renderAdminFlags(u)}
                  <p className="text-caption text-ink-muted">
                    {[u.email, u.phone].filter(Boolean).join(" · ") || "No contact details"}
                    {" · "}Added {formatNigerianDate(u.createdAt)}
                  </p>
                  {renderActions(u, true)}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

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
        title={`Deactivate ${pendingStatusUser?.fullName ?? "this account"}?`}
        confirmLabel="Deactivate account"
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
        <p>Records they created are kept.</p>
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
          the next time they sign in online here, or you can set one now with
          Edit.
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
        <p>
          The account is removed from this device and they lose access
          immediately. Records they created are kept.
        </p>
        <p>To stop someone signing in but keep the account, deactivate it instead.</p>
        <p className="font-medium text-danger-fg">This cannot be undone.</p>
      </ConfirmDialog>
    </div>
  );
}
