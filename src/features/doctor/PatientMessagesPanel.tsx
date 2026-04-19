import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeftIcon,
  PencilSquareIcon,
  MagnifyingGlassIcon,
  PaperAirplaneIcon,
  XMarkIcon,
  InboxIcon,
} from "@heroicons/react/24/outline";
import { useAuthStore } from "@/stores/auth";
import {
  getDoctorMessageInbox,
  getDoctorUnreadCount,
  markMessageRead,
  searchPatientsByName,
  sendDoctorMessage,
  type PatientSearchResult,
  type PatientSecureMessage,
} from "@/services/patientSecureMessaging";

type ViewMode = "inbox" | "compose";

interface PatientMessagesPanelProps {
  onClose?: () => void;
  onUnreadChange?: (count: number) => void;
}

export function PatientMessagesPanel({
  onClose,
  onUnreadChange,
}: PatientMessagesPanelProps) {
  const { currentUser } = useAuthStore();
  const [viewMode, setViewMode] = useState<ViewMode>("inbox");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<PatientSecureMessage[]>([]);
  const [patientNames, setPatientNames] = useState<Map<string, string>>(
    new Map(),
  );
  const [error, setError] = useState("");

  const [query, setQuery] = useState("");
  const [patientResults, setPatientResults] = useState<PatientSearchResult[]>(
    [],
  );
  const [selectedPatient, setSelectedPatient] =
    useState<PatientSearchResult | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const loadData = useCallback(async () => {
    if (!currentUser?.id) return;
    setLoading(true);
    setError("");

    try {
      const [{ messages: inboxMessages, patientNames: names }, unread] =
        await Promise.all([
          getDoctorMessageInbox(currentUser.id),
          getDoctorUnreadCount(currentUser.id),
        ]);
      setMessages(inboxMessages);
      setPatientNames(names);
      onUnreadChange?.(unread);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load messages");
    } finally {
      setLoading(false);
    }
  }, [currentUser?.id, onUnreadChange]);

  useEffect(() => {
    loadData();
    const timer = setInterval(loadData, 30000);
    return () => clearInterval(timer);
  }, [loadData]);

  useEffect(() => {
    const search = async () => {
      if (query.trim().length < 2) {
        setPatientResults([]);
        return;
      }

      try {
        const results = await searchPatientsByName(query);
        setPatientResults(results);
      } catch {
        setPatientResults([]);
      }
    };

    const timeout = setTimeout(search, 200);
    return () => clearTimeout(timeout);
  }, [query]);

  const openCompose = () => {
    setViewMode("compose");
    setError("");
  };

  const resetCompose = () => {
    setQuery("");
    setPatientResults([]);
    setSelectedPatient(null);
    setSubject("");
    setBody("");
  };

  const handleSend = async () => {
    if (!currentUser) return;
    if (!selectedPatient || !subject.trim() || !body.trim()) {
      setError("Please select a patient and fill in subject and message.");
      return;
    }

    setSending(true);
    setError("");

    try {
      await sendDoctorMessage({
        staffId: currentUser.id,
        staffName: currentUser.fullName,
        patientId: selectedPatient.id,
        subject,
        body,
      });
      resetCompose();
      setViewMode("inbox");
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setSending(false);
    }
  };

  const groupedMessages = useMemo(() => {
    const map = new Map<string, PatientSecureMessage[]>();
    messages.forEach((message) => {
      const existing = map.get(message.patient_id) || [];
      existing.push(message);
      map.set(message.patient_id, existing);
    });

    return Array.from(map.entries())
      .map(([patientId, thread]) => ({
        patientId,
        patientName:
          patientNames.get(patientId) || `Patient ${patientId.slice(0, 8)}`,
        latest: thread[0],
        unread: thread.filter((m) => m.from_patient && !m.read).length,
      }))
      .sort(
        (a, b) =>
          new Date(b.latest.created_at).getTime() -
          new Date(a.latest.created_at).getTime(),
      );
  }, [messages, patientNames]);

  const openThreadPreview = async (message: PatientSecureMessage) => {
    if (!message.read && message.from_patient) {
      try {
        await markMessageRead(message.id);
        await loadData();
      } catch {
        // non-blocking
      }
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-lg overflow-hidden h-full flex flex-col">
      <div className="bg-gradient-to-r from-indigo-600 to-blue-600 text-white p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {viewMode === "compose" ? (
              <button
                onClick={() => {
                  setViewMode("inbox");
                  setError("");
                }}
                className="p-1 hover:bg-white/20 rounded-lg"
              >
                <ArrowLeftIcon className="h-5 w-5" />
              </button>
            ) : null}
            <div>
              <h2 className="text-xl font-bold">Patient Messages</h2>
              <p className="text-sm text-blue-100">
                {viewMode === "compose" ? "New Message" : "Inbox"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {viewMode === "inbox" && (
              <button
                onClick={openCompose}
                className="p-2 hover:bg-white/20 rounded-lg"
                aria-label="Compose new message"
              >
                <PencilSquareIcon className="h-5 w-5" />
              </button>
            )}
            {onClose && (
              <button
                onClick={onClose}
                className="p-2 hover:bg-white/20 rounded-lg"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="m-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="py-10 flex justify-center">
            <div className="h-8 w-8 rounded-full border-b-2 border-blue-600 animate-spin" />
          </div>
        ) : viewMode === "compose" ? (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                To (Patient) *
              </label>
              {!selectedPatient ? (
                <div className="space-y-2">
                  <div className="relative">
                    <MagnifyingGlassIcon className="h-5 w-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search patient by name..."
                      className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg"
                    />
                  </div>

                  {patientResults.length > 0 && (
                    <div className="border rounded-lg max-h-40 overflow-y-auto divide-y">
                      {patientResults.map((patient) => (
                        <button
                          key={patient.id}
                          type="button"
                          onClick={() => {
                            setSelectedPatient(patient);
                            setQuery(patient.fullName);
                            setPatientResults([]);
                          }}
                          className="w-full text-left px-3 py-2 hover:bg-gray-50"
                        >
                          {patient.fullName}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-between border border-blue-200 bg-blue-50 rounded-lg px-3 py-2">
                  <span className="text-sm font-medium text-blue-900">
                    {selectedPatient.fullName}
                  </span>
                  <button
                    type="button"
                    className="text-xs text-blue-700"
                    onClick={() => {
                      setSelectedPatient(null);
                      setQuery("");
                    }}
                  >
                    Change
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
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Message subject"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Message *
              </label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={7}
                placeholder="Type your message to the patient..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg resize-none"
              />
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={handleSend}
                disabled={sending}
                className="flex-1 py-2 px-3 bg-blue-600 text-white rounded-lg disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {sending ? (
                  <div className="h-4 w-4 rounded-full border-b-2 border-white animate-spin" />
                ) : (
                  <>
                    <PaperAirplaneIcon className="h-4 w-4" /> Send Message
                  </>
                )}
              </button>
              <button
                onClick={() => {
                  resetCompose();
                  setViewMode("inbox");
                }}
                className="px-4 py-2 border border-gray-300 rounded-lg"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : groupedMessages.length === 0 ? (
          <div className="text-center py-16">
            <InboxIcon className="h-12 w-12 text-gray-300 mx-auto mb-3" />
            <p className="font-medium text-gray-900">No patient messages yet</p>
            <p className="text-sm text-gray-500 mt-1 mb-4">
              Start a conversation to message a patient in their portal.
            </p>
            <button
              onClick={openCompose}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg"
            >
              Start a conversation
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {groupedMessages.map((thread) => (
              <button
                key={thread.latest.id}
                onClick={() => openThreadPreview(thread.latest)}
                className="w-full p-3 border rounded-lg text-left hover:bg-gray-50"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-gray-900">
                      {thread.patientName}
                    </p>
                    <p className="text-sm text-gray-700">
                      {thread.latest.subject}
                    </p>
                    <p className="text-sm text-gray-500 line-clamp-1">
                      {thread.latest.body}
                    </p>
                  </div>
                  <div className="text-right">
                    {thread.unread > 0 && (
                      <span className="inline-flex items-center justify-center min-w-5 h-5 px-1 text-xs font-semibold rounded-full bg-blue-600 text-white">
                        {thread.unread}
                      </span>
                    )}
                    <p className="text-xs text-gray-400 mt-1">
                      {new Date(thread.latest.created_at).toLocaleDateString()}
                    </p>
                  </div>
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
