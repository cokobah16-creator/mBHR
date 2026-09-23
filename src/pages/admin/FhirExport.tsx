import { PageHeader } from "@/components/ui/PageHeader";
import { BulkFHIRExport } from "@/features/admin/BulkFHIRExport";

/**
 * Hosts the bulk FHIR export. Intended route: /admin/fhir-export behind
 * <RequirePermission permission="export"> (see adminSections.ts); the export
 * component also checks the permission before it runs.
 */
export default function FhirExport() {
  return (
    <div>
      <PageHeader
        breadcrumbs={[
          { label: "Administration", to: "/admin" },
          { label: "Bulk FHIR export" },
        ]}
        title="Bulk FHIR export"
        description="Download the patient records stored on this device as FHIR NDJSON files, for analysis or moving to another system."
      />
      <BulkFHIRExport />
    </div>
  );
}
