import { useState, useEffect, useCallback, useRef } from "react";
import type { FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { isRealtimeAvailable } from "@/lib/realtimeAvailable";
import * as logger from "@/lib/logger";
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  ChevronRightIcon,
  InboxIcon,
  PaperAirplaneIcon,
  PencilSquareIcon,
  TrashIcon,
  UserCircleIcon,
} from "@heroicons/react/24/outline";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { PortalListSkeleton, PortalNotice, PortalPage } from "./PortalPage";
import { formatPortalDate, formatPortalTime, messageDeliveryInfo } from "./portalStatus";
import { readPortalUser } from "./portalSession";
import {
  queuedForPatient,
  readMessageQueue,
  withoutQueued,
  writeMessageQueue,
  type QueuedMessage,
} from "./messageQueue";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useT } from "@/hooks/useT";

interface Message {
  id: string;
  subject: string;
  body: string;
  from_patient: boolean;
  from_name: string;
  created_at: string;
  read: boolean;
  patient_id: string;
  staff_id?: string;
}

// Only the columns this page shows.
const MESSAGE_COLUMNS =
  "id, subject, body, from_patient, from_name, created_at, read, patient_id, staff_id";

const QUICK_MESSAGE_KEYS = [
  "portal.msg.quick.pain",
  "portal.msg.quick.help",
  "portal.msg.quick.missedMedicine",
  "portal.msg.quick.question",
];

const DELIVERY_KEYS: Record<string, string> = {
  "Not sent": "portal.msg.status.notSent",
  Read: "portal.msg.status.read",
  New: "portal.msg.status.new",
  "Seen by the clinic team": "portal.msg.status.seen",
  "Sent, not opened yet": "portal.msg.status.sentNotOpened",
};

// Error and feedback text are kept as translation keys so the loaders do not
// depend on the translate function.
type Feedback = {
  tone: "success" | "warning";
  key: string;
  vars?: Record<string, string>;
} | null;

function localId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : "unknown";
}

async function insertPatientMessage(
  client: SupabaseClient,
  patientId: string,
  msg: { subject: string; body: string; staffId: string | null },
): Promise<void> {
  const { data: patient } = await client
    .from("patients")
    .select("given_name, family_name")
    .eq("id", patientId)
    .maybeSingle();

  const fromName = patient
    ? `${patient.given_name} ${patient.family_name}`
    : "Patient";

  const { error: insertError } = await client
    .from("patient_secure_messages")
    .insert({
      patient_id: patientId,
      staff_id: msg.staffId,
      subject: msg.subject,
      body: msg.body,
      from_patient: true,
      from_name: fromName,
      read: false,
    });

  if (insertError) throw insertError;
}

function MessageDate({ value }: { value: string }) {
  return (
    <span className="whitespace-nowrap tabular-nums">
      {formatPortalDate(value)} {formatPortalTime(value)}
    </span>
  );
}

