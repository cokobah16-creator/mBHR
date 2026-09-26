import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { useNavigate } from "react-router-dom";
import { supabase, isSupabaseEnabled } from "@/lib/supabaseClient";
import * as logger from "@/lib/logger";
import { formatNigerianDate } from "@/utils/dateFormat";
import { useT } from "@/hooks/useT";
import {
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
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
  documentStoragePath,
  isConnectionFailure,
  readRemoveResult,
  visiblePortalDocuments,
  type PortalDocument,
} from "./patientDocuments";

const MAX_BYTES = 10 * 1024 * 1024;

// How long a link to open a stored file works. Short, because anyone with
// the link can open the file until it runs out.
const OPEN_LINK_SECONDS = 60;

// Stored values stay English; only the labels are translated.
const DOCUMENT_TYPES = [
  "medical_record",
  "lab_result",
  "imaging",
  "prescription",
  "insurance",
  "other",
] as const;

function documentTypeLabel(
  t: (key: string, fallback?: string) => string,
  value: string,
): string {
  if ((DOCUMENT_TYPES as readonly string[]).includes(value)) {
    return t(`portal.docs.type.${value}`);
  }
  return value.replace(/_/g, " ");
}

export function DocumentUpload() {
  const navigate = useNavigate();
  const { t } = useT();
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
  const [openingId, setOpeningId] = useState<string | null>(null);

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
      setError(t("portal.docs.tooLarge"));
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

      setSuccess(t("portal.docs.uploaded", { name: file.name }));
      setUploadData({ documentType: "medical_record", description: "" });
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await loadDocuments();
    } catch (err) {
      logger.error("[DocumentUpload] upload failed:", errorName(err));
      setError(
        isConnectionFailure(err, isDeviceOnline())
          ? t("portal.docs.uploadUnconfirmed")
          : t("portal.docs.uploadFailed"),
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
            t("portal.docs.removed", { name: doc.name }),
          );
          await loadDocuments();
          return;
        case "clinic_document":
          setDeleteError(t("portal.docs.clinicRecordNoRemove"));
          await loadDocuments();
          return;
        case "not_found":
          setToDelete(null);
          setNotice(
            t("portal.docs.notFound", { name: doc.name }),
          );
          await loadDocuments();
          return;
        default:
          setDeleteError(t("portal.docs.removeUnknown"));
      }
    } catch (err) {
      logger.error("[DocumentUpload] remove failed:", errorName(err));
      setDeleteError(
        isConnectionFailure(err, isDeviceOnline())
          ? t("portal.docs.removeUnconfirmed")
          : t("portal.docs.removeFailed"),
      );
    } finally {
      setDeleting(false);
    }
  };

  // Opens the stored file through a short-lived private link. The storage
  // rules let a patient read only files in their own folder that they have
  // not removed. The tab is opened first, while the tap still counts, so
  // phones do not block it as a pop-up.
  const openDocument = async (doc: PortalDocument) => {
    if (!supabase || !doc.filePath || openingId) return;
    setOpeningId(doc.id);
    setError("");
    setSuccess("");
    setNotice("");
    const tab = window.open("", "_blank");
    try {
      const { data, error: linkError } = await supabase.storage
        .from("patient-documents")
        .createSignedUrl(doc.filePath, OPEN_LINK_SECONDS);
      if (linkError || !data?.signedUrl) throw linkError ?? new Error("no link");
      if (tab) {
        tab.opener = null;
        tab.location.href = data.signedUrl;
      } else {
        window.location.assign(data.signedUrl);
      }
    } catch (err) {
      tab?.close();
      logger.error("[DocumentUpload] open failed:", errorName(err));
      setError(
        isConnectionFailure(err, isDeviceOnline())
          ? t("portal.docs.openOffline")
          : t("portal.docs.openFailed"),
      );
    } finally {
      setOpeningId(null);
    }
  };

  const header = (
    <PageHeader
      title={t("portal.docs.title")}
      description={t("portal.docs.description")}
    />
  );

  if (!isSupabaseEnabled) {
    return (
      <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
        {header}
        <div className="banner banner-info">
          <InformationCircleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <p>
            {t("portal.docs.notConnected")}
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
          {t("portal.docs.loading")}
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
            {t("portal.docs.uploadingName", { name: selectedFile?.name ?? "" })}
          </p>
        )}
      </div>

      {!isOnline && (
        <div className="banner banner-warning" role="status">
          <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <p>{t("portal.docs.offline")}</p>
        </div>
      )}

      <section className="panel" aria-labelledby="doc-upload-title">
        <div className="panel-header">
          <h2 id="doc-upload-title" className="panel-title">
            {t("portal.docs.uploadTitle")}
          </h2>
        </div>
        <div className="panel-body space-y-4">
          <p className="flex items-start gap-2 text-caption text-ink-muted">
            <InformationCircleIcon className="h-4 w-4 shrink-0" aria-hidden />
            {t("portal.docs.privateNote")}
          </p>

          <div>
            <label htmlFor="doc-file" className="field-label">
              {t("portal.docs.fileLabel")}
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
              {t("portal.docs.fileHint")}
              {selectedFile
                ? ` ${t("portal.docs.chosen", {
                    name: selectedFile.name,
                    size: formatFileSize(selectedFile.size),
                  })}`
                : ""}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="doc-type" className="field-label">
                {t("portal.docs.typeLabel")}
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
                {DOCUMENT_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {documentTypeLabel(t, value)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="doc-description" className="field-label">
                {t("portal.docs.descLabel")}
              </label>
              <input
                id="doc-description"
                type="text"
                value={uploadData.description}
                onChange={(e) =>
                  setUploadData({ ...uploadData, description: e.target.value })
                }
                disabled={uploading}
                placeholder={t("portal.docs.descPlaceholder")}
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
              {uploading ? t("portal.docs.uploading") : t("portal.docs.upload")}
            </button>
          </div>
        </div>
      </section>

      <section className="panel" aria-labelledby="doc-list-title">
        <div className="panel-header">
          <h2 id="doc-list-title" className="panel-title">
            {t("portal.docs.listTitle")}
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
                <p>{t("portal.docs.loadFailed")}</p>
                <button
                  type="button"
                  onClick={() => void loadDocuments()}
                  className="btn-secondary"
                >
                  <ArrowPathIcon className="h-5 w-5" aria-hidden />
                  {t("portal.error.retry")}
                </button>
              </div>
            </div>
          </div>
        ) : documents.length === 0 ? (
          <EmptyState
            icon={DocumentArrowUpIcon}
            title={t("portal.docs.emptyTitle")}
            description={t("portal.docs.emptyBody")}
          />
        ) : (
          <>
            <p className="flex items-start gap-2 px-4 pt-3 text-caption text-ink-muted">
              <InformationCircleIcon className="h-4 w-4 shrink-0" aria-hidden />
              {t("portal.docs.removeHint")}
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
                        documentTypeLabel(t, doc.documentType),
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
                        {t(`portal.docs.source.${doc.source}`)}
                      </span>
                    </p>
                    {doc.description && (
                      <p className="mt-1 text-body text-ink-secondary">{doc.description}</p>
                    )}
                  </div>
                  {doc.filePath && (
                    <button
                      type="button"
                      onClick={() => void openDocument(doc)}
                      disabled={!isOnline || openingId !== null}
                      aria-label={t("portal.docs.openName", { name: doc.name })}
                      className="btn-ghost min-w-touch-target"
                    >
                      <ArrowTopRightOnSquareIcon className="h-5 w-5" aria-hidden />
                      <span className="sr-only sm:not-sr-only">
                        {openingId === doc.id ? t("portal.docs.opening") : t("portal.docs.open")}
                      </span>
                    </button>
                  )}
                  {canPatientRemove(doc) && (
                    <button
                      type="button"
                      onClick={() => {
                        setDeleteError(null);
                        setToDelete(doc);
                      }}
                      disabled={!isOnline}
                      aria-label={t("portal.docs.removeName", { name: doc.name })}
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
        title={toDelete ? t("portal.docs.removeTitle", { name: toDelete.name }) : ""}
        confirmLabel={t("portal.docs.removeConfirm")}
        cancelLabel={t("portal.docs.keep")}
        busyLabel={t("portal.docs.removing")}
        busy={deleting}
        error={deleteError}
        onConfirm={() => void removeDocument()}
        onCancel={() => setToDelete(null)}
      >
        <p>
          {t("portal.docs.removeBody")}
        </p>
      </ConfirmDialog>
    </div>
  );
}
