import { useCallback, useEffect, useState } from "react";
import { formatNigerianDate } from "@/utils/dateFormat";
import {
  BanknotesIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
} from "@heroicons/react/24/outline";
import * as logger from "@/lib/logger";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";
import { billStatusDisplay, formatNaira } from "./account/displayStatus";
import { errorName, readPortalUser } from "./account/portalSession";

interface Bill {
  id: string;
  visitId: string;
  visitDate: Date;
  description: string;
  amount: number;
  amountPaid: number;
  status: "pending" | "partial" | "paid" | "overdue";
  dueDate: Date;
  createdAt: Date;
}

/**
 * Bills recorded for the patient. There is no online payment in the portal:
 * a bill only shows as paid when the stored record says so.
 */
export function BillingPayments() {
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [noPatient, setNoPatient] = useState(false);

  const loadBillingData = useCallback(async () => {
    setLoading(true);
    try {
      const portalUser = readPortalUser();
      if (!portalUser?.patientId) {
        logger.error("No patient ID found");
        setNoPatient(true);
        return;
      }

      // No billing source is connected to the portal yet, so there are no
      // bills to show. Never invent bills or payment states here.
      setBills([]);
    } catch (err) {
      logger.error("[BillingPayments] load failed:", errorName(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBillingData();
  }, [loadBillingData]);

  const totalOutstanding = bills.reduce(
    (sum, bill) => sum + Math.max(0, bill.amount - bill.amountPaid),
    0,
  );
  const paidCount = bills.filter((b) => b.status === "paid").length;
  const unpaidCount = bills.length - paidCount;

  const header = (
    <PageHeader
      title="Bills and payments"
      description="Charges from your clinic visits and what has been paid."
    />
  );

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
        {header}
        <span role="status" className="sr-only">
          Loading your bills
        </span>
        <div className="panel p-5" aria-hidden>
          <Skeleton className="mb-4 h-5 w-40" />
          <SkeletonText lines={3} />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
      {header}

      <div className="banner banner-info">
        <InformationCircleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
        <p>
          You cannot pay bills in the portal. To pay, or to ask about a charge,
          speak to the clinic desk and ask for a receipt.
        </p>
      </div>

      {noPatient && (
        <div className="banner banner-danger" role="alert">
          <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <p>
            We could not find your patient record. Log out, log in again, then
            try once more.
          </p>
        </div>
      )}

      {bills.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={BanknotesIcon}
            title="No bills to show"
            description="Clinic bills are not shown in the portal yet. Ask at the clinic desk about any charges from your visits."
          />
        </div>
      ) : (
        <>
          <section className="panel" aria-labelledby="billing-summary-title">
            <div className="panel-header">
              <h2 id="billing-summary-title" className="panel-title">
                Summary
              </h2>
            </div>
            <dl className="panel-body grid gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-label text-ink-muted">Still to pay</dt>
                <dd className="text-stat text-ink tabular-nums">
                  {formatNaira(totalOutstanding)}
                </dd>
              </div>
              <div>
                <dt className="text-label text-ink-muted">Paid bills</dt>
                <dd className="text-stat text-ink tabular-nums">{paidCount}</dd>
              </div>
              <div>
                <dt className="text-label text-ink-muted">Not fully paid</dt>
                <dd className="text-stat text-ink tabular-nums">{unpaidCount}</dd>
              </div>
            </dl>
          </section>

          <section className="panel" aria-labelledby="billing-list-title">
            <div className="panel-header">
              <h2 id="billing-list-title" className="panel-title">
                Your bills
              </h2>
            </div>
            <ul className="divide-y divide-line">
              {bills.map((bill) => {
                const status = billStatusDisplay(bill.status);
                const balance = Math.max(0, bill.amount - bill.amountPaid);
                return (
                  <li key={bill.id} className="px-4 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-h3 text-ink">{bill.description}</h3>
                      <StatusBadge tone={status.tone} icon>
                        {status.label}
                      </StatusBadge>
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-3 text-body sm:grid-cols-4">
                      <div>
                        <dt className="text-caption text-ink-muted">Visit date</dt>
                        <dd className="text-ink tabular-nums">
                          {formatNigerianDate(bill.visitDate)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-caption text-ink-muted">Total</dt>
                        <dd className="font-medium text-ink tabular-nums">
                          {formatNaira(bill.amount)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-caption text-ink-muted">Paid</dt>
                        <dd className="text-ink tabular-nums">
                          {formatNaira(bill.amountPaid)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-caption text-ink-muted">Balance</dt>
                        <dd className="font-medium text-ink tabular-nums">
                          {formatNaira(balance)}
                        </dd>
                      </div>
                    </dl>
                    {bill.status !== "paid" && (
                      <p className="mt-2 text-caption text-ink-muted">
                        Pay at the clinic desk
                        {bill.dueDate
                          ? ` by ${formatNigerianDate(bill.dueDate)}`
                          : ""}
                        .
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
