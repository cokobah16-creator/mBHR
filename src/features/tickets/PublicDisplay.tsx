import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import {
  ArrowRightIcon,
  ArrowsPointingInIcon,
  ArrowsPointingOutIcon,
  BellAlertIcon,
  ComputerDesktopIcon,
  ExclamationTriangleIcon,
  SignalIcon,
  SignalSlashIcon,
} from "@heroicons/react/24/outline";
import { db } from "@/db";
import { isSupabaseEnabled } from "@/lib/supabaseClient";
import { useSyncStore } from "@/stores/syncStore";
import { useActiveSite } from "@/hooks/useActiveSite";
import { DEFAULT_SITE_NAME } from "@/services/activeSite";
import type { FlowStage } from "@/services/patientFlow";
import { formatNigerianDateTime } from "@/utils/dateFormat";
import {
  announcementFor,
  buildDisplayBoard,
  diffNewCalls,
  displayFreshness,
  isJustCalled,
  toDisplayRow,
  type DisplayQueueRow,
  type FreshnessKind,
} from "./displayModel";
import { STAGE_CHIP_CLASS, STAGE_MARKER_CLASS } from "./stageStyles";
import { useNow } from "./useNow";

// Waiting-room TV screen. PUBLIC: ticket numbers and destinations only.
// Rows are reduced to DisplayQueueRow inside the query, so no patient id,
// name or other identifying field ever reaches this component.

type DisplayData = { rows: DisplayQueueRow[]; failed: boolean };

const FRESHNESS_ICON: Record<FreshnessKind, typeof SignalIcon> = {
  offline: SignalSlashIcon,
  stale: ExclamationTriangleIcon,
  local: ComputerDesktopIcon,
  online: SignalIcon,
};

const FRESHNESS_TONE_CLASS = {
  warning: "border-warning-line bg-warning-soft text-warning-fg",
  neutral: "border-line bg-surface-sunken text-ink-secondary",
} as const;

function clockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-NG", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function sameDay(a: number, b: number): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return (
    x.getFullYear() === y.getFullYear() &&
    x.getMonth() === y.getMonth() &&
    x.getDate() === y.getDate()
  );
}

