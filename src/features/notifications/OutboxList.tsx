import { ChevronRightIcon } from "@heroicons/react/20/solid";
import { DeliveryStateBadge } from "@/features/notifications/OutboxBadges";
import {
  STORE_LABEL,
  formatWhen,
  maskPhone,
  type OutboxItem,
  type SendingBlocker,
} from "@/features/notifications/smsOutbox";

interface OutboxListProps {
  items: OutboxItem[];
  /** Names by patient id, looked up on this device. */
  patientNames: Map<string, string>;
  now: Date;
  blocker: SendingBlocker | null;
  selectedKey: string | null;
  onSelect: (item: OutboxItem) => void;
}

function nameFor(item: OutboxItem, names: Map<string, string>): string {
  return names.get(item.patientId) || item.payloadPatientName || "Patient not on this device";
}

/**
 * Dense outbox list. Phone numbers are masked here; the detail view shows
 * the full number for dialling.
 */
export function OutboxList({
  items,
  patientNames,
  now,
  blocker,
  selectedKey,
  onSelect,
}: OutboxListProps) {
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Patient</th>
              <th scope="col">Reminder</th>
              <th scope="col">To</th>
              <th scope="col">Send from</th>
              <th scope="col">State</th>
              <th scope="col">Stored</th>
              <th scope="col">
                <span className="sr-only">Details</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const name = nameFor(item, patientNames);
              const selected = item.key === selectedKey;
              return (
                <tr key={item.key} className={selected ? "bg-surface-sunken" : undefined}>
                  <td className="font-medium text-ink">{name}</td>
                  <td className="text-ink-secondary">{item.title}</td>
                  <td className="whitespace-nowrap tabular-nums text-ink-secondary">
                    {maskPhone(item.phone) || "—"}
                  </td>
                  <td className="whitespace-nowrap tabular-nums text-ink-secondary">
                    {formatWhen(item.scheduledFor ?? item.createdAt) || "—"}
                  </td>
                  <td>
                    <DeliveryStateBadge item={item} now={now} blocker={blocker} />
                  </td>
                  <td className="text-caption text-ink-muted">{STORE_LABEL[item.store]}</td>
                  <td className="text-right">
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => onSelect(item)}
                      aria-current={selected ? "true" : undefined}
                      aria-label={`View reminder for ${name}: ${item.title}`}
                    >
                      View
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ul className="divide-y divide-line md:hidden">
        {items.map((item) => {
          const name = nameFor(item, patientNames);
          const selected = item.key === selectedKey;
          return (
            <li key={item.key}>
              <button
                type="button"
                onClick={() => onSelect(item)}
                aria-current={selected ? "true" : undefined}
                className={`flex min-h-touch-target w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${
                  selected ? "bg-surface-sunken" : ""
                }`}
              >
                <span className="min-w-0 flex-1 space-y-1">
                  <span className="block truncate font-medium text-ink">{name}</span>
                  <span className="block truncate text-caption text-ink-secondary">
                    {item.title}
                  </span>
                  <span className="block text-caption tabular-nums text-ink-muted">
                    {maskPhone(item.phone) || "No number"} ·{" "}
                    {formatWhen(item.scheduledFor ?? item.createdAt) || "No time"} ·{" "}
                    {STORE_LABEL[item.store]}
                  </span>
                  <span className="block">
                    <DeliveryStateBadge item={item} now={now} blocker={blocker} />
                  </span>
                </span>
                <ChevronRightIcon className="mt-1 h-5 w-5 shrink-0 text-ink-muted" aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
