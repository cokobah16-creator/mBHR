import { DocumentCheckIcon } from "@heroicons/react/24/outline";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { useT } from "@/hooks/useT";

// No source for pre-visit forms is connected to the portal yet, so there is
// never a form to fill in or send. The page says so plainly rather than
// showing a form whose answers would go nowhere.
export function PreVisitForms() {
  const { t } = useT();
  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
      <PageHeader
        title={t("portal.forms.title")}
        description={t("portal.forms.description")}
      />
      <div className="panel">
        <EmptyState
          icon={DocumentCheckIcon}
          title={t("portal.forms.emptyTitle")}
          description={t("portal.forms.emptyBody")}
        />
      </div>
    </div>
  );
}
