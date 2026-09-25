import { supabase } from "@/lib/supabase";
import logger from "@/lib/logger";

// Palaver Room: direct messages and announcements between staff.
// "Palaver" is West African Pidgin for a discussion or conference.
//
// Messages live only in Supabase (palaver_messages, palaver_broadcasts).
// Nothing is stored on the device, so every call needs the online service.
//
// Logging: only error codes/names are logged. Server error messages and
// details can echo row contents (names, message text), so they are never
// logged or passed to the UI.

export type MessagePriority = "normal" | "urgent" | "critical";
export type TargetRole =
  | "doctor"
  | "nurse"
  | "pharmacist"
  | "all_clinical"
  | "all_staff";

export interface PalaverMessage {
  id: string;
  sender_id: string;
  sender_name: string;
  recipient_id: string;
  recipient_name: string;
  subject: string;
  body: string;
  priority: MessagePriority;
  is_read: boolean;
  read_at: string | null;
  is_archived: boolean;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PalaverBroadcast {
  id: string;
  sender_id: string;
  sender_name: string;
  target_role: TargetRole;
  subject: string;
  body: string;
  priority: MessagePriority;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
  is_read?: boolean;
}

export interface SendMessageParams {
  senderId: string;
  senderName: string;
  recipientId: string;
  recipientName: string;
  subject: string;
  body: string;
  priority?: MessagePriority;
  parentId?: string;
  /**
   * Optional client-generated UUID for the stored row. Sending again with
   * the same id after a lost response does not store the message twice.
   */
  clientId?: string;
}

export interface SendBroadcastParams {
  senderId: string;
  senderName: string;
  targetRole: TargetRole;
  subject: string;
  body: string;
  priority?: MessagePriority;
  expiresAt?: Date;
}

export interface PalaverAvailabilityStatus {
  available: boolean;
  reason?: string;
  details?: string;
}

/**
 * Why a Palaver Room request did not complete.
 * - not_configured: no Supabase client on this device.
 * - no_rows: the request succeeded but changed nothing (usually the
 *   server's access rules did not allow it for this account).
 * - server: the online service returned an error.
 */
export type PalaverErrorReason = "not_configured" | "no_rows" | "server";

export class PalaverError extends Error {
  readonly reason: PalaverErrorReason;
  /** PostgREST / Postgres error code, when the server gave one. */
  readonly code?: string;

  constructor(reason: PalaverErrorReason, message: string, code?: string) {
    super(message);
    this.name = "PalaverError";
    this.reason = reason;
    this.code = code;
  }
}

function codeOf(err: unknown): string | undefined {
  if (err && typeof err === "object") {
    const c = (err as { code?: unknown }).code;
    if (typeof c === "string" && c) return c;
  }
  return undefined;
}

/** Log-safe tag for an error: its code or name, never its message. */
function errorTag(err: unknown): string {
  const code = codeOf(err);
  if (code) return code;
  if (err instanceof Error) return err.name;
  if (err && typeof err === "object") {
    const n = (err as { name?: unknown }).name;
    if (typeof n === "string" && n) return n;
  }
  return "unknown";
}

/**
 * Staff account the Palaver Room acts as. Messages are stored against the
 * online staff account (app_users.id, the Supabase auth user id) and the
 * server only lets that signed-in account read and send its own messages,
 * so a PIN-only unlock (no online session) cannot use messaging.
 * - signed_in: `id` is the online account id to send and read as.
 * - signed_out: no online session, or it belongs to someone else.
 */
export type PalaverStaffSession =
  | { status: "signed_in"; id: string }
  | { status: "signed_out" };

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether an id can be an online staff account id (app_users.id, a UUID).
 * Staff records created by a PIN-only setup use device ids and cannot
 * receive messages.
 */
export function isOnlineStaffId(id: string | null | undefined): boolean {
  return !!id && UUID.test(id);
}

// Ids are interpolated into a PostgREST `or` filter, so only accept the
// characters our ids use (ULIDs and UUIDs).
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

class PalaverRoomService {
  getAvailabilityStatus(): PalaverAvailabilityStatus {
    const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as
      | string
      | undefined;

    if (!url || !anonKey) {
      return {
        available: false,
        reason: "supabase_env_missing",
        details:
          "Missing VITE_SUPABASE_URL and/or VITE_SUPABASE_ANON_KEY in the client environment.",
      };
    }

    if (url === "your_supabase_project_url_here") {
      return {
        available: false,
        reason: "supabase_env_placeholder",
        details:
          "VITE_SUPABASE_URL is still set to a placeholder value and not a real Supabase project URL.",
      };
    }

    if (!supabase) {
      return {
        available: false,
        reason: "supabase_client_init_failed",
        details:
          "Supabase client initialization failed in the browser at runtime.",
      };
    }

    return { available: true };
  }

