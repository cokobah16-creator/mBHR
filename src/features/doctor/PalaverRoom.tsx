import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/stores/toast";
import { db, generateId } from "@/db";
import type { User } from "@/db";
import { getRoleDisplayName } from "@/auth/roles";
import {
  isOnlineStaffId,
  palaverRoom,
  PalaverError,
  type MessagePriority,
  type PalaverBroadcast,
  type PalaverMessage,
  type SendMessageParams,
  type TargetRole,
} from "@/services/palaverRoom";
import { Tabs } from "@/components/ui/Tabs";
import { panelId, tabId } from "@/components/ui/tabIds";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  ArchiveBoxIcon,
  ChatBubbleLeftRightIcon,
  ExclamationTriangleIcon,
  InboxIcon,
  MegaphoneIcon,
  PaperAirplaneIcon,
  PencilSquareIcon,
  SignalSlashIcon,
  TrashIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import {
  POLL_SECONDS,
  PRIORITY_LABEL,
  TARGET_ROLE_LABEL,
  buildPalaverThreads,
  canMessageStaff,
  canPostAnnouncements,
  describeMessagingError,
  errorName,
  formatClock,
  formatFullTimestamp,
  isMessagePriority,
  isTargetRole,
  replySubject,
  summariseConnection,
} from "./messagingModel";
import {
  newMessageRowId,
  palaverDrafts,
  palaverUnsent,
  type UnsentMessage,
} from "./unsentMessages";
import { isDeviceOnline, useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useLiveMessageUpdates } from "./useLiveMessageUpdates";
import { usePanelFocus } from "./usePanelFocus";
import {
  ConnectionBar,
  MessageTime,
  PanelHeader,
  PriorityBadge,
  SentStatus,
  ThreadListSkeleton,
  UnsentStatus,
} from "./MessagingParts";

type View = "list" | "conversation" | "compose" | "broadcast";
type ListTab = "conversations" | "announcements";
type Unsent = UnsentMessage<SendMessageParams>;

const TABS_ID = "palaver";
const PRIORITIES: MessagePriority[] = ["normal", "urgent", "critical"];
const TARGET_ROLES: TargetRole[] = [
  "all_clinical",
  "doctor",
  "nurse",
  "pharmacist",
  "all_staff",
];
/** Roles that can be picked as a direct-message recipient. */
const RECIPIENT_ROLES: User["role"][] = ["doctor", "nurse", "admin"];

const isListTab = (id: string): id is ListTab =>
  id === "conversations" || id === "announcements";

interface Colleague {
  id: string;
  name: string;
}

const EMPTY_COMPOSE = {
  recipientId: "",
  subject: "",
  body: "",
  priority: "normal" as MessagePriority,
};

const EMPTY_BROADCAST = {
  targetRole: "all_clinical" as TargetRole,
  subject: "",
  body: "",
  priority: "normal" as MessagePriority,
};

interface PalaverRoomProps {
  onClose?: () => void;
  isPanel?: boolean;
  /** Called with the number of unread messages after each refresh. */
  onUnreadChange?: (count: number) => void;
}

/**
 * Palaver Room: direct messages between staff and announcements to staff
 * groups. Everything is stored on the online service (Supabase); nothing is
 * kept on the device, and the panel says so whenever that matters.
 */
