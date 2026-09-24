import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowPathIcon,
  BeakerIcon,
  CloudIcon,
  ExclamationTriangleIcon,
  MagnifyingGlassIcon,
  SignalSlashIcon,
} from "@heroicons/react/24/outline";
import { db, generateId, createAuditLog, type Patient, type User } from "@/db";
import { isSupabaseEnabled } from "@/lib/supabaseClient";
import { can, type Permission } from "@/auth/roles";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/stores/toast";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { Tabs } from "@/components/ui/Tabs";
import { tabId, panelId } from "@/components/ui/tabIds";
import { formatNigerianDateTime } from "@/utils/dateFormat";
import {
  addLabResult,
  getLabSessionUser,
  getLabWorklist,
  resolveLabActorId,
  reviewLabResult,
  sessionMatchesUser,
  updateLabOrderStatus,
  LabServiceError,
  LAB_WORKLIST_CLOSED_LIMIT,
  type LabOrderWithResults,
  type LabResult,
  type LabSessionUser,
} from "@/services/labs";
import {
  compareWorklist,
  countByFilter,
  deriveLabStage,
  describeLabError,
  formatResultValue,
  isInterpretation,
  isLabFilter,
  matchesFilter,
  matchesSearch,
  worstInterpretation,
  worstUnreviewed,
  INTERPRETATION_META,
  LAB_FILTERS,
  PRIORITY_LABEL,
  STAGE_META,
  type LabFilter,
  type WorklistSortable,
} from "./labWorklist";
import {
  LabResultEntryDialog,
  type LabResultFormValues,
} from "./LabResultEntryDialog";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";

interface LabResultsDashboardProps {
  /**
   * Staff id to record as the reviewer. The /labs route passes "", in which
   * case the signed-in user is used.
   */
  userId?: string;
}

interface WorklistRow extends WorklistSortable {
  order: LabOrderWithResults;
  /** Local patient record, when this device has it (enables the link). */
  patient?: Patient;
  patientLabel: string;
  orderedByName: string;
}

type LoadState = "idle" | "loading" | "ready" | "error";

const STAFF_NOT_LOCAL = "staff not on this device";
const PATIENT_NOT_LOCAL = "Patient not on this device";

const FK_REVIEW_HINT =
  "Your staff account is not in the online staff directory, so the review could not be credited to you. Sign in with your email and password, or ask an admin to add your account.";

const blankToUndefined = (value?: string) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const timeOfDay = (d: Date) =>
  d.toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" });

const shortId = (id: string) => (id.length > 8 ? `…${id.slice(-6)}` : id);

function staffName(staff: Map<string, User>, id?: string | null): string {
  if (!id) return STAFF_NOT_LOCAL;
  return staff.get(id)?.fullName ?? STAFF_NOT_LOCAL;
}

