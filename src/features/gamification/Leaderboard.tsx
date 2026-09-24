import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useGam } from "@/stores/gamification";
import { useAuthStore } from "@/stores/auth";
import { can } from "@/auth/roles";
import { db } from "@/db";
import {
  ArrowPathIcon,
  ExclamationCircleIcon,
  TrophyIcon,
} from "@heroicons/react/24/outline";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { TrainingModeFrame } from "@/components/training/TrainingModeFrame";
import {
  buildLeaderboard,
  type LeaderboardRow,
} from "@/components/training/trainingActivities";

type LoadState = "loading" | "ready" | "failed";

const MAX_ROWS = 50;

export default function Leaderboard() {
  const currentUserId = useAuthStore((s) => s.currentUser?.id);
  const role = useAuthStore((s) => s.currentUser?.role);
  const canRestock = !!role && can(role, "inventory");
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [hiddenLegacyWallet, setHiddenLegacyWallet] = useState(false);
  const [state, setState] = useState<LoadState>("loading");

  const load = useCallback(async () => {
    setState("loading");
    try {
      // One extra: the legacy shared wallet, if present, is left off below.
      const wallets = await useGam.getState().leaderboard("all", MAX_ROWS + 1);
      // Attach display names from staff accounts stored on this device.
      const users = await db.users.toArray();
      const board = buildLeaderboard(wallets, users, currentUserId);
      setRows(board.rows.slice(0, MAX_ROWS));
      setHiddenLegacyWallet(board.hiddenLegacyWallet);
      setState("ready");
    } catch (error) {
      console.error(
        "Could not load leaderboard:",
        error instanceof Error ? error.name : error,
      );
      setState("failed");
    }
  }, [currentUserId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <TrainingModeFrame
      title="Restock leaderboard"
      description="Prize-shop tokens each staff member holds, earned in the Restock game. Read from this device."
      actions={
        <button
          type="button"
          onClick={() => void load()}
          disabled={state === "loading"}
          className="btn-secondary"
        >
          <ArrowPathIcon className="h-4 w-4" aria-hidden />
          Refresh
        </button>
      }
    >
      <div aria-live="polite" className="sr-only">
        {state === "loading" ? "Loading leaderboard" : ""}
      </div>

      {state === "loading" && (
        <div className="panel space-y-4 p-4" aria-hidden>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="h-4 w-8" />
              <Skeleton className="h-4 w-48" />
              <Skeleton className="ml-auto h-4 w-12" />
            </div>
          ))}
        </div>
      )}

      {state === "failed" && (
        <div className="banner banner-danger" role="alert">
          <ExclamationCircleIcon className="h-5 w-5 shrink-0" aria-hidden />
          <div>
            <p>The leaderboard could not be read from this device.</p>
            <button type="button" onClick={() => void load()} className="btn-secondary mt-2">
              Try again
            </button>
          </div>
        </div>
      )}

      {state === "ready" && rows.length === 0 && (
        <div className="panel">
          <EmptyState
            icon={TrophyIcon}
            title="No tokens earned yet"
            description="Tokens appear here after someone records a restock in the Restock game on this device."
            action={
              canRestock ? (
                <Link to="/inv/game" className="btn-secondary">
                  Open the Restock game
                </Link>
              ) : undefined
            }
          />
        </div>
      )}

      {state === "ready" && rows.length > 0 && (
        <div className="panel overflow-hidden">
          <table className="data-table">
            <caption className="sr-only">
              Staff ranked by prize-shop tokens held
            </caption>
            <thead>
              <tr>
                <th scope="col" className="w-20">
                  Rank
                </th>
                <th scope="col">Staff member</th>
                <th scope="col" className="text-right">
                  Tokens
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.volunteerId} className={r.isYou ? "bg-primary-soft" : ""}>
                  <td className="tabular-nums text-ink-secondary">{r.rank}</td>
                  <td className="font-medium">
                    <span className="flex flex-wrap items-center gap-2">
                      {r.name}
                      {r.isYou && <StatusBadge tone="info">You</StatusBadge>}
                    </span>
                  </td>
                  <td className="text-right font-semibold tabular-nums">{r.tokens}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {state === "ready" && hiddenLegacyWallet && (
        <p className="mt-3 text-caption text-ink-muted">
          Tokens recorded under the old shared demo wallet, before wallets were
          kept per person, are not shown.
        </p>
      )}
    </TrainingModeFrame>
  );
}
