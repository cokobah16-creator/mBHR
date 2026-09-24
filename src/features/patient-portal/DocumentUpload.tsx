import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { useNavigate } from "react-router-dom";
import { supabase, isSupabaseEnabled } from "@/lib/supabaseClient";
import * as logger from "@/lib/logger";
import { formatNigerianDate } from "@/utils/dateFormat";
import {
  ArrowPathIcon,
  CheckCircleIcon,
  DocumentArrowUpIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";
import { ConfirmDialog } from "./account/ConfirmDialog";
import { formatFileSize } from "./account/displayStatus";
import { errorName, readPortalUser } from "./account/portalSession";
import { isDeviceOnline, useOnlineStatus } from "@/hooks/useOnlineStatus";
import {
  buildDocumentInsert,
  canPatientRemove,
  documentSourceLabel,
  documentStoragePath,
  isConnectionFailure,
  readRemoveResult,
  visiblePortalDocuments,
  type PortalDocument,
} from "./patientDocuments";

const MAX_BYTES = 10 * 1024 * 1024;

const DOCUMENT_TYPES = [
  { value: "medical_record", label: "Medical record" },
  { value: "lab_result", label: "Test result" },
  { value: "imaging", label: "Scan or X-ray" },
  { value: "prescription", label: "Prescription" },
  { value: "insurance", label: "Insurance document" },
  { value: "other", label: "Other" },
];

function documentTypeLabel(value: string): string {
  return (
    DOCUMENT_TYPES.find((t) => t.value === value)?.label ??
    value.replace(/_/g, " ")
  );
}

export function DocumentUpload() {
  const navigate = useNavigate();
  const isOnline = useOnlineStatus();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [documents, setDocuments] = useState<PortalDocument[]>([]);
  const [loading, setLoading] = useState(isSupabaseEnabled);
  const [loadFailed, setLoadFailed] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadData, setUploadData] = useState({
    documentType: "medical_record",
    description: "",
  });
  const [toDelete, setToDelete] = useState<PortalDocument | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const loadDocuments = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadFailed(false);

    try {
      const portalUser = readPortalUser();
      if (!portalUser) {
        navigate("/patient/login", { replace: true });
        return;
      }

      // The server hides documents the patient removed and says who added
      // each one (patientDocuments.ts).
      const { data, error: docsError } = await supabase
        .from("patient_documents")
        .select("*")
        .eq("patient_id", portalUser.patientId)
        .order("created_at", { ascending: false });

      if (docsError) throw docsError;

      setDocuments(visiblePortalDocuments(data));
    } catch (err) {
      logger.error("[DocumentUpload] load failed:", errorName(err));
      setLoadFailed(true);
    } finally {
      setLoading(false);
      setHasLoaded(true);
    }
  }, [navigate]);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  const handleFileChosen = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setError("");
    setSuccess("");
    setNotice("");
    if (file && file.size > MAX_BYTES) {
      setError("This file is larger than 10 MB. Choose a smaller file.");
      setSelectedFile(null);
      e.target.value = "";
      return;
    }
    setSelectedFile(file);
  };

  const handleFileUpload = async () => {
    const file = selectedFile;
    if (!file || !supabase) return;

    setUploading(true);
    setError("");
    setSuccess("");
    setNotice("");

    try {
      const portalUser = readPortalUser();
      if (!portalUser) {
        navigate("/patient/login", { replace: true });
        return;
      }

      const storagePath = documentStoragePath(
        portalUser.patientId,
        file.name,
        Date.now(),
      );

      const { error: uploadError } = await supabase.storage
        .from("patient-documents")
        .upload(storagePath, file);

      if (uploadError) throw uploadError;

      // Who uploaded it (upload_source, uploaded_by_user_id) is set by the
      // server, never sent from here.
      const { error: insertError } = await supabase
        .from("patient_documents")
        .insert(
          buildDocumentInsert({
            patientId: portalUser.patientId,
            fileName: file.name,
            fileType: file.type,
            fileSize: file.size,
            documentType: uploadData.documentType,
            description: uploadData.description,
            storagePath,
          }),
        );

      if (insertError) {
        // Do not leave an unlisted copy of a private file in storage. The
        // storage rules allow this only while no document points to the
        // file, so if the row was saved after all, its file is kept.
        await supabase.storage
          .from("patient-documents")
          .remove([storagePath])
          .catch(() => undefined);
        throw insertError;
      }

      setSuccess(`${file.name} was uploaded to your online account.`);
      setUploadData({ documentType: "medical_record", description: "" });
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await loadDocuments();
    } catch (err) {
      logger.error("[DocumentUpload] upload failed:", errorName(err));
      setError(
        isConnectionFailure(err, isDeviceOnline())
          ? "We could not confirm the upload because the connection dropped. When you are back online, reload this page and check your documents before uploading it again."
          : "The document was not uploaded. Try again. If it keeps happening, bring a paper copy to your next visit.",
      );
    } finally {
      setUploading(false);
    }
  };

  // Removal is a soft delete on the server (portal_remove_document): the
  // document leaves the patient's list, the clinic keeps it. Only the
  // patient's own uploads can be removed. Say "removed" only when the server
  // says so.
  const removeDocument = async () => {
    const doc = toDelete;
    if (!doc || !supabase) return;
    setDeleting(true);
    setDeleteError(null);
    setError("");
    setSuccess("");
    setNotice("");

    try {
      const { data, error: removeErr } = await supabase.rpc(
        "portal_remove_document",
        { p_document_id: doc.id },
      );

      if (removeErr) throw removeErr;

      switch (readRemoveResult(data)) {
        case "removed":
        case "already_removed":
          setToDelete(null);
          setSuccess(
            `${doc.name} was removed from your documents. Clinic staff can still see it in your health record.`,
          );
          await loadDocuments();
          return;
        case "clinic_document":
          setDeleteError(
            "This is a clinic record, so it cannot be removed here. If it looks wrong, ask clinic staff.",
          );
          await loadDocuments();
          return;
        case "not_found":
          setToDelete(null);
          setNotice(
            `${doc.name} could not be found in your account. Your list has been refreshed.`,
          );
          await loadDocuments();
          return;
        default:
          setDeleteError(
            "We could not confirm that the document was removed. Reload this page to check your documents.",
          );
      }
    } catch (err) {
      logger.error("[DocumentUpload] remove failed:", errorName(err));
      setDeleteError(
        isConnectionFailure(err, isDeviceOnline())
          ? "We could not confirm the removal because the connection dropped. When you are back online, reload this page to check your documents."
          : "The document was not removed. Try again later. If it keeps happening, ask clinic staff.",
      );
    } finally {
      setDeleting(false);
    }
  };

  const header = (
    <PageHeader
      title="Your documents"
      description="Keep copies of letters, test results or scans in your online account."
    />
  );

  if (!isSupabaseEnabled) {
    return (
      <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
        {header}
        <div className="banner banner-info">
          <InformationCircleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <p>
            Documents are stored in your online account. This device is not
            connected to one, so documents cannot be uploaded or shown here.
            Bring paper copies to your next clinic visit instead.
          </p>
        </div>
      </div>
    );
  }

  if (loading && !hasLoaded) {
    return (
      <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
        {header}
        <span role="status" className="sr-only">
          Loading your documents
        </span>
        <div className="panel p-5" aria-hidden>
          <Skeleton className="mb-4 h-5 w-40" />
          <SkeletonText lines={4} />
        </div>
      </div>
    );
  }

  const canUpload = isOnline && !uploading && !!selectedFile;

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
      {header}

      <div aria-live="polite" className="space-y-3">
        {error && (
          <div className="banner banner-danger" role="alert">
            <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            <p>{error}</p>
          </div>
        )}
        {success && (
          <div className="banner banner-success">
            <CheckCircleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            <p>{success}</p>
          </div>
        )}
        {notice && (
          <div className="banner banner-info">
            <InformationCircleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            <p>{notice}</p>
          </div>
        )}
        {uploading && (
          <p role="status" className="flex items-center gap-2 text-body text-ink-secondary">
            <span
              className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-primary border-t-transparent"
              aria-hidden
            />
            Uploading {selectedFile?.name}…
          </p>
        )}
      </div>

      {!isOnline && (
        <div className="banner banner-warning" role="status">
          <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <p>You are offline. Connect to the internet to upload or remove documents.</p>
        </div>
      )}

      <section className="panel" aria-labelledby="doc-upload-title">
        <div className="panel-header">
          <h2 id="doc-upload-title" className="panel-title">
            Upload a document
          </h2>
        </div>
        <div className="panel-body space-y-4">
          <p className="flex items-start gap-2 text-caption text-ink-muted">
            <InformationCircleIcon className="h-4 w-4 shrink-0" aria-hidden />
            Documents you upload are private health information. They are saved
            to your online account.
          </p>

          <div>
            <label htmlFor="doc-file" className="field-label">
              File
            </label>
            <input
              ref={fileInputRef}
              id="doc-file"
              type="file"
              onChange={handleFileChosen}
              disabled={uploading}
              accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
              aria-describedby="doc-file-hint"
              className="block w-full min-h-touch-target rounded-md border border-line-strong bg-surface px-3 py-2 text-body text-ink file:mr-3 file:rounded-md file:border-0 file:bg-surface-hover file:px-3 file:py-2 file:text-label file:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
            />
            <p id="doc-file-hint" className="field-hint">
              PDF, JPG, PNG, DOC or DOCX. Up to 10 MB.
              {selectedFile ? ` Chosen: ${selectedFile.name} (${formatFileSize(selectedFile.size)}).` : ""}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="doc-type" className="field-label">
                What kind of document is it?
              </label>
              <select
                id="doc-type"
                value={uploadData.documentType}
                onChange={(e) =>
                  setUploadData({ ...uploadData, documentType: e.target.value })
                }
                disabled={uploading}
                className="input-field"
              >
                {DOCUMENT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="doc-description" className="field-label">
                Short description (optional)
              </label>
              <input
                id="doc-description"
                type="text"
                value={uploadData.description}
                onChange={(e) =>
                  setUploadData({ ...uploadData, description: e.target.value })
                }
                disabled={uploading}
                placeholder="For example: blood test from General Hospital"
                className="input-field"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void handleFileUpload()}
              disabled={!canUpload}
              className="btn-primary"
            >
              <DocumentArrowUpIcon className="h-5 w-5" aria-hidden />
              {uploading ? "Uploading…" : "Upload document"}
            </button>
          </div>
        </div>
      </section>

      <section className="panel" aria-labelledby="doc-list-title">
        <div className="panel-header">
          <h2 id="doc-list-title" className="panel-title">
            Documents in your account
          </h2>
          {!loadFailed && (
            <span className="text-caption text-ink-muted tabular-nums">
              {documents.length}
            </span>
          )}
        </div>
        {loadFailed ? (
          <div className="panel-body">
            <div className="banner banner-danger" role="alert">
              <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
              <div className="space-y-3">
                <p>We could not load your list of documents.</p>
                <button
                  type="button"
                  onClick={() => void loadDocuments()}
                  className="btn-secondary"
                >
                  <ArrowPathIcon className="h-5 w-5" aria-hidden />
                  Try again
                </button>
              </div>
            </div>
          </div>
        ) : documents.length === 0 ? (
          <EmptyState
            icon={DocumentArrowUpIcon}
            title="No documents uploaded"
            description="Documents you upload will be listed here."
          />
        ) : (
          <>
            <p className="flex items-start gap-2 px-4 pt-3 text-caption text-ink-muted">
              <InformationCircleIcon className="h-4 w-4 shrink-0" aria-hidden />
              You can remove documents you uploaded. Documents marked
              &ldquo;Clinic record&rdquo; are part of your health record and
              cannot be removed here. If one looks wrong, ask clinic staff.
            </p>
            <ul className="divide-y divide-line">
              {documents.map((doc) => (
                <li key={doc.id} className="flex items-start gap-3 px-4 py-3">
                  <DocumentTextIcon className="mt-0.5 h-6 w-6 shrink-0 text-ink-muted" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-body font-medium text-ink">
                      {doc.name}
                    </p>
                    <p className="text-caption text-ink-muted">
                      {[
                        documentTypeLabel(doc.documentType),
                        doc.fileSize === null ? "" : formatFileSize(doc.fileSize),
                        formatNigerianDate(doc.createdAt),
                      ]
                        .filter((part) => part !== "")
                        .join(" · ")}
                    </p>
                    <p className="mt-1">
                      <span
                        className={
                          doc.source === "patient" ? "badge badge-info" : "badge badge-neutral"
                        }
                      >
                        {documentSourceLabel(doc.source)}
                      </span>
                    </p>
                    {doc.description && (
                      <p className="mt-1 text-body text-ink-secondary">{doc.description}</p>
                    )}
                  </div>
                  {canPatientRemove(doc) && (
                    <button
                      type="button"
                      onClick={() => {
                        setDeleteError(null);
                        setToDelete(doc);
                      }}
                      disabled={!isOnline}
                      aria-label={`Remove ${doc.name}`}
                      className="btn-ghost min-w-touch-target text-danger-fg hover:text-danger-fg"
                    >
                      <TrashIcon className="h-5 w-5" aria-hidden />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <ConfirmDialog
        open={!!toDelete}
        destructive
        title={toDelete ? `Remove ${toDelete.name}?` : ""}
        confirmLabel="Remove document"
        cancelLabel="Keep document"
        busyLabel="Removing…"
        busy={deleting}
        error={deleteError}
        onConfirm={() => void removeDocument()}
        onCancel={() => setToDelete(null)}
      >
        <p>
          It will be removed from your list of documents. Clinic staff can
          still see it in your health record. This cannot be undone from the
          portal.
        </p>
      </ConfirmDialog>
    </div>
  );
}
