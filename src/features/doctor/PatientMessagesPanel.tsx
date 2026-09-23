import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent, ReactNode } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/stores/toast";
import { createAuditLog, db, generateId } from "@/db";
import {
  archivePatientThread,
  deletePatientThread,
  listActivePatientMessages,
  markPatientMessagesRead,
  searchPatientsByName,
  sendDoctorMessage,
  type PatientSearchResult,
  type PatientSecureMessage,
} from "@/services/patientSecureMessaging";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  ArchiveBoxIcon,
  ExclamationTriangleIcon,
  InboxIcon,
  MagnifyingGlassIcon,
  PaperAirplaneIcon,
  PencilSquareIcon,
  SignalSlashIcon,
  TrashIcon,
  UserCircleIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import {
  POLL_SECONDS,
  buildPatientThreads,
  canMessagePatients,
  describeMessagingError,
  errorName,
  formatClock,
  replySubject,
  summariseConnection,
} from "./messagingModel";
import {
  newMessageRowId,
  patientDrafts,
  patientUnsent,
  type PatientMessageParams,
  type UnsentMessage,
} from "./unsentMessages";
import { isDeviceOnline, useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useLiveMessageUpdates } from "./useLiveMessageUpdates";
import { usePanelFocus } from "./usePanelFocus";
import {
  ConnectionBar,
  MessageTime,
  PanelHeader,
  SentStatus,
  ThreadListSkeleton,
  UnsentStatus,
} from "./MessagingParts";

type View = "inbox" | "conversation" | "compose";
type Unsent = UnsentMessage<PatientMessageParams>;

/** Patient messages are stored on the online service only. */
const CONFIGURED = supabase !== null;
const LIVE_SOURCES = [{ table: "patient_secure_messages" }];

interface ActivePatient {
  id: string;
  name: string;
}

interface PatientMessagesPanelProps {
  onClose?: () => void;
  onUnreadChange?: (count: number) => void;
}

/** An error that says the server changed nothing (see describeMessagingError). */
function nothingChanged(): Error {
  return Object.assign(new Error("Nothing was changed."), {
    reason: "no_rows",
  });
}

/**
 * Clinician inbox for messages patients send from the patient portal.
 * Unread threads come first, then threads waiting for a reply. Messages are
 * kept on the online service only; the panel says so when that matters.
 */
