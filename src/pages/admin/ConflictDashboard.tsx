import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowPathIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloudIcon,
  ExclamationTriangleIcon,
  MagnifyingGlassIcon,
  SignalSlashIcon,
} from "@heroicons/react/24/outline";
import { useAuthStore } from "@/stores/auth";
import { can } from "@/auth/roles";
import { useToast } from "@/stores/toast";
import { generateId } from "@/db";
import logger from "@/lib/logger";
import {
  conflictQueueService,
  ConflictQueueError,
  CONFLICT_QUEUE_NOT_CONFIGURED,
  type ConflictResolution,
  type ConflictStatsSummary,
  type ConflictView,
} from "@/services/conflictQueue";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonText } from "@/components/ui/Skeleton";
import { Tabs, type TabItem } from "@/components/ui/Tabs";
import { panelId, tabId } from "@/components/ui/tabIds";
import { ConflictDetailDialog } from "@/features/conflicts/ConflictDetailDialog";
import { ConflictListTable } from "@/features/conflicts/ConflictListTable";
import { ResolvedConflictTable } from "@/features/conflicts/ResolvedConflictTable";
import { BulkResolveDialog } from "@/features/conflicts/BulkResolveDialog";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { ConflictFiltersBar } from "@/features/conflicts/ConflictFiltersBar";
import { ConflictCounts } from "@/features/conflicts/ConflictCounts";
import { ConflictEmptyState } from "@/features/conflicts/ConflictEmptyState";
import {
  EMPTY_FILTERS,
  hasActiveFilters,
  pageOf,
  pageRange,
  sortOpenConflicts,
  toServiceFilters,
  type ConflictFilterState,
} from "@/features/conflicts/conflictFilters";
import { formatTimestamp } from "@/features/conflicts/conflictLabels";
import {
  canResolveConflict,
  decisionNeedsApproval,
} from "@/features/conflicts/conflictPermissions";
import { planDeviceWrite, type DeviceSnapshot } from "@/features/conflicts/devicePlan";
import {
  bulkResultText,
  summariseBulk,
  type BulkItem,
  type BulkStrategy,
} from "@/features/conflicts/resolutionSummary";
import { resolveMany, type ConflictActor } from "@/features/conflicts/conflictActions";
import {
  loadLocalContexts,
  loadStaffNames,
  type LocalConflictContext,
} from "@/features/conflicts/localContext";

const PAGE_SIZE = 20;
/** Open conflicts are fetched together so they can be ordered by urgency. */
const OPEN_CAP = 300;
const SCAN_LIMIT = 50;
const EMPTY_SNAPSHOT: DeviceSnapshot = { table: null, record: null, partner: null };

type LoadState = "idle" | "loading" | "loaded" | "error";

