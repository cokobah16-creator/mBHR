import { useCallback, useEffect, useState } from "react";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/stores/toast";
import { createAuditLog, db, generateId } from "@/db";
import { GamificationService } from "@/services/gamification";
import { can } from "@/auth/roles";
import {
  CheckCircleIcon,
  ExclamationCircleIcon,
  InboxIcon,
  LockClosedIcon,
  XCircleIcon,
} from "@heroicons/react/24/outline";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { formatNigerianDateTime } from "@/utils/dateFormat";
import { toDate } from "@/components/training/trainingActivities";

interface PendingSession {
  id: string;
  type: string;
  volunteerId: string;
  volunteerName: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  score: number;
  tokensEarned: number;
  payload: Record<string, unknown>;
}

type LoadState = "loading" | "ready" | "failed";

const GAME_LABELS: Record<string, string> = {
  vitals: "Vitals Precision",
  shelf: "Shelf Sleuth",
  quiz: "Knowledge Blitz",
  triage: "Triage Sprint",
};

const getGameTypeLabel = (type: string) => GAME_LABELS[type] || type;

function parsePayload(json: string | undefined): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(json || "{}");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Score in words; its meaning differs by game. */
function scoreText(s: PendingSession): string {
  if (s.type === "quiz") {
    const total = Number(s.payload.totalQuestions);
    return Number.isFinite(total) && total > 0
      ? `${s.score}/${total} correct`
      : `${s.score} correct`;
  }
  if (s.type === "triage" || s.type === "vitals") return `${s.score}% correct`;
  return String(s.score);
}

/** `processing` holds the session id while approving, or "reject:<id>" while rejecting. */
const rejectKey = (id: string) => `reject:${id}`;

function busyAction(
  processing: string | null,
  id: string,
): "approve" | "reject" | null {
  if (processing === id) return "approve";
  if (processing === rejectKey(id)) return "reject";
  return null;
}

function durationText(s: PendingSession): string {
  if (!s.startedAt || !s.finishedAt) return "Not recorded";
  const minutes = Math.round(
    (s.finishedAt.getTime() - s.startedAt.getTime()) / 60000,
  );
  return minutes < 1 ? "Under 1 min" : `${minutes} min`;
}

