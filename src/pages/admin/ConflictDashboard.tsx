import { useState, useEffect, useCallback } from "react";
import {
  ExclamationTriangleIcon,
  ShieldExclamationIcon,
  CheckCircleIcon,
  ClockIcon,
  FunnelIcon,
  ArrowPathIcon,
  MagnifyingGlassIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DocumentDuplicateIcon,
  ArrowsRightLeftIcon,
  SparklesIcon,
  UserGroupIcon,
  ClipboardDocumentListIcon,
  UserCircleIcon,
} from "@heroicons/react/24/outline";
import { useAuthStore } from "@/stores/auth";
import {
  conflictQueueService,
  type ConflictResolution,
  type ConflictType,
  type ConflictPriority,
  type FieldChangeDelta,
} from "@/services/conflictQueue";
import {
  ConflictComparisonCard,
  ConflictResolutionActions,
} from "@/components/ConflictComparisonCard";
import { db } from "@/db";
import { getRoleDisplayName, type Role } from "@/auth/roles";
import { useToast } from "@/stores/toast";

type TabType = "pending" | "needs_approval" | "resolved";

const CONFLICT_TYPE_LABELS: Record<
  ConflictType,
  { label: string; icon: typeof DocumentDuplicateIcon }
> = {
  duplicate: { label: "Duplicate Record", icon: DocumentDuplicateIcon },
  sync_conflict: { label: "Sync Conflict", icon: ArrowsRightLeftIcon },
  data_quality: { label: "Data Quality", icon: ExclamationTriangleIcon },
};

const ENTITY_TYPE_LABELS: Record<string, string> = {
  patients: "Patient",
  vitals: "Vitals",
  consultations: "Consultation",
  dispenses: "Dispense",
  visits: "Visit",
};

interface ConflictStats {
  pending: number;
  needsApproval: number;
  resolvedToday: number;
  autoResolvedToday: number;
  byPriority: Record<ConflictPriority, number>;
  byType: Record<ConflictType, number>;
}

type DetailTab = "comparison" | "audit_history";

const REQUIRED_ROLE_LABELS: Record<string, { label: string; color: string }> = {
  lead_clinician: {
    label: "Lead Clinician",
    color: "bg-teal-100 text-teal-800",
  },
  auditor: { label: "Auditor", color: "bg-amber-100 text-amber-800" },
  admin: { label: "Admin", color: "bg-slate-100 text-slate-800" },
};