const TAB_PREFIX = "conflicts";

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export default function ConflictDashboard() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const { push } = useToast();
  const online = useOnlineStatus();
  const available = conflictQueueService.isAvailable();

  const actor = useMemo<ConflictActor | null>(
    () => (currentUser ? { id: currentUser.id, role: currentUser.role } : null),
    [currentUser],
  );
  const role = actor?.role ?? null;
  const canDecideAny = !!role && can(role, "resolve_conflicts");

  const [view, setView] = useState<ConflictView>("open");
  const [filters, setFilters] = useState<ConflictFilterState>(EMPTY_FILTERS);
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<ConflictResolution[]>([]);
  const [total, setTotal] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [stats, setStats] = useState<ConflictStatsSummary | null>(null);
  const [statsError, setStatsError] = useState(false);
  const [contexts, setContexts] = useState<Record<string, LocalConflictContext>>({});
  const [contextsLoading, setContextsLoading] = useState(false);
  const [staffNames, setStaffNames] = useState<Record<string, string>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [openConflict, setOpenConflict] = useState<ConflictResolution | null>(null);
  const [bulk, setBulk] = useState<{
    strategy: BulkStrategy;
    reason: string;
    error: string | null;
  } | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [now, setNow] = useState(() => new Date());
  /** null until checked; false means the server will hide conflict rows. */
  const [cloudSession, setCloudSession] = useState<boolean | null>(null);
  const requestRef = useRef(0);

  const serverPage = view === "resolved" ? page : 0;

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!available) return;
    let cancelled = false;
    conflictQueueService.hasCloudSession().then((has) => {
      if (!cancelled) setCloudSession(has);
    });
    return () => {
      cancelled = true;
    };
  }, [available, currentUser]);

  const loadList = useCallback(async () => {
    if (!available || !online) return;
    const token = ++requestRef.current;
    setLoadState("loading");
    try {
      const f = toServiceFilters(filters);
      const res =
        view === "resolved"
          ? await conflictQueueService.listConflicts({
              view,
              ...f,
              limit: PAGE_SIZE,
              offset: serverPage * PAGE_SIZE,
            })
          : await conflictQueueService.listConflicts({ view, ...f, limit: OPEN_CAP, offset: 0 });
      if (token !== requestRef.current) return;
      setRows(view === "resolved" ? res.conflicts : sortOpenConflicts(res.conflicts));
      setTotal(res.total);
      setLoadError(null);
      setLoadedAt(new Date());
      setNow(new Date());
      setLoadState("loaded");
    } catch (e) {
      if (token !== requestRef.current) return;
      logger.error("Conflict list failed to load", e instanceof Error ? e.name : "unknown");
      setLoadError(
        e instanceof ConflictQueueError
          ? e.message
          : "Something went wrong while loading. Try again.",
      );
      setLoadState("error");
    }
  }, [available, online, filters, view, serverPage]);

  const loadStats = useCallback(async () => {
    if (!available || !online) return;
    try {
      setStats(await conflictQueueService.getConflictStats());
      setStatsError(false);
    } catch {
      setStatsError(true);
    }
  }, [available, online]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const visible = useMemo(
    () => (view === "resolved" ? rows : pageOf(rows, page, PAGE_SIZE)),
    [rows, view, page],
  );
  const listTotal = view === "resolved" ? total : rows.length;
  const truncated = view !== "resolved" && total > rows.length;

  // Name the patient and plan device writes from this device's own copies.
  useEffect(() => {
    let cancelled = false;
    if (visible.length === 0) {
      setContexts({});
      setContextsLoading(false);
      return;
    }
    setContextsLoading(true);
    loadLocalContexts(visible)
      .then((c) => {
        if (!cancelled) setContexts(c);
      })
      .catch(() => {
        if (!cancelled) setContexts({});
      })
      .finally(() => {
        if (!cancelled) setContextsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible]);

  useEffect(() => {
    let cancelled = false;
    loadStaffNames(visible.flatMap((c) => [c.resolvedBy, c.approvedBy, c.secondApproverId])).then(
      (names) => {
        if (!cancelled) setStaffNames(names);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [visible]);

  const refresh = () => {
    loadList();
    loadStats();
  };

  // A different list is about to load: never show the old one under the
  // new tab or filters, and never call an unloaded list "empty".
  const resetList = () => {
    requestRef.current++;
    setRows([]);
    setTotal(0);
    setLoadError(null);
    setLoadedAt(null);
    setLoadState("idle");
  };

  const changeView = (next: ConflictView) => {
    if (next === view) return;
    resetList();
    setView(next);
    setPage(0);
    setSelectedIds(new Set());
  };

  const changeFilters = (patch: Partial<ConflictFilterState>) => {
    resetList();
    setFilters((prev) => ({ ...prev, ...patch }));
    setPage(0);
    setSelectedIds(new Set());
  };

  const changePage = (next: number) => {
    if (view === "resolved") resetList();
    setPage(Math.max(0, next));
    setSelectedIds(new Set());
  };

  const onChanged = (message: string) => {
    setAnnouncement(message);
    setSelectedIds(new Set());
    refresh();
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds((prev) =>
      visible.length > 0 && visible.every((c) => prev.has(c.id))
        ? new Set()
        : new Set(visible.map((c) => c.id)),
    );
  };

  const handleScan = async () => {
    if (!actor || !canDecideAny) return;
    setScanning(true);
    try {
      const r = await conflictQueueService.scanForDuplicates(SCAN_LIMIT, actor);
      const parts = [
        `Checked up to ${SCAN_LIMIT} patients on this device and queued ${plural(r.found, "possible duplicate")} for review.`,
      ];
      if (r.skipped > 0) {
        parts.push(
          `Skipped ${plural(r.skipped, "record")} that could not be checked (missing name or date of birth).`,
        );
      }
      if (r.failed > 0) {
        parts.push(`${plural(r.failed, "possible duplicate")} could not be saved to the server.`);
      }
      const body = parts.join(" ");
      push({
        id: generateId(),
        tone: r.failed > 0 ? "warning" : "success",
        title: "Duplicate scan finished",
        body,
      });
      setAnnouncement(`Duplicate scan finished. ${body}`);
      if (r.found > 0) refresh();
    } catch (e) {
      logger.error("Duplicate scan failed", e instanceof Error ? e.name : "unknown");
      push({
        id: generateId(),
        tone: "error",
        title: "Duplicate scan did not finish",
        body:
          e instanceof ConflictQueueError
            ? e.message
            : "Nothing more was queued. Try again when the connection is steady.",
      });
    } finally {
      setScanning(false);
    }
  };

  // Bulk decisions: the same per-conflict path as a single decision.
  const selectedConflicts = visible.filter((c) => selectedIds.has(c.id));
  const bulkEntries = bulk
    ? selectedConflicts.map((c) => {
        const needsApproval = decisionNeedsApproval(c, bulk.strategy);
        const item: BulkItem = {
          conflict: c,
          allowed: canResolveConflict(role, c),
          needsApproval,
          plan: planDeviceWrite({
            conflict: c,
            strategy: bulk.strategy,
            selections: {},
            awaitingApproval: needsApproval,
            snapshot: contexts[c.id] ?? EMPTY_SNAPSHOT,
          }),
        };
        return { conflict: c, item };
      })
    : [];
  const bulkSummary = bulk ? summariseBulk(bulkEntries.map((e) => e.item), bulk.strategy) : null;

  const runBulk = async () => {
    // Plans are built from this device's copies; without them every record
    // would be treated as "not on this device" and left unchanged here.
    if (!bulk || !bulkSummary || !actor || contextsLoading) return;
    const reason = bulk.reason.trim();
    if (!reason) {
      setBulk({ ...bulk, error: "Add a reason. It is saved with each decision." });
      return;
    }
    setBulkBusy(true);
    const tally = await resolveMany({
      entries: bulkEntries
        .filter(({ conflict }) => bulkSummary.eligibleIds.includes(conflict.id))
        .map(({ conflict, item }) => ({ conflict, plan: item.plan })),
      strategy: bulk.strategy,
      justification: reason,
      actor,
    });
    setBulkBusy(false);
    setBulk(null);
    const body = bulkResultText(tally, bulk.strategy);
    push({
      id: generateId(),
      tone: tally.notSaved > 0 || tally.deviceFailed > 0 ? "warning" : "success",
      title: "Bulk decision finished",
      body,
    });
    onChanged(`Bulk decision finished. ${body}`);
  };

  // Without an online sign-in the server returns zero rows, so its counts
  // would read as "none" when they are really unknown.
  const shownStats = cloudSession === false ? null : stats;

  const tabs: TabItem<ConflictView>[] = [
    { id: "open", label: "Open", badge: shownStats ? shownStats.pending : undefined },
    {
      id: "needs_approval",
      label: "Needs approval",
      badge: shownStats ? shownStats.needsApproval : undefined,
    },
    { id: "resolved", label: "Resolved" },
  ];

  const selectable = view === "open" && canDecideAny && online;
  const range = pageRange(page, PAGE_SIZE, listTotal);
  const filtersActive = hasActiveFilters(filters);
  const refreshing = loadState === "loading";

  const statsUnavailableText = statsError
    ? "not available"
    : cloudSession === false
      ? "not visible without an online sign-in"
      : !online
        ? "not available offline"
        : "loading";

  let listContent: ReactNode = null;
  if (loadState === "error" && rows.length === 0) {
    listContent = null;
  } else if (!online && loadState !== "loaded") {
    listContent = (
      <EmptyState
        icon={SignalSlashIcon}
        title="Conflicts can't be loaded offline"
        description="The conflict list is kept on the server. Reconnect to see it."
      />
    );
  } else if (loadState === "idle" || (refreshing && rows.length === 0 && !loadedAt)) {
    listContent = (
      <div className="px-4 py-4" aria-busy="true">
        <span role="status" className="sr-only">
          Loading conflicts
        </span>
        <SkeletonText lines={5} />
      </div>
    );
  } else if (visible.length === 0) {
    listContent = (
      <ConflictEmptyState
        view={view}
        filtersActive={filtersActive}
        onClearFilters={() => changeFilters(EMPTY_FILTERS)}
        cloudSession={cloudSession}
        loadedAt={loadedAt}
      />
    );
  } else if (view === "resolved") {
    listContent = (
      <ResolvedConflictTable
        conflicts={visible}
        contexts={contexts}
        contextsLoading={contextsLoading}
        staffNames={staffNames}
        currentUserId={actor?.id}
        onOpen={setOpenConflict}
      />
    );
  } else {
    listContent = (
      <ConflictListTable
        conflicts={visible}
        contexts={contexts}
        contextsLoading={contextsLoading}
        now={now}
        selectable={selectable}
        selectedIds={selectedIds}
        onToggle={toggleSelect}
        onToggleAll={toggleSelectAll}
        onOpen={setOpenConflict}
      />
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Sync conflicts"
        description="Records that were changed in two places, and possible duplicate patients. Compare both versions, choose what to keep, and see who decided what."
        actions={
          available ? (
            <>
              {canDecideAny && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleScan}
                  disabled={scanning || !online}
                >
                  <MagnifyingGlassIcon className="h-5 w-5" aria-hidden />
                  {scanning ? "Scanning…" : "Scan for duplicates"}
                </button>
              )}
              <button
                type="button"
                className="btn-secondary"
                onClick={refresh}
                disabled={!online || refreshing}
              >
                <ArrowPathIcon
                  className={`h-5 w-5 ${refreshing ? "animate-spin" : ""}`}
                  aria-hidden
                />
                {refreshing ? "Refreshing…" : "Refresh"}
              </button>
            </>
          ) : undefined
        }
      />

      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {!available ? (
        <div className="banner banner-info">
          <CloudIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <div>
            <p className="font-medium">Conflict review needs cloud sync</p>
            <p>
              {CONFLICT_QUEUE_NOT_CONFIGURED} Records are saved on this device
              only and are not compared with any other copy.
            </p>
          </div>
        </div>
      ) : (
        <>
          {cloudSession === false && (
            <div className="banner banner-warning">
              <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
              <div>
                <p className="font-medium">Not signed in online</p>
                <p>
                  The server only shows and accepts conflict decisions from staff
                  signed in with their online account (email and password). With a
                  PIN sign-in, lists and counts here can be empty even when
                  conflicts exist, and decisions will not be saved.
                </p>
              </div>
            </div>
          )}

          {!online && (
            <div className="banner banner-warning">
              <SignalSlashIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
              <p>
                You are offline. The conflict list is kept on the server, so it
                can't be refreshed or decided until the connection returns.
                {loadedAt ? ` What you see was loaded ${formatTimestamp(loadedAt)}.` : ""}
              </p>
            </div>
          )}

          <ConflictCounts
            stats={shownStats}
            unknownText={statsUnavailableText}
            failed={statsError}
          />

          <section className="panel" aria-label="Conflicts">
            <div className="px-3 pt-1">
              <Tabs
                tabs={tabs}
                active={view}
                onChange={changeView}
                idPrefix={TAB_PREFIX}
                label="Conflict lists"
              />
            </div>
            <div
              role="tabpanel"
              id={panelId(TAB_PREFIX, view)}
              aria-labelledby={tabId(TAB_PREFIX, view)}
            >
              <ConflictFiltersBar filters={filters} onChange={changeFilters} />

              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-caption text-ink-muted">
                <span>
                  {view === "resolved"
                    ? "Newest decisions first."
                    : "Most urgent first, then the ones waiting longest."}
                </span>
                <span aria-live="polite">
                  {refreshing
                    ? "Refreshing…"
                    : loadedAt
                      ? `Updated ${formatTimestamp(loadedAt)}`
                      : ""}
                </span>
              </div>

              {truncated && (
                <div className="mx-3 mb-3 banner banner-info">
                  <p>
                    Showing the {rows.length} oldest of {total} open conflicts.
                    Use the filters to narrow the list.
                  </p>
                </div>
              )}

              {loadState === "error" && (
                <div className="mx-3 mb-3 banner banner-danger" role="alert">
                  <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
                  <div className="space-y-2">
                    <p className="font-medium">The conflict list could not be loaded.</p>
                    <p>{loadError}</p>
                    {rows.length > 0 && (
                      <p>The list below is from {loadedAt ? formatTimestamp(loadedAt) : "earlier"} and may be out of date.</p>
                    )}
                    <button type="button" className="btn-secondary" onClick={refresh} disabled={!online}>
                      Try again
                    </button>
                  </div>
                </div>
              )}

              {selectable && selectedIds.size > 0 && (
                <div
                  role="region"
                  aria-label="Bulk actions"
                  className="flex flex-col gap-2 border-y border-line bg-surface-sunken px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="text-label text-ink">
                    {selectedIds.size} selected
                  </span>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setBulk({ strategy: "keep_local", reason: "", error: null })}
                    >
                      Keep device copy
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setBulk({ strategy: "keep_remote", reason: "", error: null })}
                    >
                      Keep server copy
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setBulk({ strategy: "ignore", reason: "", error: null })}
                    >
                      Dismiss
                    </button>
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => setSelectedIds(new Set())}
                    >
                      Clear selection
                    </button>
                  </div>
                </div>
              )}

              {listContent}

              {visible.length > 0 && listTotal > PAGE_SIZE && (
                <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3">
                  <p className="text-caption text-ink-muted">
                    Showing {range.from}–{range.to} of {listTotal}
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="btn-secondary px-3"
                      onClick={() => changePage(page - 1)}
                      disabled={page === 0 || refreshing}
                      aria-label="Previous page"
                    >
                      <ChevronLeftIcon className="h-5 w-5" aria-hidden />
                    </button>
                    <button
                      type="button"
                      className="btn-secondary px-3"
                      onClick={() => changePage(page + 1)}
                      disabled={(page + 1) * PAGE_SIZE >= listTotal || refreshing}
                      aria-label="Next page"
                    >
                      <ChevronRightIcon className="h-5 w-5" aria-hidden />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>
        </>
      )}

      {openConflict && (
        <ConflictDetailDialog
          key={openConflict.id}
          conflict={openConflict}
          actor={actor}
          online={online}
          staffNames={staffNames}
          onClose={() => setOpenConflict(null)}
          onChanged={onChanged}
        />
      )}

      {bulk && bulkSummary && (
        <BulkResolveDialog
          strategy={bulk.strategy}
          summary={bulkSummary}
          selectedCount={selectedConflicts.length}
          reason={bulk.reason}
          onReasonChange={(value) => setBulk({ ...bulk, reason: value, error: null })}
          reasonError={bulk.error}
          busy={bulkBusy}
          checking={contextsLoading}
          online={online}
          onConfirm={runBulk}
          onCancel={() => setBulk(null)}
        />
      )}
    </div>
  );
}