export default function ApprovalInbox() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const { push } = useToast();
  const [pendingSessions, setPendingSessions] = useState<PendingSession[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [processing, setProcessing] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");

  const allowed = !!currentUser && can(currentUser.role, "users");

  const loadPendingSessions = useCallback(async () => {
    try {
      // `committed` is a boolean and is not indexed, so filter in memory.
      const sessions = await db.gameSessions
        .filter((session) => !session.committed && !!session.finishedAt)
        .toArray();

      // Get volunteer names
      const volunteerIds = [...new Set(sessions.map((s) => s.volunteerId))];
      const users = await db.users.where("id").anyOf(volunteerIds).toArray();
      const userMap = new Map(users.map((u) => [u.id, u.fullName]));

      const sessionsWithNames: PendingSession[] = sessions
        .map((session) => ({
          id: session.id,
          type: session.type,
          volunteerId: session.volunteerId,
          volunteerName:
            userMap.get(session.volunteerId) || "Staff member not on this device",
          startedAt: toDate(session.startedAt),
          finishedAt: toDate(session.finishedAt),
          score: session.score,
          tokensEarned: session.tokensEarned,
          payload: parsePayload(session.payloadJson),
        }))
        // Oldest first: the order they were finished in.
        .sort(
          (a, b) =>
            (a.finishedAt?.getTime() ?? 0) - (b.finishedAt?.getTime() ?? 0),
        );

      setPendingSessions(sessionsWithNames);
      setLoadState("ready");
    } catch (error) {
      console.error(
        "Error loading pending sessions:",
        error instanceof Error ? error.name : error,
      );
      setLoadState("failed");
    }
  }, []);

  useEffect(() => {
    if (allowed) void loadPendingSessions();
  }, [allowed, loadPendingSessions]);

  const approveSession = async (session: PendingSession) => {
    if (!currentUser || !can(currentUser.role, "users") || processing) return;

    setProcessing(session.id);
    setActionError("");
    try {
      await GamificationService.approveSession(session.id, currentUser.id);
      push({
        id: generateId(),
        tone: "success",
        title: `Approved: ${getGameTypeLabel(session.type)} for ${session.volunteerName}`,
        body: `${session.tokensEarned} tokens added to their game wallet on this device.`,
      });
      await loadPendingSessions();
    } catch (error) {
      console.error(
        "Error approving session:",
        error instanceof Error ? error.name : error,
      );
      setActionError(
        `The ${getGameTypeLabel(session.type)} session for ${session.volunteerName} was not approved. No tokens were added. Try again.`,
      );
    } finally {
      setProcessing(null);
    }
  };

  const rejectSession = async (session: PendingSession) => {
    if (!currentUser || !can(currentUser.role, "users") || processing) return;
    if (
      !window.confirm(
        `Reject ${session.volunteerName}'s ${getGameTypeLabel(session.type)} session? It will be deleted and no tokens will be added. This cannot be undone.`,
      )
    ) {
      return;
    }

    setProcessing(rejectKey(session.id));
    setActionError("");
    try {
      await db.gameSessions.delete(session.id);
    } catch (error) {
      console.error(
        "Error rejecting session:",
        error instanceof Error ? error.name : error,
      );
      setActionError(
        `The ${getGameTypeLabel(session.type)} session for ${session.volunteerName} was not rejected. Try again.`,
      );
      setProcessing(null);
      return;
    }
    try {
      await createAuditLog(
        currentUser.role,
        "reject_game_session",
        "game_session",
        session.id,
      );
    } catch (error) {
      // The rejection itself is saved; the audit entry is best-effort.
      console.error(
        "Error recording rejection in audit log:",
        error instanceof Error ? error.name : error,
      );
    }
    push({
      id: generateId(),
      tone: "info",
      title: `Rejected: ${getGameTypeLabel(session.type)} for ${session.volunteerName}`,
      body: "The session was deleted. No tokens were added.",
    });
    await loadPendingSessions();
    setProcessing(null);
  };

  const bulkApproveAll = async () => {
    if (!currentUser || !can(currentUser.role, "users") || processing) return;
    const toApprove = pendingSessions;
    if (
      !window.confirm(
        `Approve all ${toApprove.length} pending sessions? Their tokens are added to each person's game wallet.`,
      )
    ) {
      return;
    }

    setProcessing("bulk");
    setActionError("");
    let approved = 0;
    let failed = 0;
    for (const session of toApprove) {
      try {
        await GamificationService.approveSession(session.id, currentUser.id);
        approved++;
      } catch (error) {
        failed++;
        console.error(
          "Error bulk approving:",
          error instanceof Error ? error.name : error,
        );
      }
    }
    await loadPendingSessions();
    setProcessing(null);
    if (failed === 0) {
      push({
        id: generateId(),
        tone: "success",
        title: `Approved ${approved} ${approved === 1 ? "session" : "sessions"}`,
        body: "Tokens added to game wallets on this device.",
      });
    } else {
      setActionError(
        `${approved} approved, ${failed} not approved. The ones not approved are still listed; try them again.`,
      );
    }
  };

  // Only admins can approve
  if (!allowed) {
    return (
      <div>
        <PageHeader title="Training game approvals" />
        <div className="panel">
          <EmptyState
            icon={LockClosedIcon}
            title="You can't approve training sessions"
            description="Only administrators can approve training game sessions."
          />
        </div>
      </div>
    );
  }

  const count = pendingSessions.length;

  return (
    <div>
      <PageHeader
        title="Training game approvals"
        description="Finished training game sessions waiting for review. Approving adds the session's tokens to that person's game wallet on this device. No patient records change."
        actions={
          loadState === "ready" &&
          count > 0 && (
            <button
              type="button"
              onClick={() => void bulkApproveAll()}
              disabled={processing !== null}
              className="btn-primary"
            >
              <CheckCircleIcon className="h-5 w-5" aria-hidden />
              {processing === "bulk" ? "Approving…" : `Approve all (${count})`}
            </button>
          )
        }
      />

      <div aria-live="polite" className="sr-only">
        {loadState === "loading" ? "Loading sessions waiting for approval" : ""}
      </div>

      {actionError && (
        <div className="banner banner-danger mb-4" role="alert">
          <ExclamationCircleIcon className="h-5 w-5 shrink-0" aria-hidden />
          <p>{actionError}</p>
        </div>
      )}

      {loadState === "loading" && (
        <div className="panel space-y-4 p-4" aria-hidden>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-28" />
              <Skeleton className="ml-auto h-9 w-40" />
            </div>
          ))}
        </div>
      )}

      {loadState === "failed" && (
        <div className="banner banner-danger" role="alert">
          <ExclamationCircleIcon className="h-5 w-5 shrink-0" aria-hidden />
          <div>
            <p>Sessions waiting for approval could not be read from this device.</p>
            <button
              type="button"
              onClick={() => {
                setLoadState("loading");
                void loadPendingSessions();
              }}
              className="btn-secondary mt-2"
            >
              Try again
            </button>
          </div>
        </div>
      )}

      {loadState === "ready" && count === 0 && (
        <div className="panel">
          <EmptyState
            icon={InboxIcon}
            title="No sessions waiting for approval"
            description="Finished training games appear here until an administrator approves or rejects them."
          />
        </div>
      )}

      {loadState === "ready" && count > 0 && (
        <>
          {/* Wide screens: table */}
          <div className="panel hidden overflow-x-auto md:block">
            <table className="data-table">
              <caption className="sr-only">
                Training game sessions waiting for approval
              </caption>
              <thead>
                <tr>
                  <th scope="col">Staff member</th>
                  <th scope="col">Game</th>
                  <th scope="col">Score</th>
                  <th scope="col">Time taken</th>
                  <th scope="col">Finished</th>
                  <th scope="col" className="text-right">
                    Tokens
                  </th>
                  <th scope="col" className="text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {pendingSessions.map((session) => (
                  <tr key={session.id}>
                    <td className="font-medium">{session.volunteerName}</td>
                    <td>
                      <StatusBadge tone="neutral">
                        {getGameTypeLabel(session.type)}
                      </StatusBadge>
                    </td>
                    <td className="tabular-nums">{scoreText(session)}</td>
                    <td className="tabular-nums">{durationText(session)}</td>
                    <td className="tabular-nums">
                      {formatNigerianDateTime(session.finishedAt)}
                    </td>
                    <td className="text-right font-semibold tabular-nums">
                      {session.tokensEarned}
                    </td>
                    <td>
                      <SessionActions
                        session={session}
                        busy={busyAction(processing, session.id)}
                        disabled={processing !== null}
                        onApprove={() => void approveSession(session)}
                        onReject={() => void rejectSession(session)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Narrow screens: list */}
          <ul className="space-y-3 md:hidden">
            {pendingSessions.map((session) => (
              <li key={session.id} className="card space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-h3 text-ink">{session.volunteerName}</p>
                    <p className="text-caption text-ink-muted">
                      Finished {formatNigerianDateTime(session.finishedAt)}
                    </p>
                  </div>
                  <StatusBadge tone="neutral">
                    {getGameTypeLabel(session.type)}
                  </StatusBadge>
                </div>
                <dl className="grid grid-cols-3 gap-2 text-body">
                  <div>
                    <dt className="text-caption text-ink-muted">Score</dt>
                    <dd className="tabular-nums text-ink">{scoreText(session)}</dd>
                  </div>
                  <div>
                    <dt className="text-caption text-ink-muted">Time taken</dt>
                    <dd className="tabular-nums text-ink">{durationText(session)}</dd>
                  </div>
                  <div>
                    <dt className="text-caption text-ink-muted">Tokens</dt>
                    <dd className="font-semibold tabular-nums text-ink">
                      {session.tokensEarned}
                    </dd>
                  </div>
                </dl>
                <SessionActions
                  session={session}
                  busy={busyAction(processing, session.id)}
                  disabled={processing !== null}
                  onApprove={() => void approveSession(session)}
                  onReject={() => void rejectSession(session)}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function SessionActions({
  session,
  busy,
  disabled,
  onApprove,
  onReject,
}: {
  session: PendingSession;
  busy: "approve" | "reject" | null;
  disabled: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const what = `${session.volunteerName}'s ${getGameTypeLabel(session.type)} session`;
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <button
        type="button"
        onClick={onApprove}
        disabled={disabled}
        aria-label={`Approve ${what}`}
        className="btn-primary px-3"
      >
        <CheckCircleIcon className="h-4 w-4" aria-hidden />
        {busy === "approve" ? "Approving…" : "Approve"}
      </button>
      <button
        type="button"
        onClick={onReject}
        disabled={disabled}
        aria-label={`Reject ${what}`}
        className="btn-secondary px-3 text-danger-fg"
      >
        <XCircleIcon className="h-4 w-4" aria-hidden />
        {busy === "reject" ? "Rejecting…" : "Reject"}
      </button>
    </div>
  );
}