function StageChip({ stage, label, large }: { stage: FlowStage; label: string; large?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-3 rounded-lg border-2 font-semibold ${STAGE_CHIP_CLASS[stage]} ${
        large
          ? "px-4 py-2 text-3xl 2xl:px-5 2xl:text-5xl"
          : "px-3 py-1 text-2xl 2xl:text-3xl"
      }`}
    >
      <span
        className={`shrink-0 rounded-full ${STAGE_MARKER_CLASS[stage]} ${
          large ? "h-4 w-4 2xl:h-5 2xl:w-5" : "h-3 w-3"
        }`}
        aria-hidden
      />
      {label}
    </span>
  );
}

export default function PublicDisplay() {
  const now = useNow(5_000);
  const online = useSyncStore((s) => s.isOnline);
  const lastSyncAt = useSyncStore((s) => s.lastSuccessAt);
  const { site, loading: siteLoading } = useActiveSite();
  // Wait for the site setting instead of flashing the default name first.
  const siteName = siteLoading ? "" : (site?.name ?? DEFAULT_SITE_NAME);

  const data: DisplayData | undefined = useLiveQuery(async () => {
    try {
      const all = await db.queue.toArray();
      return { rows: all.map(toDisplayRow), failed: false };
    } catch (err) {
      console.error(
        "Waiting-room display could not read the queue:",
        err instanceof Error ? err.name : err,
      );
      return { rows: [], failed: true };
    }
  }, []);

  const board = useMemo(
    () => (data ? buildDisplayBoard(data.rows) : null),
    [data],
  );
  const failed = data?.failed ?? false;

  // Announce new calls politely; never read out what was already on screen
  // when the page opened. A failed read (empty board) is skipped, so calls
  // are not re-announced when the queue can be read again.
  const seenIds = useRef<Set<string> | null>(null);
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    if (!board || failed) return;
    const { fresh, ids } = diffNewCalls(seenIds.current, board.servingAll);
    seenIds.current = ids;
    if (fresh.length > 0) setAnnouncement(announcementFor(fresh));
  }, [board, failed]);

  const [fullscreen, setFullscreen] = useState(
    () => typeof document !== "undefined" && !!document.fullscreenElement,
  );
  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const canFullscreen =
    typeof document !== "undefined" && !!document.fullscreenEnabled;
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (err) {
      console.warn(
        "Full screen is not available:",
        err instanceof Error ? err.name : err,
      );
    }
  };

  const freshness = board
    ? displayFreshness({
        online,
        syncEnabled: isSupabaseEnabled,
        lastChangeAt: board.lastChangeAt,
        activeCount: board.activeCount,
        now,
      })
    : null;
  const FreshnessIcon = freshness ? FRESHNESS_ICON[freshness.kind] : null;
  const dense = (board?.serving.length ?? 0) > 3;

  return (
    <div className="flex min-h-screen flex-col bg-canvas text-ink">
      {/* Header: site, clock, date */}
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line bg-surface px-6 py-4 lg:px-10 lg:py-5">
        <div className="min-w-0">
          <p className="text-xl font-medium text-ink-muted 2xl:text-2xl">
            Patient queue
          </p>
          <h1 className="truncate text-4xl font-bold tracking-tight 2xl:text-5xl">
            {siteName || "\u00a0"}
          </h1>
        </div>
        <div className="text-right">
          <p className="text-5xl font-bold tabular-nums 2xl:text-6xl">
            <time dateTime={new Date(now).toISOString()}>{clockTime(now)}</time>
          </p>
          <p className="text-xl text-ink-secondary 2xl:text-2xl">
            {new Date(now).toLocaleDateString("en-NG", {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </p>
        </div>
      </header>

      {/* Not a live region: the "No changes for N min" label changes every
          minute and would repeat over the call announcements. */}
      {freshness && freshness.tone === "warning" && FreshnessIcon && (
        <div
          className={`flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-6 py-3 lg:px-10 ${FRESHNESS_TONE_CLASS.warning}`}
        >
          <FreshnessIcon className="h-8 w-8 shrink-0" aria-hidden />
          <span className="text-2xl font-semibold 2xl:text-3xl">
            {freshness.label}
          </span>
          <span className="text-xl 2xl:text-2xl">{freshness.detail}</span>
        </div>
      )}

      <div className="grid flex-1 content-start gap-8 p-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-10 lg:p-10">
        {/* Now serving */}
        <section aria-labelledby="display-serving-heading" className="min-w-0">
          <h2
            id="display-serving-heading"
            className="text-3xl font-bold uppercase tracking-wide text-ink-secondary 2xl:text-4xl"
          >
            Now serving
          </h2>

          {!board ? (
            <p className="mt-6 text-3xl text-ink-muted" role="status">
              Loading the queue…
            </p>
          ) : failed ? (
            <div
              className="mt-6 flex items-start gap-4 rounded-lg border-2 border-danger-line bg-danger-soft p-6 text-danger-fg"
              role="alert"
            >
              <ExclamationTriangleIcon className="h-10 w-10 shrink-0" aria-hidden />
              <div>
                <p className="text-3xl font-semibold">
                  This screen cannot read the queue.
                </p>
                <p className="mt-2 text-2xl">
                  Staff: reload the page. If it keeps happening, restart the
                  device.
                </p>
              </div>
            </div>
          ) : board.serving.length === 0 ? (
            <p className="mt-6 rounded-lg border-2 border-dashed border-line-strong bg-surface px-6 py-10 text-center text-3xl text-ink-muted 2xl:text-4xl">
              No tickets are being served right now.
            </p>
          ) : (
            <ul
              className={`mt-5 grid gap-4 ${dense ? "xl:grid-cols-2" : ""}`}
            >
              {board.serving.map((call) => {
                const justCalled = isJustCalled(call, now);
                return (
                  <li
                    key={call.id}
                    className={`flex flex-wrap items-center gap-x-5 gap-y-3 rounded-lg border-2 bg-surface px-6 py-4 ${
                      justCalled ? "border-primary" : "border-line"
                    }`}
                  >
                    <span
                      className={`font-bold tabular-nums tracking-tight text-ink ${
                        dense
                          ? "text-5xl 2xl:text-7xl"
                          : "text-6xl 2xl:text-8xl"
                      }`}
                    >
                      {call.ticket}
                    </span>
                    <ArrowRightIcon
                      className="h-10 w-10 shrink-0 text-ink-muted 2xl:h-14 2xl:w-14"
                      aria-hidden
                    />
                    <span className="sr-only">go to</span>
                    <StageChip stage={call.stage} label={call.destination} large={!dense} />
                    {justCalled && (
                      <span className="inline-flex items-center gap-2 text-2xl font-semibold text-primary-fg 2xl:text-3xl">
                        <BellAlertIcon className="h-8 w-8 shrink-0" aria-hidden />
                        Just called
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {board && board.servingMore > 0 && (
            <p className="mt-4 text-2xl text-ink-secondary">
              and {board.servingMore} more being served
            </p>
          )}
        </section>

        {/* Next */}
        <section aria-labelledby="display-next-heading" className="min-w-0">
          <h2
            id="display-next-heading"
            className="text-3xl font-bold uppercase tracking-wide text-ink-secondary 2xl:text-4xl"
          >
            Next
          </h2>
          {board && !failed && (
            <ul className="mt-5 space-y-4">
              {board.next.map((group) => (
                <li
                  key={group.stage}
                  className="rounded-lg border border-line bg-surface px-5 py-4"
                >
                  <StageChip stage={group.stage} label={group.destination} />
                  {group.tickets.length > 0 ? (
                    <ol
                      className="mt-3 flex flex-wrap gap-x-8 gap-y-2"
                      aria-label={`Next for ${group.destination}`}
                    >
                      {group.tickets.map((t, i) => (
                        <li
                          key={`${t}-${i}`}
                          className="text-4xl font-semibold tabular-nums text-ink 2xl:text-5xl"
                        >
                          {t}
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="mt-3 text-2xl text-ink-muted">
                      No one waiting
                    </p>
                  )}
                  {group.more > 0 && (
                    <p className="mt-2 text-xl text-ink-secondary 2xl:text-2xl">
                      and {group.more} more waiting
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
          {board && !failed && board.withoutTicket > 0 && (
            <p className="mt-4 text-xl text-ink-muted">
              {board.withoutTicket} queued{" "}
              {board.withoutTicket === 1 ? "patient has" : "patients have"} no
              ticket number on this screen.
            </p>
          )}
        </section>
      </div>

      {/* Footer: instruction, freshness, staff controls */}
      <footer className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-line bg-surface px-6 py-3 lg:px-10">
        <p className="text-2xl font-medium text-ink 2xl:text-3xl">
          Please listen for your ticket number and keep your ticket with you.
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-lg text-ink-secondary 2xl:text-xl">
          {freshness && FreshnessIcon && (
            <span
              className={`inline-flex items-center gap-2 rounded-md border px-3 py-1 font-semibold ${FRESHNESS_TONE_CLASS[freshness.tone]}`}
            >
              <FreshnessIcon className="h-5 w-5 shrink-0" aria-hidden />
              {freshness.label}
            </span>
          )}
          {freshness?.kind === "local" && <span>{freshness.detail}</span>}
          {isSupabaseEnabled && (
            <span>
              {lastSyncAt > 0
                ? `Last synced ${
                    sameDay(lastSyncAt, now)
                      ? clockTime(lastSyncAt)
                      : formatNigerianDateTime(lastSyncAt)
                  }`
                : "Not synced on this device yet"}
            </span>
          )}
          {board && !failed && (
            <span>
              {board.lastChangeAt === null
                ? "No queue changes yet"
                : `Last change ${
                    sameDay(board.lastChangeAt, now)
                      ? clockTime(Math.min(board.lastChangeAt, now))
                      : formatNigerianDateTime(board.lastChangeAt)
                  }`}
            </span>
          )}
          {canFullscreen && (
            <button
              type="button"
              onClick={toggleFullscreen}
              className="btn-ghost text-body"
            >
              {fullscreen ? (
                <ArrowsPointingInIcon className="h-5 w-5" aria-hidden />
              ) : (
                <ArrowsPointingOutIcon className="h-5 w-5" aria-hidden />
              )}
              {fullscreen ? "Exit full screen" : "Full screen"}
            </button>
          )}
          <Link to="/queue" className="btn-ghost text-body">
            Exit display
          </Link>
        </div>
      </footer>

      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
    </div>
  );
}