export function PatientMessagesPanel({
  onClose,
  onUnreadChange,
}: PatientMessagesPanelProps) {
  const currentUser = useAuthStore((s) => s.currentUser);
  const { push } = useToast();
  const userId = currentUser?.id;
  const role = currentUser?.role;
  const mayReply = canMessagePatients(role);
  const online = useOnlineStatus();

  const uid = useId();
  const headingId = `${uid}-title`;
  const rootRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  usePanelFocus(rootRef, headingRef, !!onClose, onClose);

  const [view, setView] = useState<View>("inbox");
  const [messages, setMessages] = useState<PatientSecureMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null);
  const [localNames, setLocalNames] = useState<Map<string, string>>(
    () => new Map(),
  );
  const [localRecordIds, setLocalRecordIds] = useState<Set<string>>(
    () => new Set(),
  );

  const [active, setActive] = useState<ActivePatient | null>(null);
  const [reply, setReply] = useState("");
  const [replyError, setReplyError] = useState("");

  // Compose
  const [patientSearch, setPatientSearch] = useState("");
  const [patientResults, setPatientResults] = useState<PatientSearchResult[]>(
    [],
  );
  const [selectedPatient, setSelectedPatient] =
    useState<PatientSearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [composeErrors, setComposeErrors] = useState<
    Partial<Record<"patient" | "subject" | "body", string>>
  >({});

  const [actionError, setActionError] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [unsent, setUnsent] = useState<Unsent[]>(() =>
    userId ? patientUnsent.list(userId) : [],
  );

  // ── Loading ────────────────────────────────────────────────────────────────
  // Polling, live updates and post-action reloads can overlap; only the
  // newest request may update the screen.
  const loadSeq = useRef(0);
  const loadMessages = useCallback(async () => {
    if (!CONFIGURED || !isDeviceOnline()) {
      setLoading(false);
      return;
    }
    const seq = ++loadSeq.current;
    setRefreshing(true);
    try {
      const list = await listActivePatientMessages();
      if (seq !== loadSeq.current) return;
      setMessages(list);
      setHasLoaded(true);
      setLoadError("");
      setLastCheckedAt(new Date());
    } catch (err) {
      if (seq !== loadSeq.current) return;
      console.warn("[patient-messages] Load failed:", errorName(err));
      setLoadError(
        describeMessagingError(err, "load patient messages", isDeviceOnline()),
      );
    } finally {
      if (seq === loadSeq.current) {
        setRefreshing(false);
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadMessages();
    const timer = setInterval(() => void loadMessages(), POLL_SECONDS * 1000);
    return () => clearInterval(timer);
  }, [loadMessages]);

  const wasOnline = useRef(online);
  useEffect(() => {
    if (online && !wasOnline.current) void loadMessages();
    wasOnline.current = online;
  }, [online, loadMessages]);

  const live = useLiveMessageUpdates(
    "staff_patient_messages",
    LIVE_SOURCES,
    CONFIGURED && online,
    loadMessages,
  );

  // Names and record links from the records on this device.
  const activeId = active?.id ?? null;
  const lookupKey = useMemo(() => {
    const ids = new Set(messages.map((m) => m.patient_id));
    if (activeId) ids.add(activeId);
    return [...ids].sort().join(",");
  }, [messages, activeId]);

  useEffect(() => {
    if (!lookupKey) {
      setLocalNames(new Map());
      setLocalRecordIds(new Set());
      return;
    }
    let cancelled = false;
    const ids = lookupKey.split(",");
    db.patients
      .bulkGet(ids)
      .then((rows) => {
        if (cancelled) return;
        const names = new Map<string, string>();
        const found = new Set<string>();
        rows.forEach((p, i) => {
          if (!p) return;
          found.add(ids[i]);
          const name = `${p.givenName ?? ""} ${p.familyName ?? ""}`.trim();
          if (name) names.set(ids[i], name);
        });
        setLocalNames(names);
        setLocalRecordIds(found);
      })
      .catch((err) =>
        console.warn(
          "[patient-messages] Local record lookup failed:",
          errorName(err),
        ),
      );
    return () => {
      cancelled = true;
    };
  }, [lookupKey]);

  // ── Unsent messages (in memory, survive closing the panel) ────────────────
  useEffect(() => {
    if (!userId) {
      setUnsent([]);
      return;
    }
    setUnsent(patientUnsent.list(userId));
    return patientUnsent.subscribe(() => setUnsent(patientUnsent.list(userId)));
  }, [userId]);

  const deliver = useCallback(
    async (localId: string, params: PatientMessageParams) => {
      if (!userId) return;
      if (!isDeviceOnline()) {
        patientUnsent.update(userId, localId, {
          state: "waiting",
          errorText: undefined,
        });
        return;
      }
      patientUnsent.update(userId, localId, {
        state: "sending",
        errorText: undefined,
      });
      try {
        await sendDoctorMessage(params);
        if (role) {
          void createAuditLog(
            role,
            "patient_message_send",
            "patient_secure_message",
            params.patientId,
          ).catch(() => undefined);
        }
        // Reload first so the stored message replaces this entry in place.
        await loadMessages();
        patientUnsent.remove(userId, localId);
      } catch (err) {
        console.warn("[patient-messages] Send failed:", errorName(err));
        const stillOnline = isDeviceOnline();
        patientUnsent.update(
          userId,
          localId,
          stillOnline
            ? {
                state: "failed",
                errorText: describeMessagingError(err, "send the message", true),
              }
            : { state: "waiting", errorText: undefined },
        );
      }
    },
    [userId, role, loadMessages],
  );

  useEffect(() => {
    if (!online || !userId || !CONFIGURED) return;
    for (const m of patientUnsent.list(userId)) {
      if (m.state === "waiting") void deliver(m.localId, m.params);
    }
  }, [online, userId, deliver]);

  // ── Derived ────────────────────────────────────────────────────────────────
  const threads = useMemo(
    () => buildPatientThreads(messages, localNames),
    [messages, localNames],
  );
  const totalUnread = threads.reduce((sum, t) => sum + t.unread_count, 0);
  const selectedThread = activeId
    ? (threads.find((t) => t.patient_id === activeId) ?? null)
    : null;
  const threadUnsent = activeId
    ? unsent.filter((m) => m.threadKey === activeId)
    : [];
  const summary = summariseConnection({
    configured: CONFIGURED,
    online,
    live,
    loaded: hasLoaded,
  });

  const unreadRef = useRef(onUnreadChange);
  useEffect(() => {
    unreadRef.current = onUnreadChange;
  });
  useEffect(() => {
    if (hasLoaded) unreadRef.current?.(totalUnread);
  }, [totalUnread, hasLoaded]);

  const firstView = useRef(true);
  useEffect(() => {
    if (firstView.current) {
      firstView.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [view]);

  const conversationSize =
    (selectedThread?.messages.length ?? 0) + threadUnsent.length;
  useEffect(() => {
    if (view === "conversation") endRef.current?.scrollIntoView({ block: "end" });
  }, [view, conversationSize, activeId]);

  // Patient search for a new message (online only: the patient must exist on
  // the online service to receive it).
  useEffect(() => {
    if (view !== "compose" || selectedPatient) return;
    const q = patientSearch.trim();
    if (q.length < 2 || !CONFIGURED || !online) {
      setPatientResults([]);
      setSearching(false);
      setSearchError("");
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      searchPatientsByName(q)
        .then((results) => {
          if (cancelled) return;
          setPatientResults(results);
          setSearchError("");
        })
        .catch((err) => {
          if (cancelled) return;
          console.warn("[patient-messages] Search failed:", errorName(err));
          setPatientResults([]);
          setSearchError(
            describeMessagingError(err, "search patients", isDeviceOnline()),
          );
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [patientSearch, selectedPatient, view, online]);

  // ── Actions ────────────────────────────────────────────────────────────────
  /**
   * Marks patient messages as read by staff. Opening a thread does this
   * quietly; `explicit` is for the "Mark as read" button, where staff are
   * told when it could not be done.
   */
  const markRead = (ids: string[], explicit = false) => {
    if (ids.length === 0) return;
    if (!canMessagePatients(role)) {
      if (explicit) {
        setActionError(
          "Your role can read patient messages but not change them.",
        );
      }
      return;
    }
    if (!CONFIGURED || !isDeviceOnline()) {
      if (explicit) {
        setActionError(
          "You're offline. Marking messages as read needs a connection; try again when this device is back online.",
        );
      }
      return;
    }
    if (explicit) setActionError("");
    markPatientMessagesRead(ids)
      .then(() => loadMessages())
      .catch((err) => {
        console.warn("[patient-messages] Mark read failed:", errorName(err));
        if (explicit) {
          setActionError(
            describeMessagingError(
              err,
              "mark the messages as read",
              isDeviceOnline(),
            ),
          );
        }
      });
  };

  const openThread = (patient: ActivePatient) => {
    setActive(patient);
    setView("conversation");
    setReply(userId ? patientDrafts.get(userId, patient.id) : "");
    setReplyError("");
    setActionError("");
    const thread = threads.find((t) => t.patient_id === patient.id);
    markRead(
      thread
        ? thread.messages.filter((m) => m.from_patient && !m.read).map((m) => m.id)
        : [],
    );
  };

  const goToInbox = () => {
    setView("inbox");
    setActive(null);
    setSelectedPatient(null);
    setPatientSearch("");
    setPatientResults([]);
    setSearchError("");
    setComposeSubject("");
    setComposeBody("");
    setComposeErrors({});
    setActionError("");
    setReplyError("");
  };

  const startCompose = () => {
    setComposeErrors({});
    setActionError("");
    setView("compose");
  };

  const queuePatientMessage = (
    patient: ActivePatient,
    subject: string,
    body: string,
  ): boolean => {
    if (!currentUser || !userId) return false;
    if (!canMessagePatients(currentUser.role)) {
      setActionError(
        "Your role can read patient messages but not reply to them.",
      );
      return false;
    }
    if (!CONFIGURED) {
      setActionError(
        "Patient messaging is not set up on this device, so nothing can be sent.",
      );
      return false;
    }
    const params: PatientMessageParams = {
      staffId: currentUser.id,
      staffName: currentUser.fullName,
      patientId: patient.id,
      subject,
      body,
      clientId: newMessageRowId(),
    };
    const localId = generateId();
    const nowOnline = isDeviceOnline();
    patientUnsent.add(userId, {
      localId,
      threadKey: patient.id,
      params,
      state: nowOnline ? "sending" : "waiting",
      createdAt: new Date().toISOString(),
    });
    if (nowOnline) void deliver(localId, params);
    return true;
  };

  const lastSubject =
    selectedThread?.latest_message.subject ??
    threadUnsent[threadUnsent.length - 1]?.params.subject;
  const defaultReplySubject = replySubject(lastSubject);

  const sendReply = (e?: FormEvent) => {
    e?.preventDefault();
    if (!active) return;
    const body = reply.trim();
    if (!body) {
      setReplyError("Write a reply before sending.");
      return;
    }
    if (queuePatientMessage(active, defaultReplySubject, body)) {
      setReply("");
      if (userId) patientDrafts.set(userId, active.id, "");
      setReplyError("");
    }
  };

  const onReplyKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      sendReply();
    }
  };

  const submitCompose = (e: FormEvent) => {
    e.preventDefault();
    const errors: typeof composeErrors = {};
    if (!selectedPatient) errors.patient = "Search for the patient and choose them.";
    if (!composeSubject.trim()) errors.subject = "Add a subject.";
    if (!composeBody.trim()) errors.body = "Write a message.";
    setComposeErrors(errors);
    if (!selectedPatient || Object.keys(errors).length > 0) return;
    const patient = {
      id: selectedPatient.id,
      name: selectedPatient.fullName || "Patient",
    };
    if (queuePatientMessage(patient, composeSubject.trim(), composeBody.trim())) {
      setSelectedPatient(null);
      setPatientSearch("");
      setPatientResults([]);
      setComposeSubject("");
      setComposeBody("");
      setComposeErrors({});
      openThread(patient);
    }
  };

  const guardChange = (): boolean => {
    if (!currentUser || !canMessagePatients(currentUser.role)) {
      setActionError(
        "Your role can read patient messages but not change them.",
      );
      return false;
    }
    if (!CONFIGURED) {
      setActionError("Patient messaging is not set up on this device.");
      return false;
    }
    if (!isDeviceOnline()) {
      setActionError(
        "You're offline. Archiving and deleting need a connection; try again when this device is back online.",
      );
      return false;
    }
    return true;
  };

  const runAction = async (
    key: string,
    action: string,
    fn: () => Promise<void>,
  ) => {
    setBusyKey(key);
    setActionError("");
    try {
      await fn();
    } catch (err) {
      console.warn(`[patient-messages] Could not ${action}:`, errorName(err));
      setActionError(describeMessagingError(err, action, isDeviceOnline()));
    } finally {
      setBusyKey(null);
    }
  };

  const handleArchiveThread = (patientId: string, patientName: string) => {
    if (!guardChange()) return;
    if (
      !window.confirm(
        `Archive the conversation with ${patientName}? It will be hidden from the patient messages inbox for all staff. The messages are not deleted, and the patient can still see them in the portal.`,
      )
    ) {
      return;
    }
    void runAction(`archive:${patientId}`, "archive the conversation", async () => {
      const changed = await archivePatientThread(patientId);
      if (changed === 0) throw nothingChanged();
      if (role) {
        void createAuditLog(
          role,
          "patient_thread_archive",
          "patient_secure_message",
          patientId,
        ).catch(() => undefined);
      }
      push({
        id: generateId(),
        tone: "success",
        title: "Conversation archived",
        body: "It is hidden from the staff inbox. The patient can still see it in the portal.",
      });
      if (activeId === patientId) goToInbox();
      await loadMessages();
    });
  };

  const handleDeleteThread = (patientId: string, patientName: string) => {
    if (!guardChange()) return;
    if (
      !window.confirm(
        `Permanently delete the entire conversation with ${patientName}? This cannot be undone, and the patient will no longer see these messages in the portal.`,
      )
    ) {
      return;
    }
    void runAction(`delete:${patientId}`, "delete the conversation", async () => {
      const changed = await deletePatientThread(patientId);
      if (changed === 0) throw nothingChanged();
      if (role) {
        void createAuditLog(
          role,
          "patient_thread_delete",
          "patient_secure_message",
          patientId,
        ).catch(() => undefined);
      }
      push({
        id: generateId(),
        tone: "success",
        title: "Conversation deleted",
      });
      if (activeId === patientId) goToInbox();
      await loadMessages();
    });
  };

  const retryUnsent = (m: Unsent) => {
    if (!currentUser || !canMessagePatients(currentUser.role)) {
      setActionError(
        "Your role can read patient messages but not reply to them.",
      );
      return;
    }
    void deliver(m.localId, m.params);
  };

  const discardUnsent = (m: Unsent) => {
    if (!userId) return;
    if (!window.confirm("Discard this unsent message? Its text will be lost.")) {
      return;
    }
    patientUnsent.remove(userId, m.localId);
  };

  // ── Rendering ──────────────────────────────────────────────────────────────
  const activeName = selectedThread?.nameKnown
    ? selectedThread.patient_name
    : active?.name || selectedThread?.patient_name || "";
  const title =
    view === "compose"
      ? "New message to a patient"
      : view === "conversation" && active
        ? activeName
        : "Patient messages";
  const subtitle =
    view === "conversation"
      ? "Patient portal conversation"
      : view === "compose"
        ? "Patient messages"
        : totalUnread > 0
          ? `Patient portal inbox · ${totalUnread} unread`
          : "Patient portal inbox";

  const renderInbox = () => {
    const orphanUnsent = unsent.filter(
      (m) => !threads.some((t) => t.patient_id === m.threadKey),
    );
    let list: ReactNode;
    if (loading && !hasLoaded) {
      list = <ThreadListSkeleton label="Loading patient messages" />;
    } else if (!hasLoaded && loadError) {
      list = (
        <EmptyState
          icon={ExclamationTriangleIcon}
          title="Could not load patient messages"
          description={loadError}
          action={
            <button
              type="button"
              onClick={() => void loadMessages()}
              className="btn-secondary"
            >
              Try again
            </button>
          }
        />
      );
    } else if (!hasLoaded && !online) {
      list = (
        <EmptyState
          icon={SignalSlashIcon}
          title="You're offline"
          description="Patient messages are kept on the online service and none have been loaded on this device yet. They load when the connection returns."
        />
      );
    } else if (threads.length === 0) {
      list = (
        <EmptyState
          icon={InboxIcon}
          title="No patient messages"
          description="Messages patients send from the patient portal appear here."
        />
      );
    } else {
      list = (
        <ul className="divide-y divide-line border-t border-line">
          {threads.map((t) => {
            const unread = t.unread_count > 0;
            const last = t.latest_message;
            const notSent = unsent.filter(
              (m) => m.threadKey === t.patient_id,
            ).length;
            return (
              <li key={t.patient_id}>
                <button
                  type="button"
                  onClick={() =>
                    openThread({ id: t.patient_id, name: t.patient_name })
                  }
                  className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                >
                  <span
                    aria-hidden
                    className={`mt-2 h-2 w-2 shrink-0 rounded-full ${unread ? "bg-primary" : "bg-transparent"}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span
                        className={`truncate text-body ${t.nameKnown ? "text-ink" : "italic text-ink-muted"} ${unread ? "font-semibold" : ""}`}
                      >
                        {t.patient_name}
                      </span>
                      <MessageTime value={last.created_at} />
                    </span>
                    <span
                      className={`mt-0.5 block truncate text-label ${unread ? "text-ink" : "text-ink-secondary"}`}
                    >
                      {last.subject}
                    </span>
                    <span className="block truncate text-caption text-ink-muted">
                      {last.from_patient
                        ? ""
                        : last.staff_id === userId
                          ? "You: "
                          : `${last.from_name}: `}
                      {last.body}
                    </span>
                    {(unread || t.awaitingReply || notSent > 0) && (
                      <span className="mt-1.5 flex flex-wrap gap-1.5">
                        {unread && (
                          <StatusBadge tone="info">
                            {t.unread_count} unread
                          </StatusBadge>
                        )}
                        {t.awaitingReply && (
                          <StatusBadge tone="neutral">Awaiting reply</StatusBadge>
                        )}
                        {notSent > 0 && (
                          <StatusBadge tone="warning">
                            {notSent} not sent
                          </StatusBadge>
                        )}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      );
    }

    return (
      <div className="flex-1 overflow-y-auto">
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <p className="text-caption text-ink-muted">
            Unread first, then conversations waiting for a reply.
          </p>
          {mayReply && CONFIGURED && (
            <button type="button" onClick={startCompose} className="btn-primary shrink-0">
              <PencilSquareIcon className="h-4 w-4" aria-hidden />
              New message
            </button>
          )}
        </div>
        {!mayReply && (
          <div className="banner banner-info mx-4 mb-3">
            <p>Your role can read patient messages but not reply to them.</p>
          </div>
        )}
        {orphanUnsent.length > 0 && (
          <div className="banner banner-warning mx-4 mb-3" role="status">
            <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            <div className="flex-1">
              <p>
                {orphanUnsent.length} message
                {orphanUnsent.length === 1 ? "" : "s"} to patients not sent yet.
              </p>
              <ul className="mt-1">
                {orphanUnsent.map((m) => (
                  <li key={m.localId}>
                    <button
                      type="button"
                      onClick={() =>
                        openThread({
                          id: m.params.patientId,
                          name: localNames.get(m.params.patientId) ?? "Patient",
                        })
                      }
                      className="min-h-touch-target font-semibold underline"
                    >
                      Open “{m.params.subject}”
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
        {hasLoaded && loadError && (
          <div className="banner banner-warning mx-4 mb-3" role="alert">
            <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            <p>
              {loadError}{" "}
              {lastCheckedAt &&
                `Showing messages loaded at ${formatClock(lastCheckedAt)}.`}
            </p>
          </div>
        )}
        {list}
      </div>
    );
  };

  const renderMessage = (m: PatientSecureMessage) => {
    const mine = !m.from_patient && m.staff_id === userId;
    return (
      <li key={m.id} className={m.from_patient ? "mr-8" : "ml-8"}>
        <article
          className={`rounded-lg border px-3 py-2.5 ${m.from_patient ? "border-line bg-surface-sunken" : "border-line-strong bg-surface"}`}
        >
          <header className="flex flex-wrap items-baseline justify-between gap-x-2">
            <p className="text-label text-ink">
              {mine ? "You" : m.from_name}
              <span className="font-normal text-ink-muted">
                {" · "}
                {m.from_patient ? "Patient" : "Staff"}
              </span>
            </p>
            <MessageTime value={m.created_at} />
          </header>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            <p className="text-caption text-ink-muted">{m.subject}</p>
            {m.from_patient && !m.read && (
              <StatusBadge tone="info">New</StatusBadge>
            )}
          </div>
          <p className="mt-1.5 whitespace-pre-wrap break-words text-body text-ink">
            {m.body}
          </p>
          {!m.from_patient && (
            <footer className="mt-1">
              <SentStatus />
            </footer>
          )}
        </article>
      </li>
    );
  };

  const renderUnsent = (m: Unsent) => (
    <li key={m.localId} className="ml-8">
      <article className="rounded-lg border border-dashed border-line-strong bg-surface px-3 py-2.5">
        <header className="flex flex-wrap items-baseline justify-between gap-x-2">
          <p className="text-label text-ink">You</p>
          <MessageTime value={m.createdAt} />
        </header>
        <p className="mt-0.5 text-caption text-ink-muted">{m.params.subject}</p>
        <p className="mt-1.5 whitespace-pre-wrap break-words text-body text-ink">
          {m.params.body}
        </p>
        <div className="mt-1.5" aria-live="polite">
          <UnsentStatus
            state={m.state}
            errorText={m.errorText}
            onRetry={() => retryUnsent(m)}
            onDiscard={() => discardUnsent(m)}
          />
        </div>
      </article>
    </li>
  );

  const renderConversation = () => {
    if (!active) return null;
    const thread = selectedThread;
    const unreadIds = thread
      ? thread.messages.filter((m) => m.from_patient && !m.read).map((m) => m.id)
      : [];
    const hasRecord = localRecordIds.has(active.id);
    const replyId = `${uid}-reply`;
    const replyHintId = `${uid}-reply-hint`;
    return (
      <>
        <div className="flex shrink-0 flex-wrap items-center gap-x-1 gap-y-0 border-b border-line px-2 py-1">
          {hasRecord ? (
            <Link
              to={`/patients/${active.id}`}
              className="btn-ghost px-2 text-caption"
            >
              <UserCircleIcon className="h-4 w-4" aria-hidden />
              Open patient record
            </Link>
          ) : (
            <p className="px-2 py-2 text-caption text-ink-muted">
              This patient's record is not on this device.
            </p>
          )}
          <span className="ml-auto flex flex-wrap">
            {mayReply && unreadIds.length > 0 && (
              <button
                type="button"
                onClick={() => markRead(unreadIds, true)}
                className="btn-ghost px-2 text-caption"
              >
                Mark as read
              </button>
            )}
            {mayReply && thread && (
              <>
                <button
                  type="button"
                  onClick={() =>
                    handleArchiveThread(active.id, thread.patient_name)
                  }
                  disabled={busyKey !== null}
                  className="btn-ghost px-2 text-caption"
                >
                  <ArchiveBoxIcon className="h-4 w-4" aria-hidden />
                  Archive
                </button>
                <button
                  type="button"
                  onClick={() =>
                    handleDeleteThread(active.id, thread.patient_name)
                  }
                  disabled={busyKey !== null}
                  className="btn-ghost px-2 text-caption text-danger-fg hover:text-danger-fg"
                >
                  <TrashIcon className="h-4 w-4" aria-hidden />
                  Delete
                </button>
              </>
            )}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {!thread && threadUnsent.length === 0 ? (
            <p className="py-6 text-center text-body text-ink-muted">
              {hasLoaded
                ? "This conversation is no longer in the inbox. It may have been archived or deleted on another device."
                : "Messages load when the connection returns."}
            </p>
          ) : (
            <ol className="space-y-3" aria-label={`Messages with ${activeName}`}>
              {(thread?.messages ?? []).map(renderMessage)}
              {threadUnsent.map(renderUnsent)}
            </ol>
          )}
          <div ref={endRef} />
        </div>
        {!mayReply ? (
          <p className="shrink-0 border-t border-line px-4 py-3 text-caption text-ink-muted">
            Your role can read patient messages but not reply to them.
          </p>
        ) : (
          <form
            onSubmit={sendReply}
            noValidate
            className="shrink-0 space-y-2 border-t border-line bg-surface px-4 py-3"
          >
            <label htmlFor={replyId} className="field-label">
              Reply to {activeName}
            </label>
            <textarea
              id={replyId}
              rows={3}
              value={reply}
              onChange={(e) => {
                setReply(e.target.value);
                if (userId) patientDrafts.set(userId, active.id, e.target.value);
                if (replyError) setReplyError("");
              }}
              onKeyDown={onReplyKeyDown}
              placeholder="Type your reply to the patient"
              aria-invalid={replyError ? true : undefined}
              aria-describedby={replyHintId}
              className="input-field resize-none"
            />
            {replyError && (
              <p className="field-error" role="alert">
                {replyError}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <p className="min-w-0 flex-1 truncate text-caption text-ink-muted">
                Subject: {defaultReplySubject}
              </p>
              <button type="submit" className="btn-primary">
                <PaperAirplaneIcon className="h-4 w-4" aria-hidden />
                {online ? "Send reply" : "Send when back online"}
              </button>
            </div>
            <p id={replyHintId} className="field-hint">
              {online
                ? "The patient sees your reply when they sign in to the patient portal. Ctrl + Enter also sends."
                : "You're offline. The reply waits on this screen and sends when the connection returns. It is lost if the app is reloaded."}
            </p>
          </form>
        )}
      </>
    );
  };

  const renderCompose = () => {
    const searchId = `${uid}-patient`;
    const searchHintId = `${uid}-patient-hint`;
    const subjectId = `${uid}-subject`;
    const bodyId = `${uid}-body`;
    const canSearch = CONFIGURED && online;
    return (
      <form
        onSubmit={submitCompose}
        noValidate
        className="flex-1 space-y-4 overflow-y-auto px-4 py-4"
      >
        <div>
          {selectedPatient ? (
            <p id={searchId} className="field-label">
              Patient
            </p>
          ) : (
            <label htmlFor={searchId} className="field-label">
              Patient
            </label>
          )}
          {selectedPatient ? (
            <div
              className="flex items-center gap-2 rounded-md border border-line-strong bg-surface-sunken px-3 py-1"
              role="group"
              aria-labelledby={searchId}
            >
              <UserCircleIcon className="h-5 w-5 shrink-0 text-ink-muted" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-body text-ink">
                {selectedPatient.fullName || "Patient"}
              </span>
              <button
                type="button"
                onClick={() => setSelectedPatient(null)}
                className="btn-ghost px-2 text-caption"
              >
                Change
              </button>
            </div>
          ) : (
            <>
              <div className="relative">
                <MagnifyingGlassIcon
                  className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-ink-muted"
                  aria-hidden
                />
                <input
                  id={searchId}
                  type="search"
                  value={patientSearch}
                  onChange={(e) => setPatientSearch(e.target.value)}
                  disabled={!canSearch}
                  placeholder="Search by name"
                  aria-describedby={
                    composeErrors.patient
                      ? `${searchHintId} ${searchId}-error`
                      : searchHintId
                  }
                  aria-invalid={composeErrors.patient ? true : undefined}
                  className="input-field pl-9"
                />
              </div>
              <p id={searchHintId} className="field-hint">
                {canSearch
                  ? "Type at least 2 letters. Only patients on the online service can receive messages."
                  : "Patient search needs a connection: only patients on the online service can receive messages."}
              </p>
              <div aria-live="polite" className="mt-1">
                {searching ? (
                  <p className="text-caption text-ink-muted">Searching…</p>
                ) : searchError ? (
                  <p className="field-error">{searchError}</p>
                ) : patientSearch.trim().length >= 2 && canSearch ? (
                  patientResults.length === 0 ? (
                    <p className="text-caption text-ink-muted">
                      No patients found with that name.
                    </p>
                  ) : (
                    <ul
                      className="divide-y divide-line rounded-md border border-line"
                      aria-label="Matching patients"
                    >
                      {patientResults.map((p) => (
                        <li key={p.id}>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedPatient(p);
                              setPatientSearch("");
                              setPatientResults([]);
                              setComposeErrors((errs) => ({ ...errs, patient: undefined }));
                            }}
                            className="flex min-h-touch-target w-full items-center gap-2 px-3 py-2 text-left text-body text-ink hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                          >
                            <UserCircleIcon
                              className="h-5 w-5 shrink-0 text-ink-muted"
                              aria-hidden
                            />
                            {p.fullName || "Name not recorded"}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )
                ) : null}
              </div>
            </>
          )}
          {composeErrors.patient && (
            <p id={`${searchId}-error`} className="field-error">
              {composeErrors.patient}
            </p>
          )}
        </div>

        <div>
          <label htmlFor={subjectId} className="field-label">
            Subject
          </label>
          <input
            id={subjectId}
            type="text"
            value={composeSubject}
            onChange={(e) => setComposeSubject(e.target.value)}
            aria-invalid={composeErrors.subject ? true : undefined}
            aria-describedby={composeErrors.subject ? `${subjectId}-error` : undefined}
            className="input-field"
          />
          {composeErrors.subject && (
            <p id={`${subjectId}-error`} className="field-error">
              {composeErrors.subject}
            </p>
          )}
        </div>

        <div>
          <label htmlFor={bodyId} className="field-label">
            Message
          </label>
          <textarea
            id={bodyId}
            rows={6}
            value={composeBody}
            onChange={(e) => setComposeBody(e.target.value)}
            aria-invalid={composeErrors.body ? true : undefined}
            aria-describedby={composeErrors.body ? `${bodyId}-error` : undefined}
            className="input-field resize-none"
          />
          {composeErrors.body && (
            <p id={`${bodyId}-error`} className="field-error">
              {composeErrors.body}
            </p>
          )}
        </div>

        <p className="field-hint">
          The patient sees this when they sign in to the patient portal.
        </p>

        <div className="flex gap-2">
          <button type="submit" className="btn-primary flex-1">
            <PaperAirplaneIcon className="h-4 w-4" aria-hidden />
            {online ? "Send message" : "Send when back online"}
          </button>
          <button type="button" onClick={goToInbox} className="btn-secondary">
            Cancel
          </button>
        </div>
      </form>
    );
  };

  const renderBody = () => {
    if (!CONFIGURED) {
      return (
        <EmptyState
          icon={ExclamationTriangleIcon}
          title="Patient messaging is not set up on this device"
          description="Patient portal messages are kept on the online service, which is not configured here. Ask your administrator to connect this device."
        />
      );
    }
    if (view === "conversation") return renderConversation();
    if (view === "compose") return renderCompose();
    return renderInbox();
  };

  return (
    <div
      ref={rootRef}
      role={onClose ? "dialog" : "region"}
      aria-modal={onClose ? true : undefined}
      aria-labelledby={headingId}
      className="flex h-full flex-col overflow-hidden bg-surface"
    >
      <PanelHeader
        headingId={headingId}
        headingRef={headingRef}
        title={title}
        subtitle={subtitle}
        icon={InboxIcon}
        onBack={view !== "inbox" ? goToInbox : undefined}
        backLabel="Back to patient messages"
        onClose={onClose}
        closeLabel="Close patient messages"
      />
      <ConnectionBar
        summary={summary}
        lastCheckedAt={lastCheckedAt}
        refreshing={refreshing}
        onRefresh={() => void loadMessages()}
      />
      {actionError && (
        <div className="banner banner-danger mx-4 mt-3 shrink-0" role="alert">
          <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <p className="flex-1">{actionError}</p>
          <button
            type="button"
            onClick={() => setActionError("")}
            className="btn-ghost -my-2 -mr-2 min-w-touch-target px-2"
            aria-label="Dismiss this message"
          >
            <XMarkIcon className="h-4 w-4" aria-hidden />
          </button>
        </div>
      )}
      {renderBody()}
    </div>
  );
}

export default PatientMessagesPanel;