/** Names for ids in the lab data, from this device's own records only. */
async function lookupLocalRecords(orders: LabOrderWithResults[]) {
  const patientIds = [...new Set(orders.map((o) => o.patientId).filter(Boolean))];
  const staffIds = [
    ...new Set(
      orders
        .flatMap((o) => [o.orderedBy, ...o.results.map((r) => r.reviewedBy)])
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];
  try {
    const [patients, users]: [(Patient | undefined)[], (User | undefined)[]] =
      await Promise.all([
        db.patients.bulkGet(patientIds),
        db.users.bulkGet(staffIds),
      ]);
    const patientMap = new Map<string, Patient>();
    for (const p of patients) if (p) patientMap.set(p.id, p);
    const staffMap = new Map<string, User>();
    for (const u of users) if (u) staffMap.set(u.id, u);
    return { patients: patientMap, staff: staffMap };
  } catch (error) {
    console.error(
      "[labs] Could not read local patient and staff records:",
      error instanceof Error ? error.name : error,
    );
    return { patients: new Map<string, Patient>(), staff: new Map<string, User>() };
  }
}

/**
 * Clinician and lab work queue for lab orders: ordered → collected →
 * processing → result recorded → reviewed. Lab data lives only in the
 * cloud, so the page says plainly when it cannot be reached.
 */
export function LabResultsDashboard({ userId }: LabResultsDashboardProps) {
  const currentUser = useAuthStore((s) => s.currentUser);
  const { push } = useToast();
  const online = useOnlineStatus();
  const available = isSupabaseEnabled && online;

  const [orders, setOrders] = useState<LabOrderWithResults[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>(() =>
    isSupabaseEnabled && navigator.onLine ? "loading" : "idle",
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  // undefined until the first load; null when there is no Supabase sign-in.
  const [sessionUser, setSessionUser] = useState<LabSessionUser | null | undefined>(
    undefined,
  );
  const signedInOnline = sessionUser === undefined ? null : sessionUser !== null;
  const [patients, setPatients] = useState<Map<string, Patient>>(() => new Map());
  const [localStaff, setLocalStaff] = useState<Map<string, User>>(() => new Map());

  // Orders and reviews by the signed-in person can carry their Supabase
  // account id rather than this device's id for them; name them too.
  const staff = useMemo(() => {
    if (!sessionUser || !currentUser || localStaff.has(sessionUser.id)) return localStaff;
    if (!sessionMatchesUser(sessionUser, currentUser)) return localStaff;
    const withSelf = new Map(localStaff);
    withSelf.set(sessionUser.id, currentUser);
    return withSelf;
  }, [localStaff, sessionUser, currentUser]);

  const [filter, setFilter] = useState<LabFilter>("open");
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [entryOrder, setEntryOrder] = useState<WorklistRow | null>(null);
  const [entrySaving, setEntrySaving] = useState(false);
  const [entryError, setEntryError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const role = currentUser?.role;
  // Specimen and result recording follow the "vitals" permission (clinical
  // measurements). Marking a result reviewed needs "lab_review", which is
  // granted by DIOF clinical policy (see src/auth/roles.ts) and enforced
  // again by the database.
  const canRecord = !!role && can(role, "vitals");
  const canReview = !!role && can(role, "lab_review");

  const load = useCallback(async () => {
    if (!isSupabaseEnabled) return;
    const request = ++requestRef.current;
    setLoadState("loading");
    setLoadError(null);
    try {
      const [worklist, session] = await Promise.all([
        getLabWorklist(),
        getLabSessionUser(),
      ]);
      const local = await lookupLocalRecords(worklist.orders);
      if (request !== requestRef.current) return;
      setOrders(worklist.orders);
      setTruncated(worklist.truncated);
      setSessionUser(session);
      setPatients(local.patients);
      setLocalStaff(local.staff);
      setLoadedAt(new Date());
      setLoadState("ready");
    } catch (error) {
      if (request !== requestRef.current) return;
      console.error(
        "[labs] Could not load the lab work queue:",
        error instanceof Error ? error.name : error,
      );
      setLoadError(describeLabError(error, "Lab orders could not be loaded."));
      setLoadState("error");
    }
  }, []);

  // Load on arrival and again whenever the connection comes back.
  useEffect(() => {
    if (available) void load();
  }, [available, load]);

  const rows = useMemo<WorklistRow[]>(
    () =>
      (orders ?? []).map((order) => {
        const stage = deriveLabStage(order, order.results);
        const patient = patients.get(order.patientId);
        return {
          order,
          stage,
          severity:
            stage === "awaiting_review"
              ? worstUnreviewed(order.results)
              : worstInterpretation(order.results),
          priority: order.priority,
          orderedAt: order.orderedAt,
          resultAt: order.results[0]?.resultDate,
          patient,
          patientLabel: patient
            ? `${patient.givenName} ${patient.familyName}`
            : PATIENT_NOT_LOCAL,
          orderedByName: staffName(staff, order.orderedBy),
        };
      }),
    [orders, patients, staff],
  );

  const counts = useMemo(() => countByFilter(rows.map((r) => r.stage)), [rows]);

  const visible = useMemo(
    () =>
      rows
        .filter((r) => matchesFilter(r.stage, filter))
        .filter((r) =>
          matchesSearch(
            [
              r.patient ? r.patientLabel : null,
              r.order.patientId,
              r.order.testName,
              r.order.testCode,
              r.orderedByName === STAFF_NOT_LOCAL ? null : r.orderedByName,
            ],
            search,
          ),
        )
        .sort(compareWorklist),
    [rows, filter, search],
  );

  const waitingCritical = rows.filter(
    (r) => r.stage === "awaiting_review" && r.severity === "critical",
  ).length;
  const waitingAbnormal = rows.filter(
    (r) => r.stage === "awaiting_review" && r.severity === "abnormal",
  ).length;

  // ---- Actions: permission and connection are checked before every write.

  const writeBlockedReason = (permission: Permission, denied: string): string | null => {
    if (!currentUser || !can(currentUser.role, permission)) return denied;
    if (!isSupabaseEnabled || !navigator.onLine) {
      return "Nothing was changed. Lab orders are kept in the cloud and this device is offline. Try again when the connection returns.";
    }
    return null;
  };

  const allowWrite = (permission: Permission, denied: string): boolean => {
    const reason = writeBlockedReason(permission, denied);
    if (reason) {
      push({ id: generateId(), tone: "warning", title: "Not saved", body: reason });
      return false;
    }
    return true;
  };

  const audit = async (action: string, entity: string, entityId: string) => {
    try {
      await createAuditLog(currentUser?.role ?? "unknown", action, entity, entityId);
    } catch (error) {
      console.error(
        "[labs] Audit entry not written:",
        error instanceof Error ? error.name : error,
      );
    }
  };

  const advance = async (row: WorklistRow, next: "collected" | "processing") => {
    if (!allowWrite("vitals", "Your role cannot update lab orders.")) return;
    const { order } = row;
    setBusyId(order.id);
    try {
      await updateLabOrderStatus(order.id, next);
      await audit(
        next === "collected" ? "lab_specimen_collected" : "lab_processing_started",
        "lab_order",
        order.id,
      );
      push({
        id: generateId(),
        tone: "success",
        title: next === "collected" ? "Specimen marked as collected" : "Marked as processing",
        body: order.testName,
      });
    } catch (error) {
      console.error(
        "[labs] Status update failed:",
        error instanceof Error ? error.name : error,
      );
      push({
        id: generateId(),
        tone: "error",
        title: "Status not changed",
        body: describeLabError(error, `${order.testName}: the change was not confirmed.`),
      });
    } finally {
      // Stay busy until the list is reloaded, so the stale button cannot
      // be pressed again for a step that has already been recorded.
      await load();
      setBusyId(null);
    }
  };

  const review = async (row: WorklistRow) => {
    if (
      !allowWrite(
        "lab_review",
        "Your role cannot mark lab results reviewed. Ask a staff member authorised to review lab results.",
      )
    )
      return;
    if (!currentUser) return;
    const { order } = row;
    const pending = order.results.filter(
      (r): r is LabResult & { id: string } => !r.reviewedAt && !!r.id,
    );
    if (pending.length === 0) return;
    setBusyId(order.id);
    let done = 0;
    try {
      const reviewerId =
        userId && userId !== currentUser.id
          ? userId
          : await resolveLabActorId(currentUser);
      for (const result of pending) {
        await reviewLabResult(result.id, reviewerId);
        done += 1;
        await audit("lab_result_reviewed", "lab_result", result.id);
      }
      push({
        id: generateId(),
        tone: "success",
        title:
          pending.length === 1
            ? "Result marked as reviewed"
            : `${pending.length} results marked as reviewed`,
        body: order.testName,
      });
    } catch (error) {
      console.error(
        "[labs] Review failed:",
        error instanceof Error ? error.name : error,
      );
      push({
        id: generateId(),
        tone: "error",
        title: done > 0 ? "Review only partly saved" : "Review not saved",
        body: describeLabError(
          error,
          done > 0
            ? `${done} of ${pending.length} results for ${order.testName} were marked as reviewed; the rest were not confirmed.`
            : `The review of ${order.testName} was not confirmed.`,
          FK_REVIEW_HINT,
        ),
      });
    } finally {
      await load();
      setBusyId(null);
    }
  };

  const openEntry = (row: WorklistRow) => {
    if (!allowWrite("vitals", "Your role cannot record lab results.")) return;
    setEntryError(null);
    setEntryOrder(row);
  };

  const closeEntry = useCallback(() => {
    setEntryOrder(null);
    setEntryError(null);
  }, []);

  const saveResult = async (values: LabResultFormValues) => {
    const row = entryOrder;
    if (!row) return;
    // Shown inside the dialog so the values typed so far are kept.
    const blocked = writeBlockedReason("vitals", "Your role cannot record lab results.");
    if (blocked) {
      setEntryError(blocked);
      return;
    }
    // The interpretation must be a deliberate choice. An empty or unknown
    // value is never sent: the server would file it as "normal".
    if (!isInterpretation(values.interpretation)) {
      setEntryError(
        "Nothing was saved. Choose Normal, Abnormal or Critical for this result.",
      );
      return;
    }
    const { order } = row;
    setEntrySaving(true);
    setBusyId(order.id);
    setEntryError(null);
    try {
      await addLabResult({
        orderId: order.id,
        resultValue: values.resultValue.trim(),
        resultUnit: blankToUndefined(values.resultUnit),
        referenceRange: blankToUndefined(values.referenceRange),
        interpretation: values.interpretation,
        resultDate: new Date(),
        notes: blankToUndefined(values.notes),
      });
      await audit("lab_result_added", "lab_order", order.id);
      push({
        id: generateId(),
        tone: "success",
        title: "Result saved",
        body: `${order.testName}: ${INTERPRETATION_META[values.interpretation].label}. Waiting for clinician review.`,
      });
      setEntryOrder(null);
    } catch (error) {
      if (
        error instanceof LabServiceError &&
        error.operation === "updateLabOrderStatus"
      ) {
        // addLabResult stores the result first; only the status change that
        // follows it failed. The result exists, so say so and close the form
        // rather than inviting a second, duplicate entry.
        console.error("[labs] Result saved, status not updated:", error.code ?? error.name);
        await audit("lab_result_added", "lab_order", order.id);
        push({
          id: generateId(),
          tone: "warning",
          title: "Result saved, order status not updated",
          body: `${order.testName}: the result is stored and waiting for clinician review, but the order could not be marked completed. It is listed under Awaiting review.`,
        });
        setEntryOrder(null);
        return;
      }
      console.error(
        "[labs] Result not saved:",
        error instanceof Error ? error.name : error,
      );
      setEntryError(
        describeLabError(
          error,
          "The result was not confirmed as saved. Check the list behind this form before entering it again, so it is not recorded twice.",
        ),
      );
    } finally {
      setEntrySaving(false);
      // The row keeps its "Enter result" button until the reload shows the
      // new result; hold it disabled so the result is not entered twice.
      await load();
      setBusyId(null);
    }
  };

  // ---- Render

  const header = (
    <PageHeader
      title="Lab orders"
      description="Lab orders and results for every patient. Results waiting for review come first, with critical and abnormal results at the top."
      actions={
        isSupabaseEnabled ? (
          <>
            {loadedAt && (
              <span className="text-caption text-ink-muted">
                Updated {timeOfDay(loadedAt)}
              </span>
            )}
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void load()}
              disabled={!available || loadState === "loading"}
            >
              <ArrowPathIcon className="h-5 w-5" aria-hidden />
              {loadState === "loading" && orders ? "Refreshing…" : "Refresh"}
            </button>
          </>
        ) : undefined
      }
    />
  );

  if (!isSupabaseEnabled) {
    return (
      <div className="space-y-4">
        {header}
        <div className="panel">
          <EmptyState
            icon={CloudIcon}
            title="Lab orders are not available on this device"
            description="Lab orders and results are kept in the cloud, and cloud sync is not set up on this device. Record tests and results in the consultation notes instead."
          />
        </div>
      </div>
    );
  }

  if (orders === null) {
    return (
      <div className="space-y-4">
        {header}
        {!online ? (
          <div className="panel">
            <EmptyState
              icon={SignalSlashIcon}
              title="Lab orders need a connection"
              description="This device is offline. Lab orders and results are kept in the cloud, not on this device. The list loads when the connection returns."
            />
          </div>
        ) : loadState === "error" ? (
          <div className="banner banner-danger" role="alert">
            <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
            <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span>{loadError}</span>
              <button type="button" className="btn-secondary" onClick={() => void load()}>
                Try again
              </button>
            </div>
          </div>
        ) : (
          <WorklistSkeleton />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {header}

      {!online && (
        <div className="banner banner-warning" role="status">
          <SignalSlashIcon className="h-5 w-5 shrink-0" aria-hidden />
          <span>
            This device is offline. Showing lab orders as they were at{" "}
            {loadedAt ? timeOfDay(loadedAt) : "the last refresh"}. Changes are
            paused until the connection returns.
          </span>
        </div>
      )}

      {online && loadState === "error" && (
        <div className="banner banner-danger" role="alert">
          <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
          <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>
              {loadError}{" "}
              {loadedAt && `Showing the list from ${timeOfDay(loadedAt)}.`}
            </span>
            <button type="button" className="btn-secondary" onClick={() => void load()}>
              Try again
            </button>
          </div>
        </div>
      )}

      {signedInOnline === false && (
        <div className="banner banner-warning" role="status">
          <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
          <span>
            You are not signed in with an online account. The cloud only shows
            lab orders to staff signed in with their email and password, so
            this list may be empty or incomplete.
          </span>
        </div>
      )}

      {(waitingCritical > 0 || waitingAbnormal > 0) && (
        <div className="banner banner-danger">
          <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
          <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>
              {[
                waitingCritical > 0 &&
                  `${waitingCritical} critical result${waitingCritical === 1 ? "" : "s"}`,
                waitingAbnormal > 0 &&
                  `${waitingAbnormal} abnormal result${waitingAbnormal === 1 ? "" : "s"}`,
              ]
                .filter(Boolean)
                .join(" and ")}{" "}
              waiting for review. They are listed first.
            </span>
            {filter !== "review" && filter !== "open" && filter !== "all" && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setFilter("review")}
              >
                Show results awaiting review
              </button>
            )}
          </div>
        </div>
      )}

      <section className="panel" aria-label="Lab work queue">
        <Tabs
          idPrefix="labs"
          label="Filter lab orders by status"
          active={filter}
          onChange={(id) => {
            if (isLabFilter(id)) setFilter(id);
          }}
          className="px-2"
          tabs={LAB_FILTERS.map((f) => ({
            id: f.id,
            label: f.label,
            badge: counts[f.id],
          }))}
        />
        <div
          role="tabpanel"
          id={panelId("labs", filter)}
          aria-labelledby={tabId("labs", filter)}
        >
          <div className="flex flex-col gap-3 border-b border-line p-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="sm:w-80">
              <label htmlFor="labs-search" className="field-label">
                Search by patient or test
              </label>
              <div className="relative">
                <MagnifyingGlassIcon
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted"
                  aria-hidden
                />
                <input
                  id="labs-search"
                  type="search"
                  className="input-field pl-9"
                  placeholder="Name, patient ID or test"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
            <p className="text-caption text-ink-muted" aria-live="polite">
              {visible.length === counts[filter]
                ? `${visible.length} order${visible.length === 1 ? "" : "s"}`
                : `${visible.length} of ${counts[filter]} orders match`}
            </p>
          </div>

          {rows.length === 0 ? (
            <EmptyState
              icon={BeakerIcon}
              title="No lab orders"
              description={
                signedInOnline === false
                  ? "No lab orders are visible to this device. Sign in with your online account to see them."
                  : "Orders placed from the Labs tab of a consultation appear here."
              }
            />
          ) : visible.length === 0 ? (
            <p className="panel-body text-body text-ink-muted">
              {search.trim()
                ? "No lab orders match this search."
                : `Nothing under “${LAB_FILTERS.find((f) => f.id === filter)?.label}” right now.`}
            </p>
          ) : (
            <>
              <div className="hidden overflow-x-auto md:block">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Patient</th>
                      <th scope="col">Test</th>
                      <th scope="col">Ordered</th>
                      <th scope="col">Status</th>
                      <th scope="col">Result</th>
                      <th scope="col" className="text-right">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((row) => (
                      <tr key={row.order.id} className={rowTint(row)}>
                        <td>
                          <PatientCell row={row} />
                        </td>
                        <td>
                          <TestCell row={row} />
                        </td>
                        <td>
                          <OrderedCell row={row} />
                        </td>
                        <td>
                          <StatusBadge tone={STAGE_META[row.stage].tone}>
                            {STAGE_META[row.stage].label}
                          </StatusBadge>
                        </td>
                        <td>
                          <ResultCell row={row} staff={staff} />
                        </td>
                        <td className="text-right">
                          <RowAction
                            row={row}
                            busy={busyId === row.order.id}
                            disabled={!available || busyId !== null}
                            canRecord={canRecord}
                            canReview={canReview}
                            onAdvance={advance}
                            onEnterResult={openEntry}
                            onReview={review}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <ul className="divide-y divide-line md:hidden">
                {visible.map((row) => (
                  <li key={row.order.id} className={`space-y-2 px-4 py-3 ${rowTint(row)}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <PatientCell row={row} />
                      </div>
                      <StatusBadge tone={STAGE_META[row.stage].tone}>
                        {STAGE_META[row.stage].label}
                      </StatusBadge>
                    </div>
                    <TestCell row={row} />
                    <OrderedCell row={row} />
                    {row.order.results.length > 0 && <ResultCell row={row} staff={staff} />}
                    <RowAction
                      row={row}
                      busy={busyId === row.order.id}
                      disabled={!available || busyId !== null}
                      canRecord={canRecord}
                      canReview={canReview}
                      onAdvance={advance}
                      onEnterResult={openEntry}
                      onReview={review}
                      block
                    />
                  </li>
                ))}
              </ul>
            </>
          )}

          <div className="space-y-1 border-t border-line px-4 py-3 text-caption text-ink-muted">
            <p>
              Lists every open order, every result waiting for review, and the{" "}
              {LAB_WORKLIST_CLOSED_LIMIT} most recent completed or cancelled
              orders.{truncated ? " Some older orders are not listed." : ""}
            </p>
            {!canReview && (
              <p>
                Your role can see results but cannot mark them reviewed. Staff
                authorised to review lab results do that.
              </p>
            )}
          </div>
        </div>
      </section>

      {entryOrder && (
        <LabResultEntryDialog
          testName={entryOrder.order.testName}
          patientLabel={entryOrder.patientLabel}
          saving={entrySaving}
          error={entryError}
          onCancel={closeEntry}
          onSubmit={(values) => void saveResult(values)}
        />
      )}
    </div>
  );
}

// ---- Row pieces (shared by the table and the phone list)

function rowTint(row: WorklistRow): string {
  return row.stage === "awaiting_review" && row.severity === "critical"
    ? "bg-critical-soft"
    : "";
}

function PatientCell({ row }: { row: WorklistRow }) {
  return (
    <div className="min-w-0">
      {row.patient ? (
        <Link
          to={`/patients/${row.patient.id}`}
          className="font-medium text-ink hover:underline"
        >
          {row.patientLabel}
        </Link>
      ) : (
        <span className="text-ink-secondary">{row.patientLabel}</span>
      )}
      <span className="block text-caption text-ink-muted">
        ID {shortId(row.order.patientId)}
      </span>
    </div>
  );
}

function TestCell({ row }: { row: WorklistRow }) {
  const { order } = row;
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-ink">{order.testName}</span>
        {order.testCode && (
          <span className="text-caption text-ink-muted">{order.testCode}</span>
        )}
        {order.priority === "stat" && (
          <StatusBadge tone="danger">{PRIORITY_LABEL.stat}</StatusBadge>
        )}
        {order.priority === "urgent" && (
          <StatusBadge tone="warning">{PRIORITY_LABEL.urgent}</StatusBadge>
        )}
        {order.priority === "routine" && (
          <span className="text-caption text-ink-muted">{PRIORITY_LABEL.routine}</span>
        )}
      </div>
      {order.specimenType && (
        <p className="text-caption text-ink-muted">Specimen: {order.specimenType}</p>
      )}
      {order.clinicalNotes && (
        <p className="line-clamp-2 text-caption text-ink-secondary">
          Clinical notes: {order.clinicalNotes}
        </p>
      )}
    </div>
  );
}

function OrderedCell({ row }: { row: WorklistRow }) {
  const { order } = row;
  return (
    <div className="text-caption text-ink-muted">
      <span className="block text-body text-ink-secondary tabular-nums">
        {order.orderedAt ? formatNigerianDateTime(order.orderedAt) : "Date not recorded"}
      </span>
      <span className="block">by {row.orderedByName}</span>
      {order.collectedAt && (
        <span className="block tabular-nums">
          Collected {formatNigerianDateTime(order.collectedAt)}
        </span>
      )}
      {order.cancelledAt && (
        <span className="block tabular-nums">
          Cancelled {formatNigerianDateTime(order.cancelledAt)}
        </span>
      )}
    </div>
  );
}

function ResultCell({
  row,
  staff,
}: {
  row: WorklistRow;
  staff: Map<string, User>;
}) {
  const { results } = row.order;
  if (results.length === 0) {
    return <span className="text-caption text-ink-muted">No result yet</span>;
  }
  return (
    <ul className="space-y-2">
      {results.map((r, i) => {
        // A missing or unknown interpretation is shown as needing a check,
        // never as normal.
        const meta = INTERPRETATION_META[r.interpretation] ?? {
          label: "Interpretation missing, check result",
          tone: "warning" as const,
        };
        const flagged = r.interpretation === "abnormal" || r.interpretation === "critical";
        return (
          <li key={r.id ?? i} className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`tabular-nums ${flagged ? "font-semibold text-danger-fg" : "text-ink"}`}
              >
                {formatResultValue(r)}
              </span>
              <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
            </div>
            {r.referenceRange && (
              <p className="text-caption text-ink-muted">Reference {r.referenceRange}</p>
            )}
            <p className="text-caption text-ink-muted tabular-nums">
              Resulted {formatNigerianDateTime(r.resultDate)}
              {r.reviewedAt
                ? ` · reviewed by ${staffName(staff, r.reviewedBy)}, ${formatNigerianDateTime(r.reviewedAt)}`
                : " · not reviewed"}
            </p>
            {r.notes && (
              <p className="text-caption text-ink-secondary">Note: {r.notes}</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

interface RowActionProps {
  row: WorklistRow;
  busy: boolean;
  disabled: boolean;
  canRecord: boolean;
  canReview: boolean;
  onAdvance: (row: WorklistRow, next: "collected" | "processing") => void;
  onEnterResult: (row: WorklistRow) => void;
  onReview: (row: WorklistRow) => void;
  /** Full-width button (phone list). */
  block?: boolean;
}

function RowAction({
  row,
  busy,
  disabled,
  canRecord,
  canReview,
  onAdvance,
  onEnterResult,
  onReview,
  block = false,
}: RowActionProps) {
  const { stage, order } = row;
  const width = block ? "w-full" : "whitespace-nowrap";
  const context = `${order.testName}, ${row.patientLabel}`;

  if ((stage === "ordered" || stage === "collected") && canRecord) {
    const label = stage === "ordered" ? "Mark collected" : "Start processing";
    return (
      <button
        type="button"
        className={`btn-secondary ${width}`}
        disabled={disabled}
        onClick={() => onAdvance(row, stage === "ordered" ? "collected" : "processing")}
        aria-label={`${label}: ${context}`}
      >
        {busy ? "Saving…" : label}
      </button>
    );
  }
  if ((stage === "processing" || stage === "no_result") && canRecord) {
    return (
      <button
        type="button"
        className={`btn-primary ${width}`}
        disabled={disabled}
        onClick={() => onEnterResult(row)}
        aria-label={`Enter result: ${context}`}
      >
        Enter result
      </button>
    );
  }
  if (stage === "awaiting_review" && canReview) {
    return (
      <button
        type="button"
        className={`btn-primary ${width}`}
        disabled={disabled}
        onClick={() => onReview(row)}
        aria-label={`Mark reviewed: ${context}`}
      >
        {busy ? "Saving…" : "Mark reviewed"}
      </button>
    );
  }
  return null;
}

function WorklistSkeleton() {
  return (
    <div>
      <span role="status" className="sr-only">
        Loading lab orders
      </span>
      <div className="panel overflow-hidden" aria-hidden>
        <div className="flex gap-2 border-b border-line p-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-24" />
          ))}
        </div>
        <div className="divide-y divide-line">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="hidden h-4 w-24 sm:block" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="ml-auto h-9 w-28" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