export function PalaverRoom({
  onClose,
  isPanel = false,
  onUnreadChange,
}: PalaverRoomProps) {
  const currentUser = useAuthStore((s) => s.currentUser);
  const { push } = useToast();
  const userRole = currentUser?.role;
  const [availability] = useState(() => palaverRoom.getAvailabilityStatus());
  const configured = availability.available;
  // Messages are stored against the online staff account (app_users id) and
  // the server only serves that signed-in account, so messaging needs an
  // online sign-in; a PIN-only unlock has none. undefined = still checking.
  const [onlineStaffId, setOnlineStaffId] = useState<string | null | undefined>(
    undefined,
  );
  const userId = onlineStaffId ?? undefined;
  const localUserId = currentUser?.id;
  const localUserEmail = currentUser?.email;
  const online = useOnlineStatus();
  const mayMessage = canMessageStaff(userRole);
  const mayAnnounce = canPostAnnouncements(userRole);

  const uid = useId();
  const headingId = `${uid}-title`;
  const rootRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const activeIdRef = useRef<string | null>(null);
  // Only the newest conversation request may update the screen.
  const conversationSeq = useRef(0);
  const dialog = isPanel && !!onClose;
  usePanelFocus(rootRef, headingRef, dialog, onClose);

  const [view, setView] = useState<View>("list");
  const [listTab, setListTab] = useState<ListTab>("conversations");

  // Inbox
  const [messages, setMessages] = useState<PalaverMessage[]>([]);
  const [broadcasts, setBroadcasts] = useState<PalaverBroadcast[]>([]);
  const [broadcastsFailed, setBroadcastsFailed] = useState(false);
  const [staff, setStaff] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null);

  // Open conversation
  const [active, setActive] = useState<Colleague | null>(null);
  const [conversation, setConversation] = useState<PalaverMessage[]>([]);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [conversationError, setConversationError] = useState("");
  const [reply, setReply] = useState("");
  const [replyPriority, setReplyPriority] =
    useState<MessagePriority>("normal");
  const [replySubjectOverride, setReplySubjectOverride] = useState<
    string | null
  >(null);
  const [replyError, setReplyError] = useState("");

  // Forms
  const [compose, setCompose] = useState(EMPTY_COMPOSE);
  const [composeErrors, setComposeErrors] = useState<
    Partial<Record<"recipientId" | "subject" | "body", string>>
  >({});
  const [broadcastForm, setBroadcastForm] = useState(EMPTY_BROADCAST);
  const [broadcastErrors, setBroadcastErrors] = useState<
    Partial<Record<"subject" | "body", string>>
  >({});
  const [broadcastSending, setBroadcastSending] = useState(false);
  const [broadcastError, setBroadcastError] = useState("");

  const [actionError, setActionError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [unsent, setUnsent] = useState<Unsent[]>([]);

  // ── Online staff sign-in ───────────────────────────────────────────────────
  useEffect(() => {
    if (!localUserId || !configured) {
      setOnlineStaffId(null);
      return;
    }
    let cancelled = false;
    // A different person: never act as the previous person's account while
    // the new one is being checked.
    setOnlineStaffId(undefined);
    const check = () => {
      void palaverRoom
        .getStaffSession({ id: localUserId, email: localUserEmail })
        .then((session) => {
          if (!cancelled) {
            setOnlineStaffId(session.status === "signed_in" ? session.id : null);
          }
        });
    };
    check();
    const unsubscribe = palaverRoom.onStaffSessionChange(check);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [localUserId, localUserEmail, configured]);

  // ── Staff directory (local) ────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    db.users
      .toArray()
      .then((users) => {
        if (!cancelled) setStaff(users);
      })
      .catch((err) =>
        console.warn("[palaver] Staff list unavailable:", errorName(err)),
      );
    return () => {
      cancelled = true;
    };
  }, []);

  const staffById = useMemo(
    () => new Map(staff.map((u) => [u.id, u] as const)),
    [staff],
  );
  const recipients = useMemo(
    () =>
      staff
        .filter(
          (u) =>
            u.isActive === 1 &&
            u.id !== userId &&
            u.id !== localUserId &&
            // Only online staff accounts can receive messages.
            isOnlineStaffId(u.id) &&
            RECIPIENT_ROLES.includes(u.role),
        )
        .sort((a, b) => a.fullName.localeCompare(b.fullName)),
    [staff, userId, localUserId],
  );
  const roleOf = (id: string): string | null => {
    const u = staffById.get(id);
    return u ? getRoleDisplayName(u.role) : null;
  };

  // ── Loading ────────────────────────────────────────────────────────────────
  // Polling, live updates and post-action reloads can overlap; only the
  // newest inbox request may update the screen.
  const loadSeq = useRef(0);
  const loadData = useCallback(async () => {
    if (!userId || !userRole) return;
    if (!configured || !isDeviceOnline()) {
      setLoading(false);
      return;
    }
    const seq = ++loadSeq.current;
    setRefreshing(true);
    const [inbox, announcements] = await Promise.allSettled([
      palaverRoom.getInboxMessages(userId),
      palaverRoom.getBroadcasts(userRole, userId),
    ]);
    if (seq !== loadSeq.current) return;
    if (inbox.status === "fulfilled") {
      setMessages(inbox.value);
      setHasLoaded(true);
      setLoadError("");
      setLastCheckedAt(new Date());
    } else {
      console.warn("[palaver] Inbox refresh failed:", errorName(inbox.reason));
      setLoadError(
        describeMessagingError(
          inbox.reason,
          "load staff messages",
          isDeviceOnline(),
        ),
      );
    }
    if (announcements.status === "fulfilled") {
      setBroadcasts(announcements.value);
      setBroadcastsFailed(false);
    } else {
      console.warn(
        "[palaver] Announcements refresh failed:",
        errorName(announcements.reason),
      );
      setBroadcastsFailed(true);
    }
    setRefreshing(false);
    setLoading(false);
  }, [userId, userRole, configured]);

  const loadConversation = useCallback(
    async (otherId: string, quiet = false) => {
      if (!userId || !configured || !isDeviceOnline()) return;
      const seq = ++conversationSeq.current;
      if (!quiet) setConversationLoading(true);
      try {
        const list = await palaverRoom.getConversation(userId, otherId);
        if (seq !== conversationSeq.current || activeIdRef.current !== otherId) {
          return;
        }
        setConversation(list);
        setConversationError("");
        const hasUnread = list.some(
          (m) =>
            m.recipient_id === userId && m.sender_id !== userId && !m.is_read,
        );
        if (hasUnread && canMessageStaff(userRole)) {
          const marked = await palaverRoom.markConversationRead(
            userId,
            otherId,
          );
          if (marked) void loadData();
        }
      } catch (err) {
        console.warn("[palaver] Conversation load failed:", errorName(err));
        if (seq === conversationSeq.current && activeIdRef.current === otherId) {
          setConversationError(
            describeMessagingError(
              err,
              "load this conversation",
              isDeviceOnline(),
            ),
          );
        }
      } finally {
        if (seq === conversationSeq.current) setConversationLoading(false);
      }
    },
    [userId, userRole, configured, loadData],
  );

  const refreshAll = useCallback(() => {
    void loadData();
    const openId = activeIdRef.current;
    if (openId) void loadConversation(openId, true);
  }, [loadData, loadConversation]);

  useEffect(() => {
    if (!userId || !userRole) return;
    refreshAll();
    const timer = setInterval(refreshAll, POLL_SECONDS * 1000);
    return () => clearInterval(timer);
  }, [refreshAll, userId, userRole]);

  // Refresh as soon as the device reconnects.
  const wasOnline = useRef(online);
  useEffect(() => {
    if (online && !wasOnline.current) refreshAll();
    wasOnline.current = online;
  }, [online, refreshAll]);

  const liveSources = userId
    ? [
        { table: "palaver_messages", filter: `recipient_id=eq.${userId}` },
        { table: "palaver_messages", filter: `sender_id=eq.${userId}` },
        { table: "palaver_broadcasts" },
      ]
    : [];
  const live = useLiveMessageUpdates(
    "palaver",
    liveSources,
    configured && online && !!userId,
    refreshAll,
  );

  // ── Unsent messages (in memory, survive closing the panel) ────────────────
  useEffect(() => {
    if (!userId) {
      setUnsent([]);
      return;
    }
    setUnsent(palaverUnsent.list(userId));
    return palaverUnsent.subscribe(() => setUnsent(palaverUnsent.list(userId)));
  }, [userId]);

  const deliver = useCallback(
    async (localId: string, params: SendMessageParams) => {
      if (!userId) return;
      if (!isDeviceOnline()) {
        palaverUnsent.update(userId, localId, {
          state: "waiting",
          errorText: undefined,
        });
        return;
      }
      palaverUnsent.update(userId, localId, {
        state: "sending",
        errorText: undefined,
      });
      try {
        const saved = await palaverRoom.sendMessage(params);
        if (!saved) {
          throw new PalaverError("not_configured", "Messaging is not set up.");
        }
        // Show the stored message straight away, then confirm with a reload.
        if (activeIdRef.current === params.recipientId) {
          setConversation((c) =>
            c.some((m) => m.id === saved.id) ? c : [...c, saved],
          );
        }
        setMessages((list) => [saved, ...list.filter((m) => m.id !== saved.id)]);
        palaverUnsent.remove(userId, localId);
        refreshAll();
      } catch (err) {
        console.warn("[palaver] Message not sent:", errorName(err));
        const stillOnline = isDeviceOnline();
        palaverUnsent.update(
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
    [userId, refreshAll],
  );

  // Send anything that was waiting for a connection.
  useEffect(() => {
    if (!online || !userId || !configured) return;
    for (const m of palaverUnsent.list(userId)) {
      if (m.state === "waiting") void deliver(m.localId, m.params);
    }
  }, [online, userId, configured, deliver]);

  // ── Derived ────────────────────────────────────────────────────────────────
  const threads = useMemo(
    () => (userId ? buildPalaverThreads(messages, userId) : []),
    [messages, userId],
  );
  const totalUnread = threads.reduce((sum, t) => sum + t.unreadCount, 0);
  const urgentAnnouncements = broadcasts.filter(
    (b) => b.priority === "urgent" || b.priority === "critical",
  ).length;
  const activeId = active?.id ?? null;
  const threadUnsent = activeId
    ? unsent.filter((m) => m.threadKey === activeId)
    : [];
  const summary = summariseConnection({
    configured,
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

  // Move focus to the heading when the view changes (not on first render).
  const firstView = useRef(true);
  useEffect(() => {
    if (firstView.current) {
      firstView.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [view]);

  // Keep the newest message in view.
  const conversationSize = conversation.length + threadUnsent.length;
  useEffect(() => {
    if (view === "conversation") endRef.current?.scrollIntoView({ block: "end" });
  }, [view, conversationSize, activeId]);

  // ── Navigation ─────────────────────────────────────────────────────────────
  const openConversation = (colleague: Colleague) => {
    activeIdRef.current = colleague.id;
    setActive(colleague);
    // Show what the inbox already has (works offline), then load full history.
    setConversation(
      threads.find((t) => t.otherId === colleague.id)?.messages ?? [],
    );
    setConversationError("");
    setReply(userId ? palaverDrafts.get(userId, colleague.id) : "");
    setReplyPriority("normal");
    setReplySubjectOverride(null);
    setReplyError("");
    setActionError("");
    setView("conversation");
    void loadConversation(colleague.id);
  };

  const goToList = () => {
    activeIdRef.current = null;
    setActive(null);
    setConversation([]);
    setConversationError("");
    setActionError("");
    setBroadcastError("");
    setView("list");
  };

  const startCompose = () => {
    setComposeErrors({});
    setActionError("");
    setView("compose");
  };

  const startBroadcast = () => {
    setBroadcastErrors({});
    setBroadcastError("");
    setActionError("");
    setView("broadcast");
  };

  // ── Sending ────────────────────────────────────────────────────────────────
  const queueMessage = (
    to: Colleague,
    subject: string,
    body: string,
    priority: MessagePriority,
  ): boolean => {
    if (!currentUser) return false;
    if (!userId) {
      setActionError("Sign in online to use messaging. Nothing was sent.");
      return false;
    }
    if (!canMessageStaff(currentUser.role)) {
      setActionError("Your role can read staff messages but not send them.");
      return false;
    }
    if (!configured) {
      setActionError(
        "Messaging is not set up on this device, so nothing can be sent.",
      );
      return false;
    }
    const params: SendMessageParams = {
      senderId: userId,
      senderName: currentUser.fullName,
      recipientId: to.id,
      recipientName: to.name,
      subject,
      body,
      priority,
      clientId: newMessageRowId(),
    };
    const localId = generateId();
    const nowOnline = isDeviceOnline();
    palaverUnsent.add(userId, {
      localId,
      threadKey: to.id,
      params,
      state: nowOnline ? "sending" : "waiting",
      createdAt: new Date().toISOString(),
    });
    if (nowOnline) void deliver(localId, params);
    return true;
  };

  const lastSubject =
    conversation[conversation.length - 1]?.subject ??
    threadUnsent[threadUnsent.length - 1]?.params.subject;
  const defaultReplySubject = replySubject(lastSubject);

  const sendReply = (e?: FormEvent) => {
    e?.preventDefault();
    if (!active) return;
    const body = reply.trim();
    if (!body) {
      setReplyError("Write a message before sending.");
      return;
    }
    const subject =
      (replySubjectOverride ?? "").trim() || defaultReplySubject;
    if (queueMessage(active, subject, body, replyPriority)) {
      setReply("");
      if (userId) palaverDrafts.set(userId, active.id, "");
      setReplyError("");
      setReplyPriority("normal");
      setReplySubjectOverride(null);
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
    const recipient = recipients.find((u) => u.id === compose.recipientId);
    const errors: typeof composeErrors = {};
    if (!recipient) errors.recipientId = "Choose who to send this to.";
    if (!compose.subject.trim()) errors.subject = "Add a subject.";
    if (!compose.body.trim()) errors.body = "Write a message.";
    setComposeErrors(errors);
    if (!recipient || Object.keys(errors).length > 0) return;
    const to = { id: recipient.id, name: recipient.fullName };
    if (
      queueMessage(to, compose.subject.trim(), compose.body.trim(), compose.priority)
    ) {
      setCompose(EMPTY_COMPOSE);
      openConversation(to);
    }
  };

  const submitBroadcast = async (e: FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    if (!userId) {
      setBroadcastError("Sign in online to use messaging. Nothing was posted.");
      return;
    }
    if (!canPostAnnouncements(currentUser.role)) {
      setBroadcastError(
        "Only doctors, lead clinicians and admins can post announcements.",
      );
      return;
    }
    const errors: typeof broadcastErrors = {};
    if (!broadcastForm.subject.trim()) errors.subject = "Add a subject.";
    if (!broadcastForm.body.trim()) errors.body = "Write the announcement.";
    setBroadcastErrors(errors);
    if (Object.keys(errors).length > 0) return;
    if (!configured) {
      setBroadcastError(
        "Messaging is not set up on this device, so nothing can be posted.",
      );
      return;
    }
    if (!isDeviceOnline()) {
      setBroadcastError(
        "Announcements need a connection. Nothing was posted; try again when this device is back online.",
      );
      return;
    }

    setBroadcastSending(true);
    setBroadcastError("");
    try {
      const saved = await palaverRoom.sendBroadcast({
        senderId: userId,
        senderName: currentUser.fullName,
        targetRole: broadcastForm.targetRole,
        subject: broadcastForm.subject.trim(),
        body: broadcastForm.body.trim(),
        priority: broadcastForm.priority,
      });
      if (!saved) {
        throw new PalaverError("not_configured", "Messaging is not set up.");
      }
      push({
        id: generateId(),
        tone: "success",
        title: "Announcement posted",
        body: `Posted to ${TARGET_ROLE_LABEL[broadcastForm.targetRole]}.`,
      });
      setBroadcastForm(EMPTY_BROADCAST);
      setBroadcasts((list) => [saved, ...list.filter((b) => b.id !== saved.id)]);
      setListTab("announcements");
      goToList();
      void loadData();
    } catch (err) {
      console.warn("[palaver] Announcement not posted:", errorName(err));
      setBroadcastError(
        describeMessagingError(err, "post the announcement", isDeviceOnline()),
      );
    } finally {
      setBroadcastSending(false);
    }
  };

  // ── Archive / delete ───────────────────────────────────────────────────────
  const guardChange = (): boolean => {
    if (!currentUser || !canMessageStaff(currentUser.role)) {
      setActionError("Your role can read staff messages but not change them.");
      return false;
    }
    if (!configured) {
      setActionError("Messaging is not set up on this device.");
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
    id: string,
    action: string,
    fn: () => Promise<void>,
  ) => {
    setBusyId(id);
    setActionError("");
    try {
      await fn();
    } catch (err) {
      console.warn(`[palaver] Could not ${action}:`, errorName(err));
      setActionError(describeMessagingError(err, action, isDeviceOnline()));
    } finally {
      setBusyId(null);
    }
  };

  // One stored row serves both people in a conversation, so archiving or
  // deleting it changes the colleague's inbox as well; the prompts say so.
  const otherPartyName = (m: PalaverMessage) =>
    (m.sender_id === userId ? m.recipient_name : m.sender_name) ||
    "your colleague";

  const archiveMessage = (m: PalaverMessage) => {
    if (!guardChange()) return;
    if (
      !window.confirm(
        `Archive "${m.subject}"? It will be hidden from the inbox for you and for ${otherPartyName(m)}.`,
      )
    ) {
      return;
    }
    void runAction(m.id, "archive the message", async () => {
      await palaverRoom.archiveMessage(m.id);
      setConversation((c) =>
        c.map((x) => (x.id === m.id ? { ...x, is_archived: true } : x)),
      );
      setMessages((list) => list.filter((x) => x.id !== m.id));
      push({
        id: generateId(),
        tone: "success",
        title: "Message archived",
        body: "It is hidden from both inboxes and kept in this conversation's history.",
      });
      refreshAll();
    });
  };

  const deleteMessage = (m: PalaverMessage) => {
    if (!guardChange()) return;
    if (
      !window.confirm(
        `Permanently delete "${m.subject}"? It is removed for you and for ${otherPartyName(m)}. This cannot be undone.`,
      )
    ) {
      return;
    }
    void runAction(m.id, "delete the message", async () => {
      await palaverRoom.deleteMessage(m.id);
      setConversation((c) => c.filter((x) => x.id !== m.id));
      setMessages((list) => list.filter((x) => x.id !== m.id));
      push({ id: generateId(), tone: "success", title: "Message deleted" });
      refreshAll();
    });
  };

  const archiveConversation = () => {
    if (!active || !userId || !guardChange()) return;
    const who = active;
    if (
      !window.confirm(
        `Archive the entire conversation with ${who.name}? It will be hidden from the inbox for you and for ${who.name}.`,
      )
    ) {
      return;
    }
    void runAction(`thread:${who.id}`, "archive the conversation", async () => {
      const { archived, total } = await palaverRoom.archiveConversation(
        userId,
        who.id,
      );
      if (total === 0) {
        setActionError(
          "Nothing was archived: the online service has no messages in this conversation.",
        );
        void loadData();
        return;
      }
      if (archived === 0) {
        throw new PalaverError("no_rows", "Nothing was archived.");
      }
      if (archived < total) {
        push({
          id: generateId(),
          tone: "warning",
          title: "Conversation partly archived",
          body: `${archived} of ${total} messages were archived. The online service did not let this account change the rest.`,
        });
      } else {
        push({
          id: generateId(),
          tone: "success",
          title: "Conversation archived",
          body: `It is hidden from the inbox for you and for ${who.name}.`,
        });
      }
      goToList();
      void loadData();
    });
  };

  const dismissBroadcast = (b: PalaverBroadcast) => {
    if (!currentUser || !userId || b.sender_id !== userId) {
      setActionError("Only the person who posted an announcement can remove it.");
      return;
    }
    if (!canPostAnnouncements(currentUser.role)) {
      setActionError(
        "Only doctors, lead clinicians and admins can remove announcements.",
      );
      return;
    }
    if (!guardChange()) return;
    if (
      !window.confirm(
        `Remove the announcement "${b.subject}"? It will be removed for everyone.`,
      )
    ) {
      return;
    }
    void runAction(b.id, "remove the announcement", async () => {
      await palaverRoom.deleteBroadcast(b.id);
      setBroadcasts((list) => list.filter((x) => x.id !== b.id));
      push({
        id: generateId(),
        tone: "success",
        title: "Announcement removed",
        body: "It is no longer shown to anyone.",
      });
    });
  };

  const retryUnsent = (m: Unsent) => {
    if (!currentUser || !canMessageStaff(currentUser.role)) {
      setActionError("Your role can read staff messages but not send them.");
      return;
    }
    void deliver(m.localId, m.params);
  };

  const discardUnsent = (m: Unsent) => {
    if (!userId) return;
    if (!window.confirm("Discard this unsent message? Its text will be lost.")) {
      return;
    }
    palaverUnsent.remove(userId, m.localId);
  };

  // ── Rendering ──────────────────────────────────────────────────────────────
  const title =
    view === "conversation" && active
      ? active.name
      : view === "compose"
        ? "New message"
        : view === "broadcast"
          ? "New announcement"
          : "Palaver Room";
  const subtitle =
    view === "conversation" && active
      ? `${roleOf(active.id) ?? "Staff"} · Palaver Room`
      : view === "list"
        ? totalUnread > 0
          ? `Staff messages · ${totalUnread} unread`
          : "Staff messages and announcements"
        : "Palaver Room";

  const containerClass = isPanel
    ? "flex h-full flex-col overflow-hidden bg-surface"
    : "panel mx-auto flex max-w-4xl flex-col overflow-hidden";

  const priorityOptions = PRIORITIES.map((p) => (
    <option key={p} value={p}>
      {PRIORITY_LABEL[p]}
    </option>
  ));

  const renderThreadList = () => {
    if (loading && !hasLoaded) {
      return <ThreadListSkeleton label="Loading staff messages" />;
    }
    if (!hasLoaded && loadError) {
      return (
        <EmptyState
          icon={ExclamationTriangleIcon}
          title="Could not load staff messages"
          description={loadError}
          action={
            <button type="button" onClick={refreshAll} className="btn-secondary">
              Try again
            </button>
          }
        />
      );
    }
    if (!hasLoaded && !online) {
      return (
        <EmptyState
          icon={SignalSlashIcon}
          title="You're offline"
          description="Staff messages are kept on the online service and none have been loaded on this device yet. They load when the connection returns."
        />
      );
    }
    if (threads.length === 0) {
      return (
        <EmptyState
          icon={InboxIcon}
          title="No staff messages"
          description="Messages you send to or receive from colleagues appear here."
        />
      );
    }
    return (
      <ul className="divide-y divide-line border-t border-line">
        {threads.map((t) => {
          const unread = t.unreadCount > 0;
          const role = roleOf(t.otherId);
          const notSent = unsent.filter((m) => m.threadKey === t.otherId).length;
          return (
            <li key={t.otherId}>
              <button
                type="button"
                onClick={() => openConversation({ id: t.otherId, name: t.otherName })}
                className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
              >
                <span
                  aria-hidden
                  className={`mt-2 h-2 w-2 shrink-0 rounded-full ${unread ? "bg-primary" : "bg-transparent"}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span
                      className={`truncate text-body text-ink ${unread ? "font-semibold" : ""}`}
                    >
                      {t.otherName}
                    </span>
                    <MessageTime value={t.latest.created_at} />
                  </span>
                  {role && (
                    <span className="block text-caption text-ink-muted">
                      {role}
                    </span>
                  )}
                  <span
                    className={`mt-0.5 block truncate text-label ${unread ? "text-ink" : "text-ink-secondary"}`}
                  >
                    {t.latest.subject}
                  </span>
                  <span className="block truncate text-caption text-ink-muted">
                    {t.latest.sender_id === userId ? "You: " : ""}
                    {t.latest.body}
                  </span>
                  {(unread || notSent > 0) && (
                    <span className="mt-1.5 flex flex-wrap gap-1.5">
                      {unread && (
                        <StatusBadge tone="info">
                          {t.unreadCount} unread
                        </StatusBadge>
                      )}
                      <PriorityBadge priority={t.topUnreadPriority} />
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
  };

  // Unsent messages whose conversation is not in the list yet.
  const orphanUnsent = unsent.filter(
    (m) => !threads.some((t) => t.otherId === m.threadKey),
  );

  const renderConversationsTab = () => (
    <div>
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <p className="text-caption text-ink-muted">
          {hasLoaded
            ? `${threads.length} conversation${threads.length === 1 ? "" : "s"}`
            : ""}
        </p>
        {mayMessage && (
          <button type="button" onClick={startCompose} className="btn-primary">
            <PencilSquareIcon className="h-4 w-4" aria-hidden />
            New message
          </button>
        )}
      </div>
      {urgentAnnouncements > 0 && (
        <div className="banner banner-warning mx-4 mb-3">
          <MegaphoneIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <div className="flex-1">
            <p>
              {urgentAnnouncements} urgent or critical announcement
              {urgentAnnouncements === 1 ? "" : "s"}.
            </p>
            <button
              type="button"
              onClick={() => setListTab("announcements")}
              className="mt-1 min-h-touch-target font-semibold underline"
            >
              View announcements
            </button>
          </div>
        </div>
      )}
      {orphanUnsent.length > 0 && (
        <div className="banner banner-warning mx-4 mb-3" role="status">
          <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <div className="flex-1">
            <p>
              {orphanUnsent.length} message{orphanUnsent.length === 1 ? "" : "s"}{" "}
              not sent yet.
            </p>
            <ul className="mt-1">
              {orphanUnsent.map((m) => (
                <li key={m.localId}>
                  <button
                    type="button"
                    onClick={() =>
                      openConversation({
                        id: m.params.recipientId,
                        name: m.params.recipientName,
                      })
                    }
                    className="min-h-touch-target font-semibold underline"
                  >
                    To {m.params.recipientName}: open
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
      {renderThreadList()}
    </div>
  );

  const renderAnnouncementsTab = () => (
    <div>
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <p className="text-caption text-ink-muted">
          Announcements go to everyone in the chosen staff group.
        </p>
        {mayAnnounce && (
          <button
            type="button"
            onClick={startBroadcast}
            className="btn-secondary shrink-0"
          >
            <MegaphoneIcon className="h-4 w-4" aria-hidden />
            New announcement
          </button>
        )}
      </div>
      {broadcastsFailed && (
        <div className="banner banner-warning mx-4 mb-3" role="alert">
          <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <p>
            Announcements could not be loaded.
            {broadcasts.length > 0 ? " Showing the last ones loaded." : ""}
          </p>
        </div>
      )}
      {broadcasts.length === 0 ? (
        !broadcastsFailed && (
          <EmptyState
            icon={MegaphoneIcon}
            title="No announcements"
            description="Current announcements for your role appear here."
          />
        )
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {broadcasts.map((b) => {
            const mine = b.sender_id === userId;
            return (
              <li key={b.id} className="px-4 py-3">
                <article aria-labelledby={`${uid}-ann-${b.id}`}>
                  <div className="flex items-start justify-between gap-2">
                    <h3 id={`${uid}-ann-${b.id}`} className="text-h3 text-ink">
                      {b.subject}
                    </h3>
                    <MessageTime value={b.created_at} className="mt-1" />
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <PriorityBadge priority={b.priority} />
                    <StatusBadge tone="neutral">
                      To {TARGET_ROLE_LABEL[b.target_role] ?? b.target_role}
                    </StatusBadge>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap break-words text-body text-ink">
                    {b.body}
                  </p>
                  <p className="mt-1 text-caption text-ink-muted">
                    From {mine ? "you" : b.sender_name}
                    {b.expires_at
                      ? ` · shown until ${formatFullTimestamp(b.expires_at)}`
                      : ""}
                  </p>
                  {mine && mayAnnounce && (
                    <button
                      type="button"
                      onClick={() => dismissBroadcast(b)}
                      disabled={busyId === b.id}
                      className="btn-ghost mt-1 px-2 text-caption"
                      aria-label={`Remove for everyone: ${b.subject}`}
                    >
                      <XMarkIcon className="h-4 w-4" aria-hidden />
                      Remove for everyone
                    </button>
                  )}
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );

  const renderMessage = (m: PalaverMessage) => {
    const mine = m.sender_id === userId;
    const senderRole = mine ? null : roleOf(m.sender_id);
    return (
      <li key={m.id} className={mine ? "ml-8" : "mr-8"}>
        <article
          className={`rounded-lg border px-3 py-2.5 ${mine ? "border-line-strong bg-surface" : "border-line bg-surface-sunken"}`}
        >
          <header className="flex flex-wrap items-baseline justify-between gap-x-2">
            <p className="text-label text-ink">
              {mine ? "You" : m.sender_name}
              {senderRole && (
                <span className="font-normal text-ink-muted"> · {senderRole}</span>
              )}
            </p>
            <MessageTime value={m.created_at} />
          </header>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            <p className="text-caption text-ink-muted">{m.subject}</p>
            <PriorityBadge priority={m.priority} />
            {m.is_archived && <StatusBadge tone="neutral">Archived</StatusBadge>}
          </div>
          <p className="mt-1.5 whitespace-pre-wrap break-words text-body text-ink">
            {m.body}
          </p>
          <footer className="mt-1 flex flex-wrap items-center justify-between gap-x-2">
            {mine ? <SentStatus read={m.is_read} readAt={m.read_at} /> : <span />}
            {mayMessage && (
              <span className="flex">
                {!m.is_archived && (
                  <button
                    type="button"
                    onClick={() => archiveMessage(m)}
                    disabled={busyId === m.id}
                    className="btn-ghost px-2 text-caption"
                    aria-label={`Archive message: ${m.subject}`}
                  >
                    <ArchiveBoxIcon className="h-4 w-4" aria-hidden />
                    Archive
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => deleteMessage(m)}
                  disabled={busyId === m.id}
                  className="btn-ghost px-2 text-caption text-danger-fg hover:text-danger-fg"
                  aria-label={`Delete message: ${m.subject}`}
                >
                  <TrashIcon className="h-4 w-4" aria-hidden />
                  Delete
                </button>
              </span>
            )}
          </footer>
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
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
          <p className="text-caption text-ink-muted">{m.params.subject}</p>
          <PriorityBadge priority={m.params.priority} />
        </div>
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
    const replyId = `${uid}-reply`;
    const replyHintId = `${uid}-reply-hint`;
    const priorityId = `${uid}-reply-priority`;
    const subjectId = `${uid}-reply-subject`;
    return (
      <>
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-4 py-1">
          <p className="min-w-0 truncate text-caption text-ink-muted">
            {conversation.length} message{conversation.length === 1 ? "" : "s"}
            {threadUnsent.length > 0 ? ` · ${threadUnsent.length} not sent` : ""}
          </p>
          {mayMessage && conversation.length > 0 && (
            <button
              type="button"
              onClick={archiveConversation}
              disabled={busyId === `thread:${active.id}`}
              className="btn-ghost shrink-0 px-2 text-caption"
            >
              <ArchiveBoxIcon className="h-4 w-4" aria-hidden />
              Archive conversation
            </button>
          )}
        </div>
        <div
          className="flex-1 overflow-y-auto px-4 py-3"
          aria-busy={conversationLoading}
        >
          {conversationError && (
            <div className="banner banner-warning mb-3" role="alert">
              <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
              <p>{conversationError}</p>
            </div>
          )}
          {conversationLoading && conversation.length === 0 ? (
            <ThreadListSkeleton label="Loading conversation" />
          ) : conversation.length === 0 && threadUnsent.length === 0 ? (
            <p className="py-6 text-center text-body text-ink-muted">
              No messages with {active.name} yet.
            </p>
          ) : (
            <ol className="space-y-3" aria-label={`Messages with ${active.name}`}>
              {conversation.map(renderMessage)}
              {threadUnsent.map(renderUnsent)}
            </ol>
          )}
          <div ref={endRef} />
        </div>
        {!mayMessage ? (
          <p className="shrink-0 border-t border-line px-4 py-3 text-caption text-ink-muted">
            Your role can read staff messages but not send them.
          </p>
        ) : (
          <form
            onSubmit={sendReply}
            noValidate
            className="shrink-0 space-y-2 border-t border-line bg-surface px-4 py-3"
          >
            <label htmlFor={replyId} className="field-label">
              Reply to {active.name}
            </label>
            <textarea
              id={replyId}
              rows={3}
              value={reply}
              onChange={(e) => {
                setReply(e.target.value);
                if (userId) palaverDrafts.set(userId, active.id, e.target.value);
                if (replyError) setReplyError("");
              }}
              onKeyDown={onReplyKeyDown}
              placeholder="Type your reply"
              aria-invalid={replyError ? true : undefined}
              aria-describedby={replyHintId}
              className="input-field resize-none"
            />
            {replyError && (
              <p className="field-error" role="alert">
                {replyError}
              </p>
            )}
            {replySubjectOverride === null ? (
              <p className="flex flex-wrap items-center gap-x-1 text-caption text-ink-muted">
                <span className="min-w-0 truncate">
                  Subject: {defaultReplySubject}
                </span>
                <button
                  type="button"
                  onClick={() => setReplySubjectOverride(defaultReplySubject)}
                  className="btn-ghost px-2 text-caption"
                >
                  Change subject
                </button>
              </p>
            ) : (
              <div>
                <label htmlFor={subjectId} className="field-label">
                  Subject
                </label>
                <input
                  id={subjectId}
                  type="text"
                  value={replySubjectOverride}
                  onChange={(e) => setReplySubjectOverride(e.target.value)}
                  className="input-field"
                />
              </div>
            )}
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label htmlFor={priorityId} className="field-label">
                  Priority
                </label>
                <select
                  id={priorityId}
                  value={replyPriority}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (isMessagePriority(v)) setReplyPriority(v);
                  }}
                  className="input-field w-auto"
                >
                  {priorityOptions}
                </select>
              </div>
              <button type="submit" className="btn-primary ml-auto">
                <PaperAirplaneIcon className="h-4 w-4" aria-hidden />
                {online ? "Send reply" : "Send when back online"}
              </button>
            </div>
            <p id={replyHintId} className="field-hint">
              {online
                ? "Ctrl + Enter also sends. Messages are kept on the online service, not on this device."
                : "You're offline. The reply waits on this screen and sends when the connection returns. It is lost if the app is reloaded."}
            </p>
          </form>
        )}
      </>
    );
  };

  const renderCompose = () => {
    const toId = `${uid}-to`;
    const subjectId = `${uid}-subject`;
    const priorityId = `${uid}-priority`;
    const bodyId = `${uid}-body`;
    return (
      <form
        onSubmit={submitCompose}
        noValidate
        className="flex-1 space-y-4 overflow-y-auto px-4 py-4"
      >
        <div>
          <label htmlFor={toId} className="field-label">
            To
          </label>
          <select
            id={toId}
            value={compose.recipientId}
            onChange={(e) =>
              setCompose({ ...compose, recipientId: e.target.value })
            }
            aria-invalid={composeErrors.recipientId ? true : undefined}
            aria-describedby={composeErrors.recipientId ? `${toId}-error` : undefined}
            className="input-field"
          >
            <option value="">Choose a colleague</option>
            {recipients.map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName} ({getRoleDisplayName(u.role)})
              </option>
            ))}
          </select>
          {recipients.length === 0 && (
            <p className="field-hint">
              No other active doctors, nurses or admins with an online staff
              account are registered on this device. Colleagues appear here
              when this device has their online staff account, for example
              after they first sign in online on it.
            </p>
          )}
          {composeErrors.recipientId && (
            <p id={`${toId}-error`} className="field-error">
              {composeErrors.recipientId}
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
            value={compose.subject}
            onChange={(e) => setCompose({ ...compose, subject: e.target.value })}
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
          <label htmlFor={priorityId} className="field-label">
            Priority
          </label>
          <select
            id={priorityId}
            value={compose.priority}
            onChange={(e) => {
              const v = e.target.value;
              if (isMessagePriority(v)) setCompose({ ...compose, priority: v });
            }}
            className="input-field"
          >
            {priorityOptions}
          </select>
          <p className="field-hint">
            Urgent and critical messages are flagged in the colleague's inbox.
          </p>
        </div>

        <div>
          <label htmlFor={bodyId} className="field-label">
            Message
          </label>
          <textarea
            id={bodyId}
            rows={6}
            value={compose.body}
            onChange={(e) => setCompose({ ...compose, body: e.target.value })}
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
          {online
            ? "Messages are kept on the online service, not on this device."
            : "You're offline. The message waits on this screen and sends when the connection returns. It is lost if the app is reloaded."}
        </p>

        <div className="flex gap-2">
          <button type="submit" className="btn-primary flex-1">
            <PaperAirplaneIcon className="h-4 w-4" aria-hidden />
            {online ? "Send message" : "Send when back online"}
          </button>
          <button type="button" onClick={goToList} className="btn-secondary">
            Cancel
          </button>
        </div>
      </form>
    );
  };

  const renderBroadcast = () => {
    const targetId = `${uid}-target`;
    const subjectId = `${uid}-ann-subject`;
    const priorityId = `${uid}-ann-priority`;
    const bodyId = `${uid}-ann-body`;
    return (
      <form
        onSubmit={submitBroadcast}
        noValidate
        className="flex-1 space-y-4 overflow-y-auto px-4 py-4"
      >
        <p className="text-body text-ink-secondary">
          Everyone in the chosen group sees this in their Palaver Room until
          you remove it.
        </p>

        {broadcastError && (
          <div className="banner banner-danger" role="alert">
            <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            <p>{broadcastError}</p>
          </div>
        )}

        <div>
          <label htmlFor={targetId} className="field-label">
            Send to
          </label>
          <select
            id={targetId}
            value={broadcastForm.targetRole}
            onChange={(e) => {
              const v = e.target.value;
              if (isTargetRole(v)) setBroadcastForm({ ...broadcastForm, targetRole: v });
            }}
            className="input-field"
          >
            {TARGET_ROLES.map((r) => (
              <option key={r} value={r}>
                {TARGET_ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor={subjectId} className="field-label">
            Subject
          </label>
          <input
            id={subjectId}
            type="text"
            value={broadcastForm.subject}
            onChange={(e) =>
              setBroadcastForm({ ...broadcastForm, subject: e.target.value })
            }
            aria-invalid={broadcastErrors.subject ? true : undefined}
            aria-describedby={broadcastErrors.subject ? `${subjectId}-error` : undefined}
            className="input-field"
          />
          {broadcastErrors.subject && (
            <p id={`${subjectId}-error`} className="field-error">
              {broadcastErrors.subject}
            </p>
          )}
        </div>

        <div>
          <label htmlFor={priorityId} className="field-label">
            Priority
          </label>
          <select
            id={priorityId}
            value={broadcastForm.priority}
            onChange={(e) => {
              const v = e.target.value;
              if (isMessagePriority(v)) setBroadcastForm({ ...broadcastForm, priority: v });
            }}
            className="input-field"
          >
            {priorityOptions}
          </select>
        </div>

        <div>
          <label htmlFor={bodyId} className="field-label">
            Announcement
          </label>
          <textarea
            id={bodyId}
            rows={6}
            value={broadcastForm.body}
            onChange={(e) =>
              setBroadcastForm({ ...broadcastForm, body: e.target.value })
            }
            aria-invalid={broadcastErrors.body ? true : undefined}
            aria-describedby={broadcastErrors.body ? `${bodyId}-error` : undefined}
            className="input-field resize-none"
          />
          {broadcastErrors.body && (
            <p id={`${bodyId}-error`} className="field-error">
              {broadcastErrors.body}
            </p>
          )}
        </div>

        {!online && (
          <p className="field-hint">
            Announcements need a connection. Nothing is posted while this
            device is offline.
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={broadcastSending || !online}
            className="btn-primary flex-1"
          >
            <MegaphoneIcon className="h-4 w-4" aria-hidden />
            {broadcastSending ? "Posting…" : "Post announcement"}
          </button>
          <button type="button" onClick={goToList} className="btn-secondary">
            Cancel
          </button>
        </div>
      </form>
    );
  };

  const renderBody = () => {
    if (!currentUser) {
      return (
        <EmptyState
          icon={ChatBubbleLeftRightIcon}
          title="Sign in to use the Palaver Room"
          description="Staff messages are tied to your account."
        />
      );
    }
    if (!configured) {
      return (
        <EmptyState
          icon={ExclamationTriangleIcon}
          title="Staff messaging is not set up on this device"
          description="Palaver Room messages are kept on the online service, which is not configured here. Ask your administrator to connect this device."
          action={
            availability.details && (
              <details className="text-left text-caption text-ink-muted">
                <summary className="cursor-pointer">Technical details</summary>
                <p className="mt-1">{availability.details}</p>
              </details>
            )
          }
        />
      );
    }
    if (onlineStaffId === undefined) {
      return <ThreadListSkeleton label="Checking your online sign-in" />;
    }
    if (onlineStaffId === null) {
      return (
        <EmptyState
          icon={ExclamationTriangleIcon}
          title="Sign in online to use messaging"
          description="Staff messages are sent and read with your own online staff account, and this device has no online sign-in for you (for example, it was unlocked with a PIN only). Nothing can be sent or read here until you do. Sign out, then sign in online with your email and password while connected to the internet."
        />
      );
    }
    if (view === "conversation") return renderConversation();
    if (view === "compose") return renderCompose();
    if (view === "broadcast") return renderBroadcast();
    return (
      <>
        <Tabs
          tabs={[
            {
              id: "conversations",
              label: "Conversations",
              badge: totalUnread > 0 ? `${totalUnread} unread` : undefined,
            },
            {
              id: "announcements",
              label: "Announcements",
              badge: broadcasts.length > 0 ? String(broadcasts.length) : undefined,
            },
          ]}
          active={listTab}
          onChange={(id) => {
            if (isListTab(id)) setListTab(id);
          }}
          idPrefix={TABS_ID}
          label="Palaver Room sections"
          className="shrink-0 px-2"
        />
        <div
          role="tabpanel"
          id={panelId(TABS_ID, listTab)}
          aria-labelledby={tabId(TABS_ID, listTab)}
          className="flex-1 overflow-y-auto"
        >
          {listTab === "conversations"
            ? renderConversationsTab()
            : renderAnnouncementsTab()}
        </div>
      </>
    );
  };

  return (
    <div
      ref={rootRef}
      role={dialog ? "dialog" : "region"}
      aria-modal={dialog ? true : undefined}
      aria-labelledby={headingId}
      className={containerClass}
    >
      <PanelHeader
        headingId={headingId}
        headingRef={headingRef}
        title={title}
        subtitle={subtitle}
        icon={ChatBubbleLeftRightIcon}
        onBack={view !== "list" ? goToList : undefined}
        backLabel="Back to Palaver Room"
        onClose={onClose}
        closeLabel="Close Palaver Room"
      />
      {currentUser && userId && (
        <ConnectionBar
          summary={summary}
          lastCheckedAt={lastCheckedAt}
          refreshing={refreshing}
          onRefresh={refreshAll}
        />
      )}
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

export default PalaverRoom;