  /**
   * The online staff account for the person using the app, or signed_out.
   * The online session must belong to that person: the same id, or (for a
   * staff record first made on this device) the same email. Never throws.
   */
  async getStaffSession(localUser: {
    id: string;
    email?: string | null;
  }): Promise<PalaverStaffSession> {
    if (!supabase) return { status: "signed_out" };
    try {
      const { data } = await supabase.auth.getSession();
      const user = data?.session?.user;
      if (!user?.id || !isOnlineStaffId(user.id)) return { status: "signed_out" };
      const sameId = user.id === localUser.id;
      const sameEmail =
        !!user.email &&
        !!localUser.email &&
        user.email.toLowerCase() === localUser.email.toLowerCase();
      return sameId || sameEmail
        ? { status: "signed_in", id: user.id }
        : { status: "signed_out" };
    } catch (err) {
      logger.warn("[palaver] Could not read the online session:", errorTag(err));
      return { status: "signed_out" };
    }
  }

  /**
   * Calls `onChange` when the online sign-in changes (signed in, signed
   * out, token refreshed). Returns the unsubscribe function.
   */
  onStaffSessionChange(onChange: () => void): () => void {
    if (!supabase) return () => undefined;
    try {
      // The auth client must not be called from inside its own callback (it
      // can deadlock), and onChange reads the session again: run it after.
      const { data } = supabase.auth.onAuthStateChange(() => {
        setTimeout(onChange, 0);
      });
      return () => data?.subscription?.unsubscribe();
    } catch (err) {
      logger.warn("[palaver] Could not watch the online session:", errorTag(err));
      return () => undefined;
    }
  }

  /**
   * Returns the stored message, or null when Supabase is not configured on
   * this device (nothing was sent). Throws PalaverError on a server error.
   */
  async sendMessage(params: SendMessageParams): Promise<PalaverMessage | null> {
    if (!supabase) {
      logger.warn("[palaver] Supabase not configured - message not sent");
      return null;
    }

    const { data, error } = await supabase
      .from("palaver_messages")
      .insert({
        ...(params.clientId ? { id: params.clientId } : {}),
        sender_id: params.senderId,
        sender_name: params.senderName,
        recipient_id: params.recipientId,
        recipient_name: params.recipientName,
        subject: params.subject,
        body: params.body,
        priority: params.priority || "normal",
        parent_id: params.parentId || null,
      })
      .select()
      .single();

    // 23505 on a retry with the same client id: an earlier attempt was
    // stored but its response never arrived. Return the stored row.
    if (error && params.clientId && codeOf(error) === "23505") {
      const existing = await supabase
        .from("palaver_messages")
        .select("*")
        .eq("id", params.clientId)
        .maybeSingle();
      if (!existing.error && existing.data) {
        logger.log("[palaver] Message was already stored");
        return existing.data as PalaverMessage;
      }
    }

    if (error) {
      logger.error("[palaver] Send failed:", errorTag(error));
      throw new PalaverError(
        "server",
        "The message was not sent.",
        codeOf(error),
      );
    }

    logger.log("[palaver] Message sent");
    return data;
  }

