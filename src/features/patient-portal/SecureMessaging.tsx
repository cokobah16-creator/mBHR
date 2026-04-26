import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import * as logger from "@/lib/logger";
import { formatNigerianDate } from "@/utils/dateFormat";
import {
  PaperAirplaneIcon,
  InboxIcon,
  UserCircleIcon,
  WifiIcon,
} from "@heroicons/react/24/outline";

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

const QUICK_MESSAGES = [
  "I am feeling pain",
  "I need help",
  "I missed my medication",
  "I have a question",
];

export function SecureMessaging() {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showCompose, setShowCompose] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [replyStaffId, setReplyStaffId] = useState<string | null>(null);
  const [newMessage, setNewMessage] = useState({ subject: "", body: "" });
  const isOffline = !supabase;

  useEffect(() => {
    loadMessages();

    if (!supabase) return;

    const channel = supabase
      .channel("secure_messages")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "patient_secure_messages",
        },
        () => {
          loadMessages();
        },
      )
      .subscribe();

    return () => {
      supabase!.removeChannel(channel);
    };
  }, []);

  const loadMessages = async () => {
    setLoading(true);
    setError("");

    try {
      const portalUserStr = localStorage.getItem("patient_portal_user");
      if (!portalUserStr) {
        setError("Session not found. Please log in again.");
        setLoading(false);
        return;
      }

      const portalUser = JSON.parse(portalUserStr);
      if (!portalUser.patientId) {
        setError("Session data incomplete. Please log in again.");
        setLoading(false);
        return;
      }

      if (!supabase) {
        setMessages([]);
        return;
      }

      const { data, error: messagesError } = await supabase
        .from("patient_secure_messages")
        .select("*")
        .eq("patient_id", portalUser.patientId)
        .order("created_at", { ascending: false });

      if (messagesError) throw messagesError;

      setMessages(data || []);
    } catch (err) {
      logger.error("Error loading messages:", err);
      setError("Failed to load messages");
    } finally {
      setLoading(false);
    }
  };

  const sendMessage = async () => {
    if (!newMessage.subject.trim() || !newMessage.body.trim()) {
      setError("Subject and message are required");
      return;
    }

    if (!supabase) {
      const offline: Message = {
        id: crypto.randomUUID(),
        subject: newMessage.subject,
        body: newMessage.body,
        from_patient: true,
        from_name: "You",
        created_at: new Date().toISOString(),
        read: true,
        patient_id: "",
      };
      const queue: Message[] = JSON.parse(
        localStorage.getItem("patient_message_queue") || "[]",
      );
      queue.push(offline);
      localStorage.setItem("patient_message_queue", JSON.stringify(queue));
      setSuccess("Message saved. It will be sent when you connect.");
      setNewMessage({ subject: "", body: "" });
      setShowCompose(false);
      return;
    }

    setSending(true);
    setError("");
    setSuccess("");

    try {
      const portalUserStr = localStorage.getItem("patient_portal_user");
      if (!portalUserStr) {
        navigate("/patient/login", { replace: true });
        return;
      }

      const portalUser = JSON.parse(portalUserStr);

      const { data: patient } = await supabase
        .from("patients")
        .select("given_name, family_name")
        .eq("id", portalUser.patientId)
        .maybeSingle();

      const fromName = patient
        ? `${patient.given_name} ${patient.family_name}`
        : "Patient";

      const { error: insertError } = await supabase
        .from("patient_secure_messages")
        .insert({
          patient_id: portalUser.patientId,
          staff_id: replyStaffId,
          subject: newMessage.subject,
          body: newMessage.body,
          from_patient: true,
          from_name: fromName,
          read: false,
        });

      if (insertError) throw insertError;

      setSuccess("Message sent successfully");
      setNewMessage({ subject: "", body: "" });
      setShowCompose(false);
      setReplyStaffId(null);
      await loadMessages();
    } catch (err) {
      logger.error("Error sending message:", err);
      setError("Failed to send message");
    } finally {
      setSending(false);
    }
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
      logger.error("Error marking message as read:", err);
    }
  };

  const openMessage = (message: Message) => {
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
    setShowCompose(true);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading messages...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Secure Messaging
            </h1>
            <p className="mt-2 text-gray-600">
              Communicate securely with your healthcare providers
            </p>
          </div>
          <button
            onClick={() => {
              setReplyStaffId(null);
              setShowCompose(true);
            }}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            New Message
          </button>
        </div>

        {isOffline && (
          <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-3">
            <WifiIcon className="w-5 h-5 text-amber-600 flex-shrink-0" />
            <p className="text-sm text-amber-800">
              Offline mode — messages will sync when you connect to the
              internet.
            </p>
          </div>
        )}

        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        {success && (
          <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg">
            <p className="text-sm text-green-800">{success}</p>
          </div>
        )}

        {showCompose && (
          <div className="mb-6 bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold mb-4">Compose New Message</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Subject
                </label>
                <input
                  type="text"
                  value={newMessage.subject}
                  onChange={(e) =>
                    setNewMessage({ ...newMessage, subject: e.target.value })
                  }
                  placeholder="Enter subject"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Quick Messages
                </label>
                <div className="flex flex-wrap gap-2 mb-3">
                  {QUICK_MESSAGES.map((msg) => (
                    <button
                      key={msg}
                      type="button"
                      onClick={() =>
                        setNewMessage({ ...newMessage, body: msg })
                      }
                      className="px-4 py-2 rounded-full text-sm font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 transition-colors min-h-[44px]"
                    >
                      {msg}
                    </button>
                  ))}
                </div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Message
                </label>
                <textarea
                  value={newMessage.body}
                  onChange={(e) =>
                    setNewMessage({ ...newMessage, body: e.target.value })
                  }
                  placeholder="Type your message here..."
                  rows={6}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={sendMessage}
                  disabled={sending}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  <PaperAirplaneIcon className="h-5 w-5" />
                  {sending ? "Sending..." : "Send Message"}
                </button>
                <button
                  onClick={() => setShowCompose(false)}
                  disabled={sending}
                  className="px-4 py-2 bg-gray-500 text-white rounded-md hover:bg-gray-600 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {selectedMessage ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="mb-4 flex items-center justify-between">
              <button
                onClick={() => setSelectedMessage(null)}
                className="text-blue-600 hover:text-blue-800"
              >
                ← Back to inbox
              </button>
              {!selectedMessage.from_patient && (
                <button
                  onClick={handleReply}
                  className="px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  Reply
                </button>
              )}
            </div>

            <div className="border-b border-gray-200 pb-4 mb-4">
              <h2 className="text-xl font-semibold text-gray-900">
                {selectedMessage.subject}
              </h2>
              <div className="mt-2 flex items-center gap-4 text-sm text-gray-600">
                <span className="flex items-center gap-1">
                  <UserCircleIcon className="h-5 w-5" />
                  {selectedMessage.from_patient
                    ? "You"
                    : selectedMessage.from_name}
                </span>
                <span>{formatNigerianDate(selectedMessage.created_at)}</span>
              </div>
            </div>

            <div className="prose max-w-none">
              <p className="whitespace-pre-wrap text-gray-900">
                {selectedMessage.body}
              </p>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            {messages.length === 0 ? (
              <div className="p-12 text-center">
                <InboxIcon className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">
                  No messages
                </h3>
                <p className="text-gray-600">
                  {isOffline
                    ? "Messages will appear here when you connect to the internet."
                    : "Start a conversation with your healthcare provider"}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-gray-200">
                {messages.map((message) => (
                  <button
                    key={message.id}
                    onClick={() => openMessage(message)}
                    className="w-full p-4 text-left hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h3
                            className={`font-medium ${
                              !message.read && !message.from_patient
                                ? "text-blue-600"
                                : "text-gray-900"
                            }`}
                          >
                            {message.subject}
                          </h3>
                          {!message.read && !message.from_patient && (
                            <span className="inline-block w-2 h-2 bg-blue-600 rounded-full"></span>
                          )}
                        </div>
                        <p className="text-sm text-gray-600 mt-1">
                          From:{" "}
                          {message.from_patient ? "You" : message.from_name}
                        </p>
                        <p className="text-sm text-gray-500 mt-1 line-clamp-2">
                          {message.body}
                        </p>
                      </div>
                      <span className="text-xs text-gray-500 ml-4 whitespace-nowrap">
                        {formatNigerianDate(message.created_at)}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
