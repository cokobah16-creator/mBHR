import { BanknotesIcon, InformationCircleIcon } from "@heroicons/react/24/outline";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { useT } from "@/hooks/useT";

/**
 * No billing source is connected to the portal yet, and there is no online
 * payment. The page says so plainly; it never invents bills or payment states.
 */
export function BillingPayments() {
  const { t } = useT();
  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
      <PageHeader
        title={t("portal.bill.title")}
        description={t("portal.bill.description")}
      />

      <div className="banner banner-info">
        <InformationCircleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
        <p>{t("portal.bill.payAtDesk")}</p>
      </div>

      <div className="panel">
        <EmptyState
          icon={BanknotesIcon}
          title={t("portal.bill.emptyTitle")}
          description={t("portal.bill.emptyBody")}
        />
      </div>
    </div>
  );
}