export default function ConflictDashboard() {
  const { currentUser } = useAuthStore();
  const { push: pushToast } = useToast();
  const [activeTab, setActiveTab] = useState<TabType>("pending");
  const [conflicts, setConflicts] = useState<ConflictResolution[]>([]);
  const [stats, setStats] = useState<ConflictStats | null>(null);
  const [selectedConflict, setSelectedConflict] =
    useState<ConflictResolution | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [isResolving, setIsResolving] = useState(false);
  const [isScanning, setIsScanning] = useState(false);

  const [filters, setFilters] = useState({
    entityType: "",
    conflictType: "" as ConflictType | "",
    priority: "" as ConflictPriority | "",
  });
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const pageSize = 20;

  const [selectedResolutions, setSelectedResolutions] = useState<
    Record<string, "local" | "remote">
  >({});
  const [justification, setJustification] = useState("");
  const [detailTab, setDetailTab] = useState<DetailTab>("comparison");
  const [auditHistory, setAuditHistory] = useState<
    Array<{
      id: string;
      action: string;
      actorId?: string;
      actorRole?: string;
      fieldChanges: Record<string, unknown>;
      justification?: string;
      createdAt: string;
    }>
  >([]);
  const [fieldDeltas, setFieldDeltas] = useState<FieldChangeDelta[]>([]);
  const [approvalEligibility, setApprovalEligibility] = useState<{
    canApprove: boolean;
    requiredRole: string | null;
    needsSecondApproval: boolean;
    hasFirstApproval: boolean;
    reason?: string;
  } | null>(null);
  const [approvalError, setApprovalError] = useState<string | null>(null);

  const loadConflicts = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await conflictQueueService.getPendingConflicts({
        entityType: filters.entityType || undefined,
        conflictType: filters.conflictType || undefined,
        priority: filters.priority || undefined,
        limit: pageSize,
        offset: page * pageSize,
      });
      setConflicts(result.conflicts);
      setTotal(result.total);
    } catch (error) {
      console.error("Failed to load conflicts:", error);
    } finally {
      setIsLoading(false);
    }
  }, [filters, page]);

  const loadStats = useCallback(async () => {
    try {
      const s = await conflictQueueService.getConflictStats();
      setStats(s);
    } catch (error) {
      console.error("Failed to load stats:", error);
    }
  }, []);

  useEffect(() => {
    loadConflicts();
    loadStats();
  }, [loadConflicts, loadStats]);

  const handleScanForDuplicates = async () => {
    setIsScanning(true);
    try {
      const result = await conflictQueueService.scanForDuplicates(50);
      if (result.found > 0) {
        await loadConflicts();
        await loadStats();
      }
      const skippedMessage =
        result.skipped > 0
          ? ` Skipped ${result.skipped} record${result.skipped !== 1 ? "s" : ""} with invalid data.`
          : "";
      pushToast({
        id: `duplicate-scan-${Date.now()}`,
        title: "Duplicate scan complete",
        body: `Found ${result.found} new potential duplicate${result.found !== 1 ? "s" : ""}.${skippedMessage}`,
      });
      alert(
        `Scan complete. Found ${found} new potential duplicate${found !== 1 ? "s" : ""}.`,
      );
    } catch (error) {
      console.error("Scan failed:", error);
      pushToast({
        id: `duplicate-scan-error-${Date.now()}`,
        title: "Duplicate scan failed",
        body: "Please try again.",
      });
    } finally {
      setIsScanning(false);
    }
  };

  const handleSelectConflict = async (conflict: ConflictResolution) => {
    setSelectedConflict(conflict);
    setSelectedResolutions({});
    setJustification("");
    setDetailTab("comparison");
    setApprovalError(null);

    const [history, deltas] = await Promise.all([
      conflictQueueService.getAuditHistory(conflict.id),
      conflictQueueService.getFieldDeltas(conflict.id),
    ]);
    setAuditHistory(history);
    setFieldDeltas(deltas);

    if (currentUser && conflict.status === "needs_approval") {
      const eligibility = await conflictQueueService.checkApprovalEligibility(
        conflict.id,
        currentUser.role as Role,
      );
      setApprovalEligibility(eligibility);
    } else {
      setApprovalEligibility(null);
    }
  };

  const handleFieldSelect = (field: string, choice: "local" | "remote") => {
    setSelectedResolutions((prev) => ({ ...prev, [field]: choice }));
  };

  const handleResolve = async (
    strategy: "keep_local" | "keep_remote" | "manual" | "ignore",
  ) => {
    if (!selectedConflict || !currentUser) return;

    setIsResolving(true);
    setApprovalError(null);
    try {
      const resolutionDetails: Record<string, unknown> =
        strategy === "manual" ? { fieldResolutions: selectedResolutions } : {};

      const success = await conflictQueueService.resolveConflict({
        conflictId: selectedConflict.id,
        strategy,
        resolutionDetails,
        resolvedBy: currentUser.id,
        resolverRole: currentUser.role as Role,
        justification: justification || undefined,
      });

      if (success) {
        if (
          selectedConflict.conflictType === "duplicate" &&
          strategy !== "ignore"
        ) {
          const winnerId =
            strategy === "keep_local"
              ? selectedConflict.entityId
              : selectedConflict.candidateIds[0];
          const loserId =
            strategy === "keep_local"
              ? selectedConflict.candidateIds[0]
              : selectedConflict.entityId;

          if (winnerId && loserId) {
            try {
              const winner = await db.patients.get(winnerId);
              const loser = await db.patients.get(loserId);

              if (winner && loser) {
                await db.patients.update(loserId, {
                  mergeInto: winnerId,
                  updatedAt: new Date(),
                  _dirty: 1,
                });
              }
            } catch {
              console.warn("Could not merge local patient records");
            }
          }
        }

        setSelectedConflict(null);
        await loadConflicts();
        await loadStats();
      }
    } catch (error) {
      console.error("Resolution failed:", error);
    } finally {
      setIsResolving(false);
    }
  };

  const handleBulkResolve = async (
    strategy: "keep_local" | "keep_remote" | "ignore",
  ) => {
    if (selectedIds.size === 0 || !currentUser) return;

    setIsResolving(true);
    try {
      const result = await conflictQueueService.bulkResolve({
        conflictIds: Array.from(selectedIds),
        strategy,
        resolvedBy: currentUser.id,
        justification: "Bulk resolution",
      });

      alert(`Resolved ${result.success} conflicts. ${result.failed} failed.`);
      setSelectedIds(new Set());
      await loadConflicts();
      await loadStats();
    } catch (error) {
      console.error("Bulk resolution failed:", error);
    } finally {
      setIsResolving(false);
    }
  };

  const handleApprove = async (
    conflictId: string,
    isSecondApproval = false,
  ) => {
    if (!currentUser) return;

    setIsResolving(true);
    setApprovalError(null);
    try {
      const result = await conflictQueueService.approveResolution({
        conflictId,
        approvedBy: currentUser.id,
        approverRole: currentUser.role as Role,
        justification,
        isSecondApproval,
      });

      if (!result.success) {
        setApprovalError(result.error || "Approval failed");
        return;
      }

      if (result.needsSecondApproval) {
        setApprovalError(null);
        alert(
          "First approval recorded. A second approver is required to complete this resolution.",
        );
        setSelectedConflict(null);
      } else {
        setSelectedConflict(null);
      }

      await loadConflicts();
      await loadStats();
    } catch (error) {
      console.error("Approval failed:", error);
      setApprovalError("An unexpected error occurred");
    } finally {
      setIsResolving(false);
    }
  };

  const handleReject = async (conflictId: string, reason: string) => {
    if (!currentUser) return;

    setIsResolving(true);
    try {
      await conflictQueueService.rejectResolution({
        conflictId,
        rejectedBy: currentUser.id,
        reason,
      });
      await loadConflicts();
      await loadStats();
    } catch (error) {
      console.error("Rejection failed:", error);
    } finally {
      setIsResolving(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === conflicts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(conflicts.map((c) => c.id)));
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Conflict Resolution Center
            </h1>
            <p className="text-gray-600">
              Manage duplicate records and sync conflicts with PHI-aware
              resolution
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleScanForDuplicates}
              disabled={isScanning}
              className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors"
            >
              <MagnifyingGlassIcon
                className={`h-5 w-5 ${isScanning ? "animate-pulse" : ""}`}
              />
              {isScanning ? "Scanning..." : "Scan for Duplicates"}
            </button>
            <button
              onClick={() => {
                loadConflicts();
                loadStats();
              }}
              className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <ArrowPathIcon className="h-5 w-5" />
            </button>
          </div>
        </div>

        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-lg border p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-100 rounded-lg">
                  <ClockIcon className="h-6 w-6 text-amber-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-gray-900">
                    {stats.pending}
                  </p>
                  <p className="text-sm text-gray-600">Pending</p>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-lg border p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-red-100 rounded-lg">
                  <ShieldExclamationIcon className="h-6 w-6 text-red-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-gray-900">
                    {stats.needsApproval}
                  </p>
                  <p className="text-sm text-gray-600">Needs Approval</p>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-lg border p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-100 rounded-lg">
                  <CheckCircleIcon className="h-6 w-6 text-green-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-gray-900">
                    {stats.resolvedToday}
                  </p>
                  <p className="text-sm text-gray-600">Resolved Today</p>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-lg border p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 rounded-lg">
                  <SparklesIcon className="h-6 w-6 text-blue-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-gray-900">
                    {stats.autoResolvedToday}
                  </p>
                  <p className="text-sm text-gray-600">Auto-Resolved</p>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="bg-white rounded-lg border shadow-sm">
          <div className="border-b">
            <div className="flex items-center justify-between px-4">
              <div className="flex">
                <button
                  onClick={() => setActiveTab("pending")}
                  className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === "pending"
                      ? "border-blue-600 text-blue-600"
                      : "border-transparent text-gray-600 hover:text-gray-900"
                  }`}
                >
                  Pending ({stats?.pending || 0})
                </button>
                <button
                  onClick={() => setActiveTab("needs_approval")}
                  className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === "needs_approval"
                      ? "border-blue-600 text-blue-600"
                      : "border-transparent text-gray-600 hover:text-gray-900"
                  }`}
                >
                  Needs Approval ({stats?.needsApproval || 0})
                </button>
                <button
                  onClick={() => setActiveTab("resolved")}
                  className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === "resolved"
                      ? "border-blue-600 text-blue-600"
                      : "border-transparent text-gray-600 hover:text-gray-900"
                  }`}
                >
                  Resolved Today ({stats?.resolvedToday || 0})
                </button>
              </div>

              <div className="flex items-center gap-2 py-2">
                <FunnelIcon className="h-4 w-4 text-gray-400" />
                <select
                  value={filters.entityType}
                  onChange={(e) =>
                    setFilters((prev) => ({
                      ...prev,
                      entityType: e.target.value,
                    }))
                  }
                  className="text-sm border-gray-300 rounded-md"
                >
                  <option value="">All Types</option>
                  <option value="patients">Patients</option>
                  <option value="vitals">Vitals</option>
                  <option value="consultations">Consultations</option>
                </select>
                <select
                  value={filters.conflictType}
                  onChange={(e) =>
                    setFilters((prev) => ({
                      ...prev,
                      conflictType: e.target.value as ConflictType | "",
                    }))
                  }
                  className="text-sm border-gray-300 rounded-md"
                >
                  <option value="">All Conflicts</option>
                  <option value="duplicate">Duplicates</option>
                  <option value="sync_conflict">Sync Conflicts</option>
                  <option value="data_quality">Data Quality</option>
                </select>
                <select
                  value={filters.priority}
                  onChange={(e) =>
                    setFilters((prev) => ({
                      ...prev,
                      priority: e.target.value as ConflictPriority | "",
                    }))
                  }
                  className="text-sm border-gray-300 rounded-md"
                >
                  <option value="">All Priorities</option>
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </div>
            </div>
          </div>

          {selectedIds.size > 0 && (
            <div className="px-4 py-3 bg-blue-50 border-b flex items-center justify-between">
              <span className="text-sm text-blue-800">
                {selectedIds.size} conflict{selectedIds.size !== 1 ? "s" : ""}{" "}
                selected
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleBulkResolve("keep_local")}
                  disabled={isResolving}
                  className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  Keep Local
                </button>
                <button
                  onClick={() => handleBulkResolve("keep_remote")}
                  disabled={isResolving}
                  className="px-3 py-1.5 text-sm bg-teal-600 text-white rounded-md hover:bg-teal-700 disabled:opacity-50"
                >
                  Keep Remote
                </button>
                <button
                  onClick={() => handleBulkResolve("ignore")}
                  disabled={isResolving}
                  className="px-3 py-1.5 text-sm border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 disabled:opacity-50"
                >
                  Ignore All
                </button>
              </div>
            </div>
          )}

          {isLoading ? (
            <div className="p-8 text-center">
              <ArrowPathIcon className="h-8 w-8 animate-spin text-gray-400 mx-auto mb-2" />
              <p className="text-gray-600">Loading conflicts...</p>
            </div>
          ) : conflicts.length === 0 ? (
            <div className="p-8 text-center">
              <CheckCircleIcon className="h-12 w-12 text-green-400 mx-auto mb-3" />
              <h3 className="text-lg font-medium text-gray-900 mb-1">
                No Conflicts Found
              </h3>
              <p className="text-gray-600">
                All records are synchronized and no duplicates detected.
              </p>
            </div>
          ) : (
            <>
              <div className="divide-y">
                <div className="px-4 py-2 bg-gray-50 flex items-center text-xs font-medium text-gray-500 uppercase tracking-wide">
                  <div className="w-8">
                    <input
                      type="checkbox"
                      checked={selectedIds.size === conflicts.length}
                      onChange={toggleSelectAll}
                      className="rounded border-gray-300"
                    />
                  </div>
                  <div className="flex-1">Conflict</div>
                  <div className="w-32">Priority</div>
                  <div className="w-32">PHI Level</div>
                  <div className="w-40">Created</div>
                </div>

                {conflicts.map((conflict) => {
                  const typeConfig =
                    CONFLICT_TYPE_LABELS[conflict.conflictType];
                  const TypeIcon = typeConfig.icon;

                  return (
                    <div
                      key={conflict.id}
                      className={`px-4 py-3 hover:bg-gray-50 cursor-pointer flex items-center ${
                        selectedConflict?.id === conflict.id ? "bg-blue-50" : ""
                      }`}
                      onClick={() => handleSelectConflict(conflict)}
                    >
                      <div
                        className="w-8"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleSelect(conflict.id);
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={selectedIds.has(conflict.id)}
                          onChange={() => {}}
                          className="rounded border-gray-300"
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <TypeIcon className="h-5 w-5 text-gray-400" />
                          <span className="font-medium text-gray-900">
                            {ENTITY_TYPE_LABELS[conflict.entityType] ||
                              conflict.entityType}
                          </span>
                          <span className="text-gray-500">-</span>
                          <span className="text-sm text-gray-600">
                            {typeConfig.label}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 truncate mt-0.5">
                          ID: {conflict.entityId.slice(0, 8)}...
                          {conflict.candidateIds.length > 0 && (
                            <span className="ml-2">
                              <UserGroupIcon className="h-3 w-3 inline" />{" "}
                              {conflict.candidateIds.length} candidate
                              {conflict.candidateIds.length !== 1 ? "s" : ""}
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="w-32">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                            conflict.priority === "critical"
                              ? "bg-red-100 text-red-800"
                              : conflict.priority === "high"
                                ? "bg-orange-100 text-orange-800"
                                : conflict.priority === "medium"
                                  ? "bg-yellow-100 text-yellow-800"
                                  : "bg-gray-100 text-gray-700"
                          }`}
                        >
                          {conflict.priority}
                        </span>
                      </div>
                      <div className="w-32">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                            conflict.phiSensitivity === "high"
                              ? "bg-red-100 text-red-800"
                              : conflict.phiSensitivity === "medium"
                                ? "bg-amber-100 text-amber-800"
                                : conflict.phiSensitivity === "low"
                                  ? "bg-blue-100 text-blue-800"
                                  : "bg-gray-100 text-gray-700"
                          }`}
                        >
                          {conflict.phiSensitivity === "high" && (
                            <ShieldExclamationIcon className="h-3 w-3" />
                          )}
                          {conflict.phiSensitivity}
                        </span>
                      </div>
                      <div className="w-40 text-sm text-gray-500">
                        {new Date(conflict.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="px-4 py-3 border-t flex items-center justify-between">
                <p className="text-sm text-gray-600">
                  Showing {page * pageSize + 1}-
                  {Math.min((page + 1) * pageSize, total)} of {total}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="p-1 rounded-md hover:bg-gray-100 disabled:opacity-50"
                  >
                    <ChevronLeftIcon className="h-5 w-5" />
                  </button>
                  <button
                    onClick={() => setPage((p) => p + 1)}
                    disabled={(page + 1) * pageSize >= total}
                    className="p-1 rounded-md hover:bg-gray-100 disabled:opacity-50"
                  >
                    <ChevronRightIcon className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {selectedConflict && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
              <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between z-10">
                <div>
                  <div className="flex items-center gap-3">
                    <h2 className="text-lg font-bold text-gray-900">
                      Resolve{" "}
                      {
                        CONFLICT_TYPE_LABELS[selectedConflict.conflictType]
                          .label
                      }
                    </h2>
                    {selectedConflict.requiredApproverRole && (
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${REQUIRED_ROLE_LABELS[selectedConflict.requiredApproverRole]?.color || "bg-gray-100 text-gray-700"}`}
                      >
                        <UserCircleIcon className="h-3.5 w-3.5" />
                        Requires{" "}
                        {REQUIRED_ROLE_LABELS[
                          selectedConflict.requiredApproverRole
                        ]?.label || selectedConflict.requiredApproverRole}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-600">
                    {ENTITY_TYPE_LABELS[selectedConflict.entityType]} - ID:{" "}
                    {selectedConflict.entityId.slice(0, 12)}...
                  </p>
                  {selectedConflict.escalationReason && (
                    <p className="text-xs text-amber-700 mt-1 flex items-center gap-1">
                      <ExclamationTriangleIcon className="h-3.5 w-3.5" />
                      {selectedConflict.escalationReason}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => setSelectedConflict(null)}
                  className="p-2 hover:bg-gray-100 rounded-lg"
                >
                  <ChevronLeftIcon className="h-5 w-5" />
                </button>
              </div>

              <div className="border-b px-6">
                <div className="flex gap-4">
                  <button
                    onClick={() => setDetailTab("comparison")}
                    className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                      detailTab === "comparison"
                        ? "border-blue-600 text-blue-600"
                        : "border-transparent text-gray-600 hover:text-gray-900"
                    }`}
                  >
                    Field Comparison
                  </button>
                  <button
                    onClick={() => setDetailTab("audit_history")}
                    className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
                      detailTab === "audit_history"
                        ? "border-blue-600 text-blue-600"
                        : "border-transparent text-gray-600 hover:text-gray-900"
                    }`}
                  >
                    <ClipboardDocumentListIcon className="h-4 w-4" />
                    Audit History ({auditHistory.length})
                  </button>
                </div>
              </div>

              <div className="p-6 space-y-6">
                {detailTab === "comparison" ? (
                  <>
                    <ConflictComparisonCard
                      fields={selectedConflict.conflictDetails.fields}
                      localTimestamp={
                        selectedConflict.conflictDetails.localTimestamp
                      }
                      remoteTimestamp={
                        selectedConflict.conflictDetails.remoteTimestamp
                      }
                      matchScore={selectedConflict.conflictDetails.matchScore}
                      matchReasons={
                        selectedConflict.conflictDetails.matchReasons
                      }
                      priority={selectedConflict.priority}
                      phiSensitivity={selectedConflict.phiSensitivity}
                      selectedResolutions={selectedResolutions}
                      onFieldSelect={handleFieldSelect}
                    />

                    {fieldDeltas.length > 0 && (
                      <div className="border rounded-lg p-4">
                        <h4 className="text-sm font-medium text-gray-900 mb-3">
                          Previous Field Changes
                        </h4>
                        <div className="space-y-2">
                          {fieldDeltas.map((delta) => (
                            <div
                              key={delta.id}
                              className="flex items-start gap-3 text-sm"
                            >
                              <span
                                className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                                  delta.changeType === "merge"
                                    ? "bg-blue-100 text-blue-700"
                                    : delta.changeType === "override"
                                      ? "bg-amber-100 text-amber-700"
                                      : delta.changeType === "correction"
                                        ? "bg-green-100 text-green-700"
                                        : "bg-gray-100 text-gray-700"
                                }`}
                              >
                                {delta.changeType}
                              </span>
                              <div className="flex-1">
                                <span className="font-medium">
                                  {delta.fieldName}
                                </span>
                                {delta.phiField && (
                                  <ShieldExclamationIcon className="h-3.5 w-3.5 inline ml-1 text-red-500" />
                                )}
                                <span className="text-gray-500 mx-1">:</span>
                                <span className="text-gray-600">
                                  {String(delta.oldValue || "-")} →{" "}
                                  {String(delta.newValue || "-")}
                                </span>
                              </div>
                              <span className="text-xs text-gray-400">
                                {new Date(delta.createdAt).toLocaleString()}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="space-y-4">
                    {auditHistory.length === 0 ? (
                      <p className="text-center text-gray-500 py-8">
                        No audit history available
                      </p>
                    ) : (
                      <div className="space-y-3">
                        {auditHistory.map((entry) => (
                          <div key={entry.id} className="border rounded-lg p-4">
                            <div className="flex items-start justify-between">
                              <div>
                                <span
                                  className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                                    entry.action === "created"
                                      ? "bg-blue-100 text-blue-800"
                                      : entry.action === "resolved"
                                        ? "bg-green-100 text-green-800"
                                        : entry.action === "approved"
                                          ? "bg-teal-100 text-teal-800"
                                          : entry.action === "rejected"
                                            ? "bg-red-100 text-red-800"
                                            : entry.action === "auto_resolved"
                                              ? "bg-amber-100 text-amber-800"
                                              : "bg-gray-100 text-gray-700"
                                  }`}
                                >
                                  {entry.action.replace("_", " ")}
                                </span>
                                {entry.actorRole && (
                                  <span className="ml-2 text-sm text-gray-600">
                                    by{" "}
                                    {getRoleDisplayName(
                                      entry.actorRole as Role,
                                    )}
                                  </span>
                                )}
                              </div>
                              <span className="text-xs text-gray-500">
                                {new Date(entry.createdAt).toLocaleString()}
                              </span>
                            </div>
                            {entry.justification && (
                              <p className="mt-2 text-sm text-gray-700 italic">
                                "{entry.justification}"
                              </p>
                            )}
                            {Object.keys(entry.fieldChanges).length > 0 &&
                              entry.action !== "viewed" && (
                                <div className="mt-2 text-xs text-gray-500">
                                  Details:{" "}
                                  {JSON.stringify(entry.fieldChanges).slice(
                                    0,
                                    100,
                                  )}
                                  ...
                                </div>
                              )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {selectedConflict.phiSensitivity === "high" && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Justification (required for high PHI)
                    </label>
                    <textarea
                      value={justification}
                      onChange={(e) => setJustification(e.target.value)}
                      rows={2}
                      className="w-full px-3 py-2 border rounded-lg text-sm"
                      placeholder="Explain why this resolution is appropriate..."
                    />
                  </div>
                )}

                {approvalError && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                    {approvalError}
                  </div>
                )}

                {selectedConflict.status === "needs_approval" ? (
                  <div className="space-y-3">
                    {approvalEligibility && !approvalEligibility.canApprove && (
                      <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                        <strong>Cannot Approve:</strong>{" "}
                        {approvalEligibility.reason}
                      </div>
                    )}

                    {approvalEligibility?.needsSecondApproval &&
                      approvalEligibility.hasFirstApproval && (
                        <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
                          <strong>Dual Approval Required:</strong> First
                          approval has been recorded. You are providing the
                          second approval.
                        </div>
                      )}

                    <div className="flex gap-3">
                      <button
                        onClick={() =>
                          handleApprove(
                            selectedConflict.id,
                            approvalEligibility?.hasFirstApproval,
                          )
                        }
                        disabled={
                          isResolving ||
                          (approvalEligibility &&
                            !approvalEligibility.canApprove)
                        }
                        className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium"
                      >
                        {approvalEligibility?.hasFirstApproval
                          ? "Provide Second Approval"
                          : "Approve Resolution"}
                      </button>
                      <button
                        onClick={() =>
                          handleReject(
                            selectedConflict.id,
                            justification || "No reason provided",
                          )
                        }
                        disabled={isResolving}
                        className="flex-1 px-4 py-2 border border-red-300 text-red-700 rounded-lg hover:bg-red-50 disabled:opacity-50 font-medium"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ) : (
                  <ConflictResolutionActions
                    onKeepLocal={() => handleResolve("keep_local")}
                    onKeepRemote={() => handleResolve("keep_remote")}
                    onManualResolve={() => handleResolve("manual")}
                    onIgnore={() => handleResolve("ignore")}
                    isResolving={isResolving}
                    hasManualSelections={
                      Object.keys(selectedResolutions).length > 0
                    }
                    requiresApproval={
                      selectedConflict.requiredApproverRole !== null &&
                      selectedConflict.requiredApproverRole !== undefined
                    }
                  />
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
