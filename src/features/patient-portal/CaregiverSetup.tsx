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
  removeManagedPatientLink,
  RELATIONSHIP_OPTIONS,
  syncSessionManagedPatients,
} from "./account/caregiverAccess";
import { errorName, readPortalUser } from "./account/portalSession";
import { useT } from "@/hooks/useT";

const schema = z.object({
  givenName: z.string().min(1, "portal.cg.err.givenName"),
  familyName: z.string().min(1, "portal.cg.err.familyName"),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "portal.cg.err.dob"),
  relationship: z.enum(["child", "parent", "spouse", "sibling", "other"], {
    errorMap: () => ({ message: "portal.cg.err.relationship" }),
  }),
});

type SetupForm = z.infer<typeof schema>;

// A message shown on the page, kept as a key so it follows the language.
interface Message {
  key: string;
  vars?: Record<string, string>;
  // Text from the account service, shown as it comes.
  raw?: string;
}

/** Today's date on this device (local time), as YYYY-MM-DD. */
function todayIso(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function CaregiverSetup() {
  const navigate = useNavigate();
  const { t } = useT();
  const say = (m: Message | null) => (m ? m.raw ?? t(m.key, m.vars) : null);
  const relLabel = (value: string) =>
    RELATIONSHIP_OPTIONS.some((o) => o.value === value)
      ? t(`portal.cg.rel.${value}`)
      : t("portal.cg.rel.unknown");
  const [portalUser] = useState(() => readPortalUser());
  const portalUserId = portalUser?.id;
  const canAdd = hasLocalPortalAccount(portalUserId);

  const [managed, setManaged] = useState<ManagedPatient[]>(() =>
    listManagedPatients(portalUserId),
  );
  const [pending, setPending] = useState<SetupForm | null>(null);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<Message | null>(null);
  const [toRemove, setToRemove] = useState<ManagedPatient | null>(null);
  const [removeError, setRemoveError] = useState<Message | null>(null);
  const [notice, setNotice] = useState<Message | null>(null);

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
        setNotice({
          key: "portal.cg.added",
          vars: { name: `${pending.givenName} ${pending.familyName}` },
        });
        setPending(null);
        form.reset();
      } else {
        setAddError(
          result.error
            ? { key: "", raw: result.error }
            : { key: "portal.cg.addFailed" },
        );
      }
    } catch (err) {
      logger.error("[CaregiverSetup] add failed:", errorName(err));
      setAddError({ key: "portal.cg.addFailedNothingSaved" });
    } finally {
      setAdding(false);
    }
  };

  const confirmRemove = () => {
    if (!toRemove || !portalUserId) return;
    const ok = removeManagedPatientLink(portalUserId, toRemove.patientId);
    if (!ok) {
      setRemoveError({ key: "portal.cg.removeFailed" });
      return;
    }
    setManaged(listManagedPatients(portalUserId));
    setNotice({
      key: "portal.cg.removed",
      vars: { name: `${toRemove.givenName} ${toRemove.familyName}` },
    });
    setToRemove(null);
    setRemoveError(null);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
      <PageHeader
        title={t("portal.cg.title")}
        description={t("portal.cg.description")}
        breadcrumbs={[
          { label: t("portal.cg.home"), to: "/patient/dashboard" },
          { label: t("portal.cg.title") },
        ]}
      />

      <section className="panel" aria-labelledby="caregiver-explainer-title">
        <div className="panel-header">
          <h2 id="caregiver-explainer-title" className="panel-title">
            {t("portal.cg.explainTitle")}
          </h2>
        </div>
        <dl className="panel-body grid gap-4 text-body sm:grid-cols-2">
          <div>
            <dt className="font-medium text-ink">{t("portal.cg.whatTitle")}</dt>
            <dd className="mt-1 text-ink-secondary">
              {t("portal.cg.whatBody")}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-ink">{t("portal.cg.whoTitle")}</dt>
            <dd className="mt-1 text-ink-secondary">
              {t("portal.cg.whoBody")}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-ink">{t("portal.cg.notTitle")}</dt>
            <dd className="mt-1 text-ink-secondary">
              {t("portal.cg.notBody")}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-ink">{t("portal.cg.stopTitle")}</dt>
            <dd className="mt-1 text-ink-secondary">
              {t("portal.cg.stopBody")}
            </dd>
          </div>
        </dl>
      </section>

      <div aria-live="polite">
        {notice && (
          <div className="banner banner-success">
            <CheckCircleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            <div className="space-y-2">
              <p>{say(notice)}</p>
              <Link
                to="/patient/dashboard"
                className="inline-flex min-h-touch-target items-center font-medium underline underline-offset-2"
              >
                {t("portal.cg.goDashboard")}
              </Link>
            </div>
          </div>
        )}
      </div>

      <section className="panel" aria-labelledby="caregiver-current-title">
        <div className="panel-header">
          <h2 id="caregiver-current-title" className="panel-title">
            {t("portal.cg.listTitle")}
          </h2>
          <span className="text-caption text-ink-muted tabular-nums">
            {managed.length === 1
              ? t("portal.cg.countOne")
              : t("portal.cg.countMany", { n: String(managed.length) })}
          </span>
        </div>
        {managed.length === 0 ? (
          <EmptyState
            icon={UserGroupIcon}
            title={t("portal.cg.emptyTitle")}
            description={t("portal.cg.emptyBody")}
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
                    {relLabel(mp.relationship)} · {t("portal.cg.canUpdate")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setRemoveError(null);
                    setToRemove(mp);
                  }}
                  className="btn-secondary"
                  aria-label={t("portal.cg.removeLabel", {
                    name: `${mp.givenName} ${mp.familyName}`,
                  })}
                >
                  <UserMinusIcon className="h-5 w-5" aria-hidden />
                  {t("portal.cg.remove")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel" aria-labelledby="caregiver-add-title">
        <div className="panel-header">
          <h2 id="caregiver-add-title" className="panel-title">
            {t("portal.cg.addTitle")}
          </h2>
        </div>
        <div className="panel-body">
          {!canAdd ? (
            <div className="banner banner-info">
              <InformationCircleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
              <p>{t("portal.cg.addUnavailable")}</p>
            </div>
          ) : (
            <form
              onSubmit={form.handleSubmit(review)}
              className="space-y-4"
              noValidate
            >
              <p className="text-caption text-ink-muted">{t("portal.cg.allRequired")}</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="cg-given" className="field-label">
                    {t("portal.cg.field.givenName")}
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
                      {t(String(errors.givenName.message))}
                    </p>
                  )}
                </div>
                <div>
                  <label htmlFor="cg-family" className="field-label">
                    {t("portal.cg.field.familyName")}
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
                      {t(String(errors.familyName.message))}
                    </p>
                  )}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="cg-dob" className="field-label">
                    {t("portal.cg.field.dob")}
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
                      {t(String(errors.dob.message))}
                    </p>
                  )}
                </div>
                <div>
                  <label htmlFor="cg-relationship" className="field-label">
                    {t("portal.cg.field.relationship")}
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
                        {t(`portal.cg.rel.${o.value}`)}
                      </option>
                    ))}
                  </select>
                  {errors.relationship && (
                    <p id="cg-relationship-error" className="field-error" role="alert">
                      {t(String(errors.relationship.message))}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
                <Link to="/patient/dashboard" className="btn-secondary">
                  {t("portal.cg.cancel")}
                </Link>
                <button type="submit" disabled={adding} className="btn-primary">
                  <UserPlusIcon className="h-5 w-5" aria-hidden />
                  {t("portal.cg.review")}
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
            ? t("portal.cg.addConfirmTitle", {
                name: `${pending.givenName} ${pending.familyName}`,
              })
            : ""
        }
        confirmLabel={t("portal.cg.addConfirm")}
        cancelLabel={t("portal.cg.goBack")}
        busyLabel={t("portal.cg.adding")}
        busy={adding}
        error={say(addError)}
        onConfirm={() => void confirmAdd()}
        onCancel={() => setPending(null)}
      >
        {pending && (
          <>
            <p>
              {t("portal.cg.bornOn", {
                relationship: relLabel(pending.relationship),
                date: formatNigerianDate(pending.dob),
              })}
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>{t("portal.cg.addPoint1", { name: pending.givenName })}</li>
              <li>{t("portal.cg.addPoint2", { name: pending.givenName })}</li>
              <li>{t("portal.cg.addPoint3", { name: pending.givenName })}</li>
              <li>{t("portal.cg.addPoint4")}</li>
            </ul>
          </>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={!!toRemove}
        destructive
        title={
          toRemove
            ? t("portal.cg.removeConfirmTitle", {
                name: `${toRemove.givenName} ${toRemove.familyName}`,
              })
            : ""
        }
        confirmLabel={t("portal.cg.removeConfirm")}
        cancelLabel={t("portal.cg.keep")}
        error={say(removeError)}
        onConfirm={confirmRemove}
        onCancel={() => setToRemove(null)}
      >
        {toRemove && (
          <ul className="list-disc space-y-1 pl-5">
            <li>{t("portal.cg.removePoint1", { name: toRemove.givenName })}</li>
            <li>{t("portal.cg.removePoint2")}</li>
            <li>{t("portal.cg.removePoint3", { name: toRemove.givenName })}</li>
          </ul>
        )}
      </ConfirmDialog>
    </div>
  );
}