  /**
   * Returns the stored announcement, or null when Supabase is not configured
   * on this device (nothing was posted).
   */
  async sendBroadcast(
    params: SendBroadcastParams,
  ): Promise<PalaverBroadcast | null> {
    if (!supabase) {
      logger.warn("[palaver] Supabase not configured - broadcast not sent");
      return null;
    }

    const { data, error } = await supabase
      .from("palaver_broadcasts")
      .insert({
        sender_id: params.senderId,
        sender_name: params.senderName,
        target_role: params.targetRole,
        subject: params.subject,
        body: params.body,
        priority: params.priority || "normal",
        expires_at: params.expiresAt?.toISOString() || null,
      })
      .select()
      .single();

    if (error) {
      logger.error("[palaver] Broadcast failed:", errorTag(error));
      throw new PalaverError(
        "server",
        "The announcement was not posted.",
        codeOf(error),
      );
    }

    logger.log(`[palaver] Broadcast posted to ${params.targetRole}`);
    return data;
  }

  /** Non-archived messages the user sent or received, newest first. */
  async getInboxMessages(userId: string): Promise<PalaverMessage[]> {
    if (!supabase) {
      logger.warn("[palaver] Supabase not configured - cannot fetch inbox");
      throw new PalaverError(
        "not_configured",
        "Messaging service not available. Please check your connection.",
      );
    }

    const { data: received, error: receivedError } = await supabase
      .from("palaver_messages")
      .select("*")
      .eq("recipient_id", userId)
      .eq("is_archived", false)
      .order("created_at", { ascending: false });

    if (receivedError) {
      logger.error("[palaver] Inbox fetch failed:", errorTag(receivedError));
      throw new PalaverError(
        "server",
        "Messages could not be loaded.",
        codeOf(receivedError),
      );
    }

    const { data: sent, error: sentError } = await supabase
      .from("palaver_messages")
      .select("*")
      .eq("sender_id", userId)
      .eq("is_archived", false)
      .order("created_at", { ascending: false });

    if (sentError) {
      logger.error("[palaver] Sent fetch failed:", errorTag(sentError));
      throw new PalaverError(
        "server",
        "Messages could not be loaded.",
        codeOf(sentError),
      );
    }

    const allMessages: PalaverMessage[] = [
      ...(received || []),
      ...(sent || []),
    ];
    const uniqueMessages = allMessages.filter(
      (msg, index, self) => self.findIndex((m) => m.id === msg.id) === index,
    );
    uniqueMessages.sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );

    return uniqueMessages;
  }

  async getSentMessages(userId: string): Promise<PalaverMessage[]> {
    if (!supabase) return [];

    const { data, error } = await supabase
      .from("palaver_messages")
      .select("*")
      .eq("sender_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      logger.error("[palaver] Sent fetch failed:", errorTag(error));
      return [];
    }

    return data || [];
  }

  /** Unread, non-archived messages received by the user. 0 on any failure. */
  async getUnreadCount(userId: string): Promise<number> {
    if (!supabase) return 0;

    const { count, error } = await supabase
      .from("palaver_messages")
      .select("*", { count: "exact", head: true })
      .eq("recipient_id", userId)
      .eq("is_read", false)
      .eq("is_archived", false);

    if (error) {
      logger.error("[palaver] Unread count failed:", errorTag(error));
      return 0;
    }

    return count || 0;
  }

  isAvailable(): boolean {
    return this.getAvailabilityStatus().available;
  }

  async markAsRead(messageId: string): Promise<void> {
    if (!supabase) return;

    const { error } = await supabase
      .from("palaver_messages")
      .update({
        is_read: true,
        read_at: new Date().toISOString(),
      })
      .eq("id", messageId);

    if (error) {
      logger.error("[palaver] Mark read failed:", errorTag(error));
    }
  }

  /**
   * Marks every unread message from `otherUserId` to `userId` as read.
   * Returns false when nothing could be updated (offline, not configured or
   * a server error); unread counts then stay as they are, which is accurate.
   */
  async markConversationRead(
    userId: string,
    otherUserId: string,
  ): Promise<boolean> {
    if (!supabase) return false;

    const { error } = await supabase
      .from("palaver_messages")
      .update({
        is_read: true,
        read_at: new Date().toISOString(),
      })
      .eq("recipient_id", userId)
      .eq("sender_id", otherUserId)
      .eq("is_read", false);

    if (error) {
      logger.error("[palaver] Mark conversation read failed:", errorTag(error));
      return false;
    }
    return true;
  }

