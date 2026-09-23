import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { useGam } from "@/stores/gamification";
import { useAuthStore } from "@/stores/auth";
import { can } from "@/auth/roles";
import { useToast } from "@/stores/toast";
import { db as mbhrDb } from "@/db/mbhr";
import { generateId } from "@/db";
import {
  ExclamationCircleIcon,
  GiftIcon,
  StarIcon,
} from "@heroicons/react/24/outline";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { TrainingModeFrame } from "@/components/training/TrainingModeFrame";
import { TrainingStat } from "@/components/training/TrainingWidgets";
import {
  RESTOCK_TAP_AMOUNTS,
  SWIFT_STOCKER_MIN_TOKENS,
  badgeLabel,
  restockTapTokens,
} from "@/components/training/trainingRules";

// Example prizes. The app does not stock or send these; the outreach
// coordinator decides what is really on offer.
const PRIZES = [
  {
    id: "sticker",
    name: "Volunteer Sticker Pack",
    cost: 50,
    description: "Cool stickers for your gear",
  },
  {
    id: "cap",
    name: "MBHR Baseball Cap",
    cost: 300,
    description: "Official volunteer cap",
  },
  {
    id: "lunch",
    name: "Free Lunch Voucher",
    cost: 500,
    description: "Enjoy a meal on us!",
  },
  {
    id: "tshirt",
    name: "Premium T-Shirt",
    cost: 800,
    description: "High-quality volunteer shirt",
  },
];

export default function PrizeShop() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const userId = currentUser?.id;
  const canRestock = !!currentUser && can(currentUser.role, "inventory");
  const wallet = useGam((s) => s.wallet);
  const spendTokens = useGam((s) => s.spendTokens);
  const ensureWallet = useGam((s) => s.ensureWallet);
  const walletLoading = useGam((s) => s.loading);
  const { push } = useToast();
  const [redeeming, setRedeeming] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!userId) return;
    ensureWallet(userId).catch((err) => {
      console.error(
        "Could not open prize-shop wallet:",
        err instanceof Error ? err.name : err,
      );
      setError("Your token balance could not be read from this device.");
    });
  }, [userId, ensureWallet]);

  const walletRow = useLiveQuery(
    async () => (userId ? mbhrDb.gamification.get(userId) : undefined),
    [userId],
  );
  const badges: string[] = walletRow?.badges ?? [];

  async function redeem(prize: (typeof PRIZES)[number]) {
    if (!userId || redeeming) return;
    if (
      !window.confirm(
        `Spend ${prize.cost} tokens on ${prize.name}? Tokens cannot be given back from this screen.`,
      )
    ) {
      return;
    }
    setRedeeming(prize.id);
    setError("");
    try {
      const success = await spendTokens(userId, prize.cost);
      if (!success) {
        setError(
          `Not enough tokens for ${prize.name}. Nothing was spent.`,
        );
        return;
      }
      push({
        id: generateId(),
        tone: "success",
        title: `Redeemed: ${prize.name}`,
        body: `${prize.cost} tokens spent on this device. Tell your outreach coordinator to collect it; the app does not notify them.`,
      });
    } catch (err) {
      console.error(
        "Could not redeem prize:",
        err instanceof Error ? err.name : err,
      );
      setError(`${prize.name} was not redeemed and no tokens were spent. Try again.`);
    } finally {
      setRedeeming(null);
    }
  }

  return (
    <TrainingModeFrame
      title="Prize shop"
      description="Spend the tokens you earn in the Restock game."
      note="These prizes are examples. Your outreach coordinator decides which prizes are really on offer."
    >
      <div className="space-y-5">
        {error && (
          <div className="banner banner-danger" role="alert">
            <ExclamationCircleIcon className="h-5 w-5 shrink-0" aria-hidden />
            <p>{error}</p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <TrainingStat
            label="Your prize-shop tokens"
            value={walletLoading ? "…" : wallet}
            hint="Stored on this device"
          />
          <div className="rounded-lg border border-line bg-surface px-4 py-3">
            <p className="flex items-center gap-1.5 text-caption text-ink-muted">
              <StarIcon className="h-4 w-4" aria-hidden />
              Badges earned
            </p>
            {badges.length === 0 ? (
              <p className="mt-1 text-body text-ink-secondary">No badges yet</p>
            ) : (
              <ul className="mt-2 flex flex-wrap gap-2">
                {badges.map((badge) => (
                  <li key={badge}>
                    <StatusBadge tone="neutral">{badgeLabel(badge)}</StatusBadge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PRIZES.map((prize) => {
            const canAfford = wallet >= prize.cost;
            const busy = redeeming === prize.id;
            return (
              <li key={prize.id} className="card flex flex-col">
                <GiftIcon className="h-6 w-6 text-ink-muted" aria-hidden />
                <h2 className="mt-2 text-h3 text-ink">{prize.name}</h2>
                <p className="text-body text-ink-secondary">{prize.description}</p>
                <p className="mt-3 text-h2 tabular-nums text-ink">
                  {prize.cost} tokens
                </p>
                <div className="mt-auto pt-3">
                  <button
                    type="button"
                    className={canAfford ? "btn-primary w-full" : "btn-secondary w-full"}
                    onClick={() => void redeem(prize)}
                    disabled={!canAfford || !userId || !!redeeming}
                  >
                    {busy
                      ? "Redeeming…"
                      : canAfford
                        ? `Redeem for ${prize.cost} tokens`
                        : `Need ${prize.cost - wallet} more tokens`}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>

        <section className="panel" aria-labelledby="earn-tokens">
          <div className="panel-header">
            <h2 id="earn-tokens" className="panel-title">
              How to earn prize-shop tokens
            </h2>
          </div>
          <div className="panel-body space-y-2 text-body text-ink-secondary">
            <p>
              These tokens come only from the{" "}
              {canRestock ? (
                <Link to="/inv/game" className="text-primary-fg underline">
                  Restock game
                </Link>
              ) : (
                "Restock game (pharmacists and administrators)"
              )}
              , when you record supplies you have put on the shelf:
            </p>
            <ul className="list-disc space-y-1 pl-5">
              {RESTOCK_TAP_AMOUNTS.map((amount) => (
                <li key={amount}>
                  Each +{amount} tap earns {restockTapTokens(amount)}{" "}
                  {restockTapTokens(amount) === 1 ? "token" : "tokens"}.
                </li>
              ))}
              <li>
                A restock worth {SWIFT_STOCKER_MIN_TOKENS} or more tokens earns
                the Swift stocker badge.
              </li>
            </ul>
            <p className="text-caption text-ink-muted">
              Tokens from the other training games go to a separate game wallet
              shown on the Training page; they cannot be spent here.
            </p>
          </div>
        </section>
      </div>
    </TrainingModeFrame>
  );
}