export function SecureMessaging() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useT();
  const deliveryLabel = (label: string) =>
    DELIVERY_KEYS[label] ? t(DELIVERY_KEYS[label]) : label;
  const online = useOnlineStatus();
  const [messages, setMessages] = useState<Message[]>([]);
  const [unsent, setUnsent] = useState<QueuedMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [composeError, setComposeError] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [showCompose, setShowCompose] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [replyStaffId, setReplyStaffId] = useState<string | null>(null);
  const [newMessage, setNewMessage] = useState({ subject: "", body: "" });
  const [sendingQueuedId, setSendingQueuedId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const subjectRef = useRef<HTMLInputElement>(null);
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  const lastOpenedId = useRef<string | null>(null);

  const messagingConfigured = !!supabase;

  const loadMessages = useCallback(async () => {
    setError("");
    const portalUser = readPortalUser();
    if (!portalUser) {
      setError("portal.msg.err.noSignIn");
      setLoading(false);
      return;
    }
    if (!portalUser.patientId) {
      setError("portal.msg.err.incomplete");
      setLoading(false);
      return;
    }

    setUnsent(queuedForPatient(readMessageQueue(), portalUser.patientId));

    if (!supabase) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const { data, error: messagesError } = await supabase
        .from("patient_secure_messages")
        .select(MESSAGE_COLUMNS)
        .eq("patient_id", portalUser.patientId)
        .order("created_at", { ascending: false });

      if (messagesError) throw messagesError;

      setMessages(data || []);
      setLoaded(true);
    } catch (err) {
      logger.error("Error loading messages:", errorName(err));
      // Offline, the "You are offline" notice already explains it.
      setError(
        navigator.onLine
          ? "portal.msg.err.loadFailed"
          : "",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  // Load now (even offline: this phone may have kept a copy from the last time
  // it was online), and again whenever the connection comes back.
  const attempted = useRef(false);

  useEffect(() => {
    if (!online && attempted.current) return;
    attempted.current = true;
    loadMessages();
  }, [online, loadMessages]);

  // Clinic replies may not arrive live, so check again whenever the patient
  // comes back to this page (switching apps or tabs).
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible" && navigator.onLine) {
        void loadMessages();
      }
    };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [loadMessages]);

  // Live updates when the clinic replies (if realtime is available).
  useEffect(() => {
    if (!supabase) return;
    if (!isRealtimeAvailable()) return;
    const patientId = readPortalUser()?.patientId;
    if (!patientId) return;
    const client = supabase;

    let channel: ReturnType<typeof client.channel> | null = null;
    try {
      channel = client
        .channel(`secure_messages:${patientId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "patient_secure_messages",
            // Only this patient's rows. Realtime does not apply row security
            // to deletions, so the filter must be here, not only on the server.
            filter: `patient_id=eq.${patientId}`,
          },
          () => {
            loadMessages();
          },
        )
        .subscribe();
    } catch (err) {
      logger.warn(
        "[SecureMessaging] Realtime unavailable; live message updates disabled:",
        errorName(err),
      );
    }

    return () => {
      if (channel) client.removeChannel(channel);
    };
  }, [loadMessages]);

  // Arriving from "Need more of a medicine?" opens a refill message.
  useEffect(() => {
    const state = location.state as { compose?: string } | null;
    if (state?.compose !== "refill") return;
    if (supabase) {
      setReplyStaffId(null);
      setSelectedMessage(null);
      setNewMessage({ subject: t("portal.msg.refillSubject"), body: "" });
      setShowCompose(true);
    }
    // Clear the request so a page refresh does not reopen it.
    navigate(location.pathname, { replace: true, state: null });
    // t is left out on purpose: it changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, location.pathname, navigate]);

  useEffect(() => {
    if (showCompose) subjectRef.current?.focus();
  }, [showCompose]);

  // Move focus with the view so keyboard and screen-reader users follow it.
  useEffect(() => {
    if (selectedMessage) {
      detailHeadingRef.current?.focus();
    } else if (lastOpenedId.current) {
      document.getElementById(`message-${lastOpenedId.current}`)?.focus();
    }
  }, [selectedMessage]);

  const resetCompose = () => {
    setNewMessage({ subject: "", body: "" });
    setShowCompose(false);
    setReplyStaffId(null);
    setComposeError("");
  };

  const sendMessage = async (e?: FormEvent<HTMLFormElement>) => {
    e?.preventDefault();
    const subject = newMessage.subject.trim();
    const body = newMessage.body.trim();
    if (!subject || !body) {
      setComposeError("portal.msg.err.empty");
      return;
    }
    if (!supabase) return;

    const portalUser = readPortalUser();
    if (!portalUser || !portalUser.patientId) {
      navigate("/patient/login", { replace: true });
      return;
    }

    setComposeError("");
    setFeedback(null);

    if (!navigator.onLine) {
      // Keep it on this phone, clearly marked as not sent.
      const queued: QueuedMessage = {
        id: localId(),
        subject,
        body,
        from_patient: true,
        from_name: "You",
        created_at: new Date().toISOString(),
        read: false,
        patient_id: portalUser.patientId,
        staff_id: replyStaffId,
      };
      const saved = writeMessageQueue([...readMessageQueue(), queued]);
      if (!saved) {
        setComposeError("portal.msg.err.saveFailed");
        return;
      }
      setUnsent(queuedForPatient(readMessageQueue(), portalUser.patientId));
      setFeedback({
        tone: "warning",
        key: "portal.msg.savedOffline",
      });
      resetCompose();
      return;
    }

    setSending(true);
    try {
      await insertPatientMessage(supabase, portalUser.patientId, {
        subject,
        body,
        staffId: replyStaffId,
      });
      setFeedback({
        tone: "success",
        key: "portal.msg.sent",
      });
      resetCompose();
      await loadMessages();
    } catch (err) {
      logger.error("Error sending message:", errorName(err));
      setComposeError("portal.msg.err.notSent");
    } finally {
      setSending(false);
    }
  };

  const sendQueued = async (item: QueuedMessage) => {
    if (!supabase || !navigator.onLine) {
      setError("portal.msg.err.offlineSend");
      return;
    }
    setSendingQueuedId(item.id);
    setError("");
    setFeedback(null);
    try {
      await insertPatientMessage(supabase, item.patient_id, {
        subject: item.subject,
        body: item.body,
        staffId: item.staff_id ?? null,
      });
      writeMessageQueue(withoutQueued(readMessageQueue(), item.id));
      setUnsent((prev) => prev.filter((m) => m.id !== item.id));
      setFeedback({
        tone: "success",
        key: "portal.msg.queuedSent",
        vars: { subject: item.subject },
      });
      await loadMessages();
    } catch (err) {
      logger.error("Error sending saved message:", errorName(err));
      setError("portal.msg.err.queuedNotSent");
    } finally {
      setSendingQueuedId(null);
    }
  };

  const discardQueued = (item: QueuedMessage) => {
    writeMessageQueue(withoutQueued(readMessageQueue(), item.id));
    setUnsent((prev) => prev.filter((m) => m.id !== item.id));
    setConfirmDeleteId(null);
  };

  const markAsRead = async (messageId: string) => {
    if (!supabase) return;
    try {
      await supabase
        .from("patient_secure_messages")
        .update({ read: true })
        .eq("id", messageId);

      await loadMessages();
    } catch (err) {
      logger.error("Error marking message as read:", errorName(err));
    }
  };

  const openMessage = (message: Message) => {
    lastOpenedId.current = message.id;
    setSelectedMessage(message);
    if (!message.read && !message.from_patient) {
      markAsRead(message.id);
    }
  };

  const handleReply = () => {
    if (!selectedMessage) return;
    setReplyStaffId(selectedMessage.staff_id || null);
    setNewMessage({
      subject: selectedMessage.subject.startsWith("Re:")
        ? selectedMessage.subject
        : `Re: ${selectedMessage.subject}`,
      body: "",
    });
    setComposeError("");
    setShowCompose(true);
  };

  const startNewMessage = () => {
    setReplyStaffId(null);
    setNewMessage({ subject: "", body: "" });
    setComposeError("");
    setFeedback(null);
    setShowCompose(true);
  };

  if (loading && !loaded) {
    return <PortalListSkeleton label={t("portal.msg.loading")} />;
  }

  return (
    <PortalPage
      title={t("portal.msg.title")}
      description={t("portal.msg.description")}
      actions={
        messagingConfigured &&
        !showCompose && (
          <button
            type="button"
            onClick={startNewMessage}
            className="btn-primary"
          >
            <PencilSquareIcon className="h-5 w-5" aria-hidden />
            {t("portal.msg.new")}
          </button>
        )
      }
    >
      {!messagingConfigured && (
        <PortalNotice tone="info" title={t("portal.msg.notConnectedTitle")}>
          {t("portal.msg.notConnected")}
        </PortalNotice>
      )}

      {messagingConfigured && !online && (
        <PortalNotice tone="offline" title={t("portal.msg.offlineTitle")}>
          {loaded
            ? t("portal.msg.offlineStale")
            : t("portal.msg.offlineEmpty")}{" "}
          {t("portal.msg.offlineWrite")}
        </PortalNotice>
      )}

      {error && (
        <PortalNotice
          tone="danger"
          action={
            messagingConfigured && online ? (
              <button
                type="button"
                onClick={loadMessages}
                className="btn-secondary"
              >
                <ArrowPathIcon className="h-5 w-5" aria-hidden />
                {t("portal.error.retry")}
              </button>
            ) : undefined
          }
        >
          {t(error)}
        </PortalNotice>
      )}

      {feedback && (
        <PortalNotice tone={feedback.tone}>
          {feedback.vars ? t(feedback.key, feedback.vars) : t(feedback.key)}
        </PortalNotice>
      )}

      {showCompose && messagingConfigured && (
        <form
          onSubmit={sendMessage}
          className="panel"
          aria-labelledby="compose-title"
          noValidate
        >
          <div className="panel-header">
            <h2 id="compose-title" className="panel-title">
              {replyStaffId ? t("portal.msg.reply") : t("portal.msg.new")}
            </h2>
          </div>
          <div className="panel-body space-y-4">
            <div>
              <label htmlFor="message-subject" className="field-label">
                {t("portal.msg.subject")}
              </label>
              <input
                ref={subjectRef}
                id="message-subject"
                type="text"
                value={newMessage.subject}
                onChange={(e) =>
                  setNewMessage({ ...newMessage, subject: e.target.value })
                }
                disabled={sending}
                className="input-field"
              />
            </div>

            <fieldset>
              <legend className="field-label">
                {t("portal.msg.quickLegend")}
              </legend>
              <div className="flex flex-wrap gap-2">
                {QUICK_MESSAGE_KEYS.map((key) => {
                  const msg = t(key);
                  return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setNewMessage({ ...newMessage, body: msg })}
                    aria-pressed={newMessage.body === msg}
                    disabled={sending}
                    className={`min-h-touch-target rounded-md border px-4 py-2 text-label transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                      newMessage.body === msg
                        ? "border-primary bg-primary-soft text-primary-fg"
                        : "border-line-strong bg-surface text-ink hover:bg-surface-hover"
                    }`}
                  >
                    {msg}
                  </button>
                  );
                })}
              </div>
              <p className="field-hint">
                {t("portal.msg.quickHint")}
              </p>
            </fieldset>

            <div>
              <label htmlFor="message-body" className="field-label">
                {t("portal.msg.body")}
              </label>
              <textarea
                id="message-body"
                value={newMessage.body}
                onChange={(e) =>
                  setNewMessage({ ...newMessage, body: e.target.value })
                }
                rows={6}
                disabled={sending}
                className="input-field"
              />
            </div>

            {composeError && (
              <PortalNotice tone="danger">{t(composeError)}</PortalNotice>
            )}

            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={sending} className="btn-primary">
                <PaperAirplaneIcon className="h-5 w-5" aria-hidden />
                {sending
                  ? t("portal.appt.sending")
                  : online
                    ? t("portal.msg.send")
                    : t("portal.msg.saveOnPhone")}
              </button>
              <button
                type="button"
                onClick={resetCompose}
                disabled={sending}
                className="btn-secondary"
              >
                {t("action.cancel")}
              </button>
            </div>
          </div>
        </form>
      )}

      {unsent.length > 0 && (
        <section className="panel" aria-labelledby="unsent-title">
          <div className="panel-header">
            <h2 id="unsent-title" className="panel-title">
              {t("portal.msg.unsentTitle")}
            </h2>
          </div>
          <ul className="divide-y divide-line">
            {unsent.map((item) => {
              const delivery = messageDeliveryInfo({
                fromPatient: true,
                read: false,
                local: true,
              });
              const confirming = confirmDeleteId === item.id;
              return (
                <li key={item.id} className="space-y-2 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="text-body font-medium text-ink">
                      {item.subject}
                    </p>
                    <StatusBadge tone={delivery.tone}>
                      {t("portal.msg.savedBadge", {
                        status: deliveryLabel(delivery.label),
                      })}
                    </StatusBadge>
                  </div>
                  <p className="whitespace-pre-wrap text-body text-ink-secondary line-clamp-3">
                    {item.body}
                  </p>
                  <p className="text-caption text-ink-muted">
                    {t("portal.msg.written")} <MessageDate value={item.created_at} />
                  </p>
                  {confirming ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-body text-ink">
                        {t("portal.msg.deleteConfirm")}
                      </p>
                      <button
                        type="button"
                        onClick={() => discardQueued(item)}
                        className="btn-danger"
                      >
                        {t("portal.msg.yesDelete")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        className="btn-secondary"
                        // Focus the safe choice so keyboard users are not lost
                        // when the Delete button is replaced.
                        autoFocus
                      >
                        {t("portal.msg.keepIt")}
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => sendQueued(item)}
                        disabled={
                          !online ||
                          !messagingConfigured ||
                          sendingQueuedId !== null
                        }
                        className="btn-primary"
                      >
                        <PaperAirplaneIcon className="h-5 w-5" aria-hidden />
                        {sendingQueuedId === item.id
                          ? t("portal.appt.sending")
                          : t("portal.msg.sendNow")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(item.id)}
                        disabled={sendingQueuedId === item.id}
                        className="btn-secondary"
                      >
                        <TrashIcon className="h-5 w-5" aria-hidden />
                        {t("portal.msg.delete")}
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {selectedMessage ? (
        <section className="panel" aria-labelledby="message-detail-title">
          <div className="panel-header flex-wrap">
            <button
              type="button"
              onClick={() => setSelectedMessage(null)}
              className="btn-ghost -ml-2"
            >
              <ArrowLeftIcon className="h-5 w-5" aria-hidden />
              {t("portal.msg.back")}
            </button>
            {!selectedMessage.from_patient && messagingConfigured && (
              <button
                type="button"
                onClick={handleReply}
                className="btn-primary"
              >
                {t("portal.msg.reply")}
              </button>
            )}
          </div>
          <div className="panel-body">
            <h2
              id="message-detail-title"
              ref={detailHeadingRef}
              tabIndex={-1}
              className="text-h2 text-ink focus:outline-none"
            >
              {selectedMessage.subject}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-body text-ink-muted">
              <span className="flex items-center gap-1">
                <UserCircleIcon className="h-5 w-5" aria-hidden />
                {selectedMessage.from_patient
                  ? t("portal.msg.you")
                  : selectedMessage.from_name}
              </span>
              <MessageDate value={selectedMessage.created_at} />
              {selectedMessage.from_patient && (
                <StatusBadge
                  tone={
                    messageDeliveryInfo({
                      fromPatient: true,
                      read: selectedMessage.read,
                    }).tone
                  }
                  icon
                >
                  {deliveryLabel(
                    messageDeliveryInfo({
                      fromPatient: true,
                      read: selectedMessage.read,
                    }).label,
                  )}
                </StatusBadge>
              )}
            </div>
            <p className="mt-4 whitespace-pre-wrap border-t border-line pt-4 text-body text-ink">
              {selectedMessage.body}
            </p>
          </div>
        </section>
      ) : (
        messagingConfigured &&
        (loaded || messages.length > 0) && (
          <section className="panel" aria-labelledby="inbox-title">
            <div className="panel-header">
              <h2 id="inbox-title" className="panel-title">
                {t("portal.msg.inbox")}
              </h2>
            </div>
            {messages.length === 0 ? (
              <EmptyState
                icon={InboxIcon}
                title={t("portal.msg.emptyTitle")}
                description={t("portal.msg.emptyBody")}
              />
            ) : (
              <ul className="divide-y divide-line">
                {messages.map((message) => {
                  const delivery = messageDeliveryInfo({
                    fromPatient: message.from_patient,
                    read: message.read,
                  });
                  const unread = !message.read && !message.from_patient;
                  return (
                    <li key={message.id}>
                      <button
                        id={`message-${message.id}`}
                        type="button"
                        onClick={() => openMessage(message)}
                        className="flex min-h-touch-target w-full items-start gap-3 p-4 text-left transition-colors hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                      >
                        <span className="min-w-0 flex-1">
                          <span
                            className={`block text-body ${
                              unread
                                ? "font-semibold text-ink"
                                : "font-medium text-ink"
                            }`}
                          >
                            {message.subject}
                          </span>
                          <span className="block text-caption text-ink-muted">
                            {message.from_patient
                              ? t("portal.msg.fromYou")
                              : t("portal.msg.from", { name: message.from_name })}
                          </span>
                          <span className="mt-1 block text-body text-ink-secondary line-clamp-2">
                            {message.body}
                          </span>
                          <span className="mt-2 flex flex-wrap items-center gap-2">
                            <StatusBadge tone={delivery.tone} icon>
                              {deliveryLabel(delivery.label)}
                            </StatusBadge>
                          </span>
                        </span>
                        <span className="shrink-0 text-caption text-ink-muted">
                          <MessageDate value={message.created_at} />
                        </span>
                        <ChevronRightIcon
                          className="mt-0.5 h-5 w-5 shrink-0 text-ink-muted"
                          aria-hidden
                        />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )
      )}

      {messagingConfigured && (
        <p className="text-caption text-ink-muted">
          {t("portal.msg.replyTime")}
        </p>
      )}
    </PortalPage>
  );
}