  /** Throws PalaverError("no_rows") when the server changed nothing. */
  async archiveMessage(messageId: string): Promise<void> {
    if (!supabase) {
      throw new PalaverError("not_configured", "Messaging is not set up.");
    }

    const { data, error } = await supabase
      .from("palaver_messages")
      .update({ is_archived: true })
      .eq("id", messageId)
      .select("id");

    if (error) {
      logger.error("[palaver] Archive failed:", errorTag(error));
      throw new PalaverError(
        "server",
        "The message was not archived.",
        codeOf(error),
      );
    }
    if (!data || data.length === 0) {
      throw new PalaverError("no_rows", "The message was not archived.");
    }
  }

  /**
   * Archives every message between the two users. Returns how many of the
   * conversation's messages the server actually archived, so the caller can
   * say so when only some could be changed.
   */
  async archiveConversation(
    userId: string,
    otherUserId: string,
  ): Promise<{ archived: number; total: number }> {
    if (!supabase) {
      throw new PalaverError("not_configured", "Messaging is not set up.");
    }

    const conversation = await this.getConversation(userId, otherUserId);
    const ids = conversation.map((m) => m.id);
    if (ids.length === 0) return { archived: 0, total: 0 };

    const { data, error } = await supabase
      .from("palaver_messages")
      .update({ is_archived: true })
      .in("id", ids)
      .select("id");

    if (error) {
      logger.error("[palaver] Archive conversation failed:", errorTag(error));
      throw new PalaverError(
        "server",
        "The conversation was not archived.",
        codeOf(error),
      );
    }
    return { archived: data?.length ?? 0, total: ids.length };
  }

  /** Throws PalaverError("no_rows") when the server deleted nothing. */
  async deleteMessage(messageId: string): Promise<void> {
    if (!supabase) {
      throw new PalaverError("not_configured", "Messaging is not set up.");
    }

    const { data, error } = await supabase
      .from("palaver_messages")
      .delete()
      .eq("id", messageId)
      .select("id");

    if (error) {
      logger.error("[palaver] Delete failed:", errorTag(error));
      throw new PalaverError(
        "server",
        "The message was not deleted.",
        codeOf(error),
      );
    }
    if (!data || data.length === 0) {
      throw new PalaverError("no_rows", "The message was not deleted.");
    }
  }

  /**
   * Hides an announcement for everyone (sets is_active = false).
   * Throws PalaverError("no_rows") when the server changed nothing.
   */
  async deleteBroadcast(broadcastId: string): Promise<void> {
    if (!supabase) {
      throw new PalaverError("not_configured", "Messaging is not set up.");
    }

    const { data, error } = await supabase
      .from("palaver_broadcasts")
      .update({ is_active: false })
      .eq("id", broadcastId)
      .select("id");

    if (error) {
      logger.error("[palaver] Dismiss broadcast failed:", errorTag(error));
      throw new PalaverError(
        "server",
        "The announcement was not removed.",
        codeOf(error),
      );
    }
    if (!data || data.length === 0) {
      throw new PalaverError("no_rows", "The announcement was not removed.");
    }
  }

