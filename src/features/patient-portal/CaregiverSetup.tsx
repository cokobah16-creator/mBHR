import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  CheckCircleIcon,
  InformationCircleIcon,
  UserGroupIcon,
  UserMinusIcon,
  UserPlusIcon,
} from "@heroicons/react/24/outline";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { addManagedPatient, type ManagedPatient } from "@/services/patientPortalAuth";
import * as logger from "@/lib/logger";
import { formatNigerianDate } from "@/utils/dateFormat";
import { ConfirmDialog } from "./account/ConfirmDialog";
import {
  addManagedPatientToSession,
  hasLocalPortalAccount,
  listManagedPatients,
  relationshipLabel,
  removeManagedPatientLink,
  RELATIONSHIP_OPTIONS,
  syncSessionManagedPatients,
} from "./account/caregiverAccess";
import { errorName, readPortalUser } from "./account/portalSession";

const schema = z.object({
  givenName: z.string().min(1, "First name is required"),
  familyName: z.string().min(1, "Last name is required"),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Please enter a valid date"),
  relationship: z.enum(["child", "parent", "spouse", "sibling", "other"], {
    errorMap: () => ({ message: "Please select a relationship" }),
  }),
});

type SetupForm = z.infer<typeof schema>;

/** Today's date on this device (local time), as YYYY-MM-DD. */
function todayIso(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function CaregiverSetup() {
  const navigate = useNavigate();
  const [portalUser] = useState(() => readPortalUser());
  const portalUserId = portalUser?.id;
  const canAdd = hasLocalPortalAccount(portalUserId);

  const [managed, setManaged] = useState<ManagedPatient[]>(() =>
    listManagedPatients(portalUserId),
  );
  const [pending, setPending] = useState<SetupForm | null>(null);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [toRemove, setToRemove] = useState<ManagedPatient | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const form = useForm<SetupForm>({
    resolver: zodResolver(schema),
    defaultValues: { givenName: "", familyName: "", dob: "", relationship: "child" },
  });
  const { errors } = form.formState;

  useEffect(() => {
    if (!portalUserId) navigate("/patient/login", { replace: true });
  }, [portalUserId, navigate]);

  // Logging in does not yet carry these profiles into the session, so put
  // them back here; otherwise the profile switcher cannot reach them.
  useEffect(() => {
    if (portalUserId) syncSessionManagedPatients(portalUserId);
  }, [portalUserId]);

  const review = (data: SetupForm) => {
    setAddError(null);
    setNotice(null);
    setPending(data);
  };

  const confirmAdd = async () => {
    if (!pending) return;
    if (!portalUserId) {
      navigate("/patient/login");
      return;
    }
    setAdding(true);
    setAddError(null);

    try {
      const result = await addManagedPatient(portalUserId, {
        givenName: pending.givenName,
        familyName: pending.familyName,
        dob: pending.dob,
        relationship: pending.relationship,
      });

      if (result.success && result.patientId) {
        addManagedPatientToSession({
          patientId: result.patientId,
          givenName: pending.givenName,
          familyName: pending.familyName,
          relationship: pending.relationship,
        });
        setManaged(listManagedPatients(portalUserId));
        setNotice(
          `${pending.givenName} ${pending.familyName} has been added to your account on this device. Choose your name at the top of the portal to switch to their profile.`,
        );
        setPending(null);
        form.reset();
      } else {
        setAddError(result.error || "Could not add this person. Please try again.");
      }
    } catch (err) {
      logger.error("[CaregiverSetup] add failed:", errorName(err));
      setAddError("Could not add this person. Nothing was saved. Please try again.");
    } finally {
      setAdding(false);
    }
  };

  const confirmRemove = () => {
    if (!toRemove || !portalUserId) return;
    const ok = removeManagedPatientLink(portalUserId, toRemove.patientId);
    if (!ok) {
      setRemoveError(
        "Could not remove this profile. This device's storage may be full or blocked. Nothing was changed.",
      );
      return;
    }
    setManaged(listManagedPatients(portalUserId));
    setNotice(
      `${toRemove.givenName} ${toRemove.familyName} has been removed from your account on this device.`,
    );
    setToRemove(null);
    setRemoveError(null);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
      <PageHeader
        title="People you care for"
        description="Keep a profile for your child, parent or someone else you look after, alongside your own."
        breadcrumbs={[
          { label: "Home", to: "/patient/dashboard" },
          { label: "People you care for" },
        ]}
      />

      <section className="panel" aria-labelledby="caregiver-explainer-title">
        <div className="panel-header">
          <h2 id="caregiver-explainer-title" className="panel-title">
            What adding someone means
          </h2>
        </div>
        <dl className="panel-body grid gap-4 text-body sm:grid-cols-2">
          <div>
            <dt className="font-medium text-ink">What it does</dt>
            <dd className="mt-1 text-ink-secondary">
              Creates a separate profile for the person on this device, linked
              to your portal account. You switch to it from your name at the
              top of the portal.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-ink">Who can see it</dt>
            <dd className="mt-1 text-ink-secondary">
              Anyone who logs in to your portal account on this device, and
              clinic staff who use this device. Keep your PIN or password to
              yourself.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-ink">What it does not do</dt>
            <dd className="mt-1 text-ink-secondary">
              It does not open records the clinic already holds for the person.
              To link their clinic record, ask clinic staff at your next visit.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-ink">How long, and how to stop</dt>
            <dd className="mt-1 text-ink-secondary">
              The profile stays on your account until you remove it below.
              Removing it takes it off your account straight away.
            </dd>
          </div>
        </dl>
      </section>

      <div aria-live="polite">
        {notice && (
          <div className="banner banner-success">
            <CheckCircleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            <div className="space-y-2">
              <p>{notice}</p>
              <Link
                to="/patient/dashboard"
                className="inline-flex min-h-touch-target items-center font-medium underline underline-offset-2"
              >
                Go to my dashboard
              </Link>
            </div>
          </div>
        )}
      </div>

      <section className="panel" aria-labelledby="caregiver-current-title">
        <div className="panel-header">
          <h2 id="caregiver-current-title" className="panel-title">
            Profiles on your account
          </h2>
          <span className="text-caption text-ink-muted tabular-nums">
            {managed.length} {managed.length === 1 ? "person" : "people"}
          </span>
        </div>
        {managed.length === 0 ? (
          <EmptyState
            icon={UserGroupIcon}
            title="You are not looking after anyone's profile"
            description="People you add below will be listed here, with the option to remove them."
          />
        ) : (
          <ul className="divide-y divide-line">
            {managed.map((mp) => (
              <li
                key={mp.patientId}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-body font-medium text-ink">
                    {mp.givenName} {mp.familyName}
                  </p>
                  <p className="text-caption text-ink-muted">
                    {relationshipLabel(mp.relationship)} · you can see and update
                    this profile
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setRemoveError(null);
                    setToRemove(mp);
                  }}
                  className="btn-secondary"
                  aria-label={`Remove ${mp.givenName} ${mp.familyName} from your account`}
                >
                  <UserMinusIcon className="h-5 w-5" aria-hidden />
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel" aria-labelledby="caregiver-add-title">
        <div className="panel-header">
          <h2 id="caregiver-add-title" className="panel-title">
            Add someone you care for
          </h2>
        </div>
        <div className="panel-body">
          {!canAdd ? (
            <div className="banner banner-info">
              <InformationCircleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
              <p>
                Adding people you care for is only available for portal accounts
                created on this device. Ask clinic staff to help link a family
                member&apos;s record to your account.
              </p>
            </div>
          ) : (
            <form
              onSubmit={form.handleSubmit(review)}
              className="space-y-4"
              noValidate
            >
              <p className="text-caption text-ink-muted">All fields are required.</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="cg-given" className="field-label">
                    First name
                  </label>
                  <input
                    {...form.register("givenName")}
                    id="cg-given"
                    type="text"
                    autoComplete="off"
                    className="input-field"
                    aria-invalid={errors.givenName ? true : undefined}
                    aria-describedby={errors.givenName ? "cg-given-error" : undefined}
                    disabled={adding}
                  />
                  {errors.givenName && (
                    <p id="cg-given-error" className="field-error" role="alert">
                      {errors.givenName.message}
                    </p>
                  )}
                </div>
                <div>
                  <label htmlFor="cg-family" className="field-label">
                    Last name
                  </label>
                  <input
                    {...form.register("familyName")}
                    id="cg-family"
                    type="text"
                    autoComplete="off"
                    className="input-field"
                    aria-invalid={errors.familyName ? true : undefined}
                    aria-describedby={errors.familyName ? "cg-family-error" : undefined}
                    disabled={adding}
                  />
                  {errors.familyName && (
                    <p id="cg-family-error" className="field-error" role="alert">
                      {errors.familyName.message}
                    </p>
                  )}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="cg-dob" className="field-label">
                    Date of birth
                  </label>
                  <input
                    {...form.register("dob")}
                    id="cg-dob"
                    type="date"
                    max={todayIso()}
                    className="input-field"
                    aria-invalid={errors.dob ? true : undefined}
                    aria-describedby={errors.dob ? "cg-dob-error" : undefined}
                    disabled={adding}
                  />
                  {errors.dob && (
                    <p id="cg-dob-error" className="field-error" role="alert">
                      {errors.dob.message}
                    </p>
                  )}
                </div>
                <div>
                  <label htmlFor="cg-relationship" className="field-label">
                    They are
                  </label>
                  <select
                    {...form.register("relationship")}
                    id="cg-relationship"
                    className="input-field"
                    aria-invalid={errors.relationship ? true : undefined}
                    aria-describedby={
                      errors.relationship ? "cg-relationship-error" : undefined
                    }
                    disabled={adding}
                  >
                    {RELATIONSHIP_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  {errors.relationship && (
                    <p id="cg-relationship-error" className="field-error" role="alert">
                      {errors.relationship.message}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
                <Link to="/patient/dashboard" className="btn-secondary">
                  Cancel
                </Link>
                <button type="submit" disabled={adding} className="btn-primary">
                  <UserPlusIcon className="h-5 w-5" aria-hidden />
                  Review and add
                </button>
              </div>
            </form>
          )}
        </div>
      </section>

      <ConfirmDialog
        open={!!pending}
        title={
          pending
            ? `Add ${pending.givenName} ${pending.familyName} to your account?`
            : ""
        }
        confirmLabel="Add to my account"
        cancelLabel="Go back"
        busyLabel="Adding…"
        busy={adding}
        error={addError}
        onConfirm={() => void confirmAdd()}
        onCancel={() => setPending(null)}
      >
        {pending && (
          <>
            <p>
              {relationshipLabel(pending.relationship)}, born{" "}
              {formatNigerianDate(pending.dob)}.
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>A new profile for {pending.givenName} is created on this device.</li>
              <li>
                Anyone who logs in to your account can see and update{" "}
                {pending.givenName}&apos;s profile. Clinic staff who use this
                device can also see it.
              </li>
              <li>
                It does not open records the clinic already holds for{" "}
                {pending.givenName}.
              </li>
              <li>You can remove the profile from your account at any time on this page.</li>
            </ul>
          </>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={!!toRemove}
        destructive
        title={
          toRemove
            ? `Remove ${toRemove.givenName} ${toRemove.familyName} from your account?`
            : ""
        }
        confirmLabel="Remove from my account"
        cancelLabel="Keep profile"
        error={removeError}
        onConfirm={confirmRemove}
        onCancel={() => setToRemove(null)}
      >
        {toRemove && (
          <ul className="list-disc space-y-1 pl-5">
            <li>
              You will no longer be able to see or switch to {toRemove.givenName}
              &apos;s profile in your portal.
            </li>
            <li>
              If you are viewing their profile now, the portal switches back to
              yours.
            </li>
            <li>
              {toRemove.givenName}&apos;s details stay saved on this device.
              Adding them again later creates a new, separate profile.
            </li>
          </ul>
        )}
      </ConfirmDialog>
    </div>
  );
}
