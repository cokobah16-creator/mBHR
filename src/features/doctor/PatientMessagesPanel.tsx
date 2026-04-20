import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth";
import { formatNigerianDate } from "@/utils/dateFormat";
import {
  InboxIcon,
  UserCircleIcon,
  PaperAirplaneIcon,
  XMarkIcon,
  ArrowLeftIcon,
  ExclamationTriangleIcon,
  PencilSquareIcon,
  MagnifyingGlassIcon,
} from "@heroicons/react/24/outline";

interface PatientMessage {
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

interface PatientThread {
  patient_id: string;
  patient_name: string;
  latest_message: PatientMessage;
  unread_count: number;
  messages: PatientMessage[];
}

interface PatientSearchResult {
  id: string;
  given_name: string;
  family_name: string;
}

type ViewMode = "inbox" | "conversation" | "compose";

interface PatientMessagesPanelProps {
  onClose?: () => void;
  onUnreadChange?: (count: number) => void;
}

export function PatientMessagesPanel({
  onClose,
  onUnreadChange,
}: PatientMessagesPanelProps) {
  const { currentUser } = useAuthStore();
  const [threads, setThreads] = useState<PatientThread[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(
    null,
  );
  const [viewMode, setViewMode] = useState<ViewMode>("inbox");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [replyBody, setReplyBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  // Compose state
  const [patientSearch, setPatientSearch] = useState("");
  const [patientResults, setPatientResults] = useState<PatientSearchResult[]>(
    [],
  );
  const [selectedPatient, setSelectedPatient] =
    useState<PatientSearchResult | null>(null);
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [searching, setSearching] = useState(false);

  const loadMessages = useCallback(async () => {
    if (!supabase) {
      setLoadError(
        "Messaging service is not configured. Please check your database connection.",
      );
      setLoading(false);
      return;
    }

    setLoadError("");
    try {
      const { data, error: fetchError } = await supabase
        .from("patient_secure_messages")
        .select("*")
        .order("created_at", { ascending: false });

      if (fetchError) throw fetchError;

      const messages: PatientMessage[] = data || [];

      const threadMap = new Map<string, PatientMessage[]>();
      for (const msg of messages) {
        const existing = threadMap.get(msg.patient_id) || [];
        existing.push(msg);
        threadMap.set(msg.patient_id, existing);
      }

      const threadList: PatientThread[] = [];
      for (const [patient_id, msgs] of threadMap) {
        const sorted = [...msgs].sort(
          (a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        );
        const patientMsg = msgs.find((m) => m.from_patient);
        const patient_name = patientMsg?.from_name || "Unknown Patient";
        const unread_count = msgs.filter(
          (m) => m.from_patient && !m.read,
        ).length;
        threadList.push({
          patient_id,
          patient_name,
          latest_message: msgs[0],
          unread_count,
          messages: sorted,
        });
      }

      threadList.sort(
        (a, b) =>
          new Date(b.latest_message.created_at).getTime() -
          new Date(a.latest_message.created_at).getTime(),
      );

      setThreads(threadList);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "Failed to load messages",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMessages();

    if (!supabase) return;

    const channel = supabase
      .channel("staff_patient_messages")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "patient_secure_messages" },
        () => loadMessages(),
      )
      .subscribe();

    return () => {
      supabase!.removeChannel(channel);
    };
  }, [loadMessages]);

  const searchPatients = useCallback(async (query: string) => {
    if (!supabase || query.trim().length < 2) {
      setPatientResults([]);
      return;
    }
    setSearching(true);
    try {
      const { data } = await supabase
        .from("patients")
        .select("id, given_name, family_name")
        .or(`given_name.ilike.%${query}%,family_name.ilike.%${query}%`)
        .limit(8);
      setPatientResults(data || []);
    } catch {
      setPatientResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => searchPatients(patientSearch), 300);
    return () => clearTimeout(t);
  }, [patientSearch, searchPatients]);

  const openThread = async (thread: PatientThread) => {
    setSelectedPatientId(thread.patient_id);
    setViewMode("conversation");
    setError("");
    setReplyBody("");

    if (!supabase || thread.unread_count === 0) return;

    const unreadIds = thread.messages
      .filter((m) => m.from_patient && !m.read)
      .map((m) => m.id);

    if (unreadIds.length > 0) {
      await supabase
        .from("patient_secure_messages")
        .update({ read: true })
        .in("id", unreadIds);
      loadMessages();
    }
  };

  const sendReply = async () => {
    if (!replyBody.trim() || !selectedThread || !currentUser || !supabase)
      return;

    setSending(true);
    setError("");
    try {
      const { error: insertError } = await supabase
        .from("patient_secure_messages")
        .insert({
          patient_id: selectedThread.patient_id,
          subject: selectedThread.latest_message.subject.startsWith("Re:")
            ? selectedThread.latest_message.subject
            : `Re: ${selectedThread.latest_message.subject}`,
          body: replyBody.trim(),
          from_patient: false,
          from_name: currentUser.fullName,
          staff_id: currentUser.id,
          read: true,
        });

      if (insertError) throw insertError;
      setReplyBody("");
      await loadMessages();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send reply");
    } finally {
      setSending(false);
    }
  };

  const sendNewMessage = async () => {
    if (
      !selectedPatient ||
      !composeSubject.trim() ||
      !composeBody.trim() ||
      !currentUser ||
      !supabase
    )
      return;

    setSending(true);
    setError("");
    try {
      const { error: insertError } = await supabase
        .from("patient_secure_messages")
        .insert({
          patient_id: selectedPatient.id,
          subject: composeSubject.trim(),
          body: composeBody.trim(),
          from_patient: false,
          from_name: currentUser.fullName,
          staff_id: currentUser.id,
          read: true,
        });

      if (insertError) throw insertError;

      // Open the thread we just created
      setSelectedPatientId(selectedPatient.id);
      setViewMode("conversation");
      setSelectedPatient(null);
      setPatientSearch("");
      setComposeSubject("");
      setComposeBody("");
      await loadMessages();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setSending(false);
    }
  };

  const goToInbox = () => {
    setViewMode("inbox");
    setSelectedPatientId(null);
    setSelectedPatient(null);
    setPatientSearch("");
    setComposeSubject("");
    setComposeBody("");
    setError("");
  };

  const selectedThread =
    threads.find((t) => t.patient_id === selectedPatientId) ?? null;
  const totalUnread = threads.reduce((sum, t) => sum + t.unread_count, 0);

  useEffect(() => {
    onUnreadChange?.(totalUnread);
  }, [totalUnread, onUnreadChange]);

  const headerSubtitle =
    viewMode === "compose"
      ? "New Message"
      : viewMode === "conversation" && selectedThread
        ? selectedThread.patient_name
        : "Secure Inbox";

  return (
    <div className="bg-white rounded-lg shadow-lg overflow-hidden h-full flex flex-col">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {viewMode !== "inbox" && (
              <button
                onClick={goToInbox}
                className="p-1 hover:bg-white/20 rounded-lg transition-colors"
              >
                <ArrowLeftIcon className="h-5 w-5" />
              </button>
            )}
            <InboxIcon className="h-8 w-8" />
            <div>
              <h2 className="text-xl font-bold">Patient Messages</h2>
              <p className="text-sm text-blue-100">{headerSubtitle}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {totalUnread > 0 && viewMode === "inbox" && (
              <span className="px-2 py-1 bg-red-500 text-white text-sm font-bold rounded-full">
                {totalUnread} new
              </span>
            )}
            {viewMode === "inbox" && (
              <button
                onClick={() => setViewMode("compose")}
                className="p-2 hover:bg-white/20 rounded-lg transition-colors"
                title="New Message"
              >
                <PencilSquareIcon className="h-5 w-5" />
              </button>
            )}
            {onClose && (
              <button
                onClick={onClose}
                className="p-2 hover:bg-white/20 rounded-lg transition-colors"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col">
        {loadError ? (
          <div className="flex flex-col items-center justify-center py-12">
            <ExclamationTriangleIcon className="h-12 w-12 text-orange-500 mb-4" />
            <p className="text-gray-700 text-center mb-4">{loadError}</p>
            <button
              onClick={loadMessages}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Try Again
            </button>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        ) : viewMode === "compose" ? (
          /* Compose new message */
          <div className="flex flex-col flex-1 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                To (Patient) *
              </label>
              <div className="relative">
                <MagnifyingGlassIcon className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  value={
                    selectedPatient
                      ? `${selectedPatient.given_name} ${selectedPatient.family_name}`
                      : patientSearch
                  }
                  onChange={(e) => {
                    setSelectedPatient(null);
                    setPatientSearch(e.target.value);
                  }}
                  placeholder="Search patient by name..."
                  className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                />
              </div>
              {!selectedPatient && patientSearch.length >= 2 && (
                <div className="mt-1 border border-gray-200 rounded-lg shadow-sm bg-white max-h-40 overflow-y-auto">
                  {searching ? (
                    <p className="text-xs text-gray-500 p-3">Searching...</p>
                  ) : patientResults.length === 0 ? (
                    <p className="text-xs text-gray-500 p-3">
                      No patients found
                    </p>
                  ) : (
                    patientResults.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => {
                          setSelectedPatient(p);
                          setPatientSearch("");
                          setPatientResults([]);
                        }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 flex items-center gap-2"
                      >
                        <UserCircleIcon className="h-5 w-5 text-gray-400 flex-shrink-0" />
                        {p.given_name} {p.family_name}
                      </button>
                    ))
                  )}
                </div>
              )}
              {selectedPatient && (
                <div className="mt-1 flex items-center gap-2 text-sm text-blue-700 bg-blue-50 px-3 py-1.5 rounded-lg">
                  <UserCircleIcon className="h-4 w-4" />
                  {selectedPatient.given_name} {selectedPatient.family_name}
                  <button
                    onClick={() => setSelectedPatient(null)}
                    className="ml-auto text-gray-400 hover:text-gray-600"
                  >
                    <XMarkIcon className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Subject *
              </label>
              <input
                type="text"
                value={composeSubject}
                onChange={(e) => setComposeSubject(e.target.value)}
                placeholder="Message subject"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
              />
            </div>

            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Message *
              </label>
              <textarea
                value={composeBody}
                onChange={(e) => setComposeBody(e.target.value)}
                placeholder="Type your message to the patient..."
                rows={6}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none text-sm"
              />
            </div>

            {error && <p className="text-red-600 text-sm">{error}</p>}

            <div className="flex gap-2">
              <button
                onClick={sendNewMessage}
                disabled={
                  sending ||
                  !selectedPatient ||
                  !composeSubject.trim() ||
                  !composeBody.trim()
                }
                className="flex-1 flex items-center justify-center gap-2 py-2 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm"
              >
                <PaperAirplaneIcon className="h-4 w-4" />
                {sending ? "Sending..." : "Send Message"}
              </button>
              <button
                onClick={goToInbox}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : viewMode === "conversation" && selectedThread ? (
          /* Conversation view */
          <div className="flex flex-col flex-1">
            <div className="flex-1 space-y-3 mb-4">
              {selectedThread.messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`p-3 rounded-lg ${
                    msg.from_patient
                      ? "bg-gray-50 border border-gray-200 mr-8"
                      : "bg-blue-50 border border-blue-200 ml-8"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <UserCircleIcon className="h-5 w-5 text-gray-400" />
                      <span className="font-medium text-sm text-gray-900">
                        {msg.from_patient
                          ? msg.from_name
                          : `${msg.from_name} (Staff)`}
                      </span>
                    </div>
                    <span className="text-xs text-gray-500">
                      {formatNigerianDate(msg.created_at)}
                    </span>
                  </div>
                  <p className="text-xs font-medium text-gray-500 mb-1">
                    {msg.subject}
                  </p>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">
                    {msg.body}
                  </p>
                </div>
              ))}
            </div>

            {error && <p className="text-red-600 text-sm mb-2">{error}</p>}
            <div className="border-t pt-3 mt-auto">
              <textarea
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
                placeholder="Type your reply to the patient..."
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none text-sm"
              />
              <button
                onClick={sendReply}
                disabled={sending || !replyBody.trim()}
                className="mt-2 w-full flex items-center justify-center gap-2 py-2 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm"
              >
                <PaperAirplaneIcon className="h-4 w-4" />
                {sending ? "Sending..." : "Send Reply"}
              </button>
            </div>
          </div>
        ) : threads.length === 0 ? (
          /* Empty inbox */
          <div className="flex flex-col items-center justify-center flex-1 text-gray-500">
            <InboxIcon className="h-12 w-12 mx-auto mb-3 text-gray-300" />
            <p className="font-medium">No patient messages yet</p>
            <p className="text-sm mt-1 mb-4">
              Messages from patients will appear here
            </p>
            <button
              onClick={() => setViewMode("compose")}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
            >
              <PencilSquareIcon className="h-4 w-4" />
              Start a conversation
            </button>
          </div>
        ) : (
          /* Thread list */
          <div className="space-y-2">
            {threads.map((thread) => (
              <button
                key={thread.patient_id}
                onClick={() => openThread(thread)}
                className={`w-full text-left p-3 rounded-lg border transition-colors ${
                  thread.unread_count > 0
                    ? "bg-blue-50 border-blue-200 hover:bg-blue-100"
                    : "bg-white border-gray-200 hover:bg-gray-50"
                }`}
              >
                <div className="flex items-start gap-3">
                  <UserCircleIcon className="h-10 w-10 text-gray-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <span
                        className={`font-medium text-sm ${thread.unread_count > 0 ? "text-gray-900" : "text-gray-700"}`}
                      >
                        {thread.patient_name}
                      </span>
                      <span className="text-xs text-gray-500 ml-2 flex-shrink-0">
                        {formatNigerianDate(thread.latest_message.created_at)}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 truncate">
                      {thread.latest_message.subject}
                    </p>
                    <p className="text-xs text-gray-500 truncate">
                      {thread.latest_message.body}
                    </p>
                  </div>
                  {thread.unread_count > 0 && (
                    <span className="px-1.5 py-0.5 bg-blue-600 text-white text-xs font-bold rounded-full flex-shrink-0 mt-1">
                      {thread.unread_count}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default PatientMessagesPanel;