  /**
   * Active, unexpired announcements for the user's role, newest first.
   * When `userId` is given, the user's own announcements are included too,
   * whoever they were addressed to, so the sender can see and remove them.
   * Returns [] when Supabase is not configured; throws on a server error.
   */
  async getBroadcasts(
    userRole: string,
    userId?: string,
  ): Promise<PalaverBroadcast[]> {
    if (!supabase) {
      logger.warn("[palaver] Supabase not configured - cannot fetch broadcasts");
      return [];
    }

    const roleTargets = this.getRoleTargets(userRole);
    const ownId = userId && SAFE_ID.test(userId) ? userId : null;

    let query = supabase
      .from("palaver_broadcasts")
      .select("*")
      .eq("is_active", true);
    query = ownId
      ? query.or(
          `target_role.in.(${roleTargets.join(",")}),sender_id.eq.${ownId}`,
        )
      : query.in("target_role", roleTargets);

    const { data, error } = await query.order("created_at", {
      ascending: false,
    });

    if (error) {
      logger.error("[palaver] Broadcast fetch failed:", errorTag(error));
      throw new PalaverError(
        "server",
        "Announcements could not be loaded.",
        codeOf(error),
      );
    }

    const now = new Date();
    return ((data || []) as PalaverBroadcast[]).filter(
      (b) => !b.expires_at || new Date(b.expires_at) > now,
    );
  }

  async markBroadcastRead(broadcastId: string, userId: string): Promise<void> {
    if (!supabase) return;

    const { error } = await supabase.from("palaver_broadcast_reads").upsert(
      {
        broadcast_id: broadcastId,
        user_id: userId,
        read_at: new Date().toISOString(),
      },
      {
        onConflict: "broadcast_id,user_id",
      },
    );

    if (error) {
      logger.error("[palaver] Mark broadcast read failed:", errorTag(error));
    }
  }

  /**
   * Every message between the two users (including archived ones), oldest
   * first. Returns [] when Supabase is not configured; throws on a server
   * error so an empty conversation is never shown in place of a failure.
   */
  async getConversation(
    userId: string,
    otherUserId: string,
  ): Promise<PalaverMessage[]> {
    if (!supabase) return [];

    const { data: sent, error: sentError } = await supabase
      .from("palaver_messages")
      .select("*")
      .eq("sender_id", userId)
      .eq("recipient_id", otherUserId);

    if (sentError) {
      logger.error("[palaver] Conversation fetch failed:", errorTag(sentError));
      throw new PalaverError(
        "server",
        "The conversation could not be loaded.",
        codeOf(sentError),
      );
    }

    const { data: received, error: receivedError } = await supabase
      .from("palaver_messages")
      .select("*")
      .eq("sender_id", otherUserId)
      .eq("recipient_id", userId);

    if (receivedError) {
      logger.error(
        "[palaver] Conversation fetch failed:",
        errorTag(receivedError),
      );
      throw new PalaverError(
        "server",
        "The conversation could not be loaded.",
        codeOf(receivedError),
      );
    }

    // A message to yourself would appear in both lists.
    const byId = new Map<string, PalaverMessage>();
    for (const m of [...(sent || []), ...(received || [])] as PalaverMessage[]) {
      byId.set(m.id, m);
    }
    const allMessages = [...byId.values()];
    allMessages.sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );

    return allMessages;
  }

  async getMessageThread(parentId: string): Promise<PalaverMessage[]> {
    if (!supabase) return [];

    try {
      const { data: parent, error: parentError } = await supabase
        .from("palaver_messages")
        .select("*")
        .eq("id", parentId);

      const { data: replies, error: repliesError } = await supabase
        .from("palaver_messages")
        .select("*")
        .eq("parent_id", parentId);

      if (parentError) {
        logger.error("[palaver] Parent fetch failed:", errorTag(parentError));
        return [];
      }
      if (repliesError) {
        logger.error("[palaver] Replies fetch failed:", errorTag(repliesError));
        return [];
      }

      const allMessages = [...(parent || []), ...(replies || [])];
      allMessages.sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );

      return allMessages;
    } catch (err) {
      logger.error("[palaver] Thread fetch failed:", errorTag(err));
      return [];
    }
  }

  private getRoleTargets(role: string): TargetRole[] {
    const targets: TargetRole[] = ["all_staff"];

    if (["doctor", "nurse", "pharmacist"].includes(role)) {
      targets.push("all_clinical");
    }

    if (role === "doctor") targets.push("doctor");
    if (role === "nurse") targets.push("nurse");
    if (role === "pharmacist") targets.push("pharmacist");

    return targets;
  }
}

export const palaverRoom = new PalaverRoomService();
