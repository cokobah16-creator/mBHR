import { supabase } from '@/lib/supabase'
import logger from '@/lib/logger'

export type MessagePriority = 'normal' | 'urgent' | 'critical'
export type TargetRole = 'doctor' | 'nurse' | 'pharmacist' | 'all_clinical' | 'all_staff'

export interface PalaverMessage {
  id: string
  sender_id: string
  sender_name: string
  recipient_id: string
  recipient_name: string
  subject: string
  body: string
  priority: MessagePriority
  is_read: boolean
  read_at: string | null
  is_archived: boolean
  parent_id: string | null
  created_at: string
  updated_at: string
}

export interface PalaverBroadcast {
  id: string
  sender_id: string
  sender_name: string
  target_role: TargetRole
  subject: string
  body: string
  priority: MessagePriority
  expires_at: string | null
  is_active: boolean
  created_at: string
  is_read?: boolean
}

export interface SendMessageParams {
  senderId: string
  senderName: string
  recipientId: string
  recipientName: string
  subject: string
  body: string
  priority?: MessagePriority
  parentId?: string
}

export interface SendBroadcastParams {
  senderId: string
  senderName: string
  targetRole: TargetRole
  subject: string
  body: string
  priority?: MessagePriority
  expiresAt?: Date
}

class PalaverRoomService {
  async sendMessage(params: SendMessageParams): Promise<PalaverMessage | null> {
    if (!supabase) {
      logger.warn('Supabase not configured - message not sent')
      return null
    }

    const { data, error } = await supabase
      .from('palaver_messages')
      .insert({
        sender_id: params.senderId,
        sender_name: params.senderName,
        recipient_id: params.recipientId,
        recipient_name: params.recipientName,
        subject: params.subject,
        body: params.body,
        priority: params.priority || 'normal',
        parent_id: params.parentId || null
      })
      .select()
      .single()

    if (error) {
      logger.error('Failed to send message:', error)
      throw new Error(`Failed to send message: ${error.message}`)
    }

    logger.log(`Message sent from ${params.senderName} to ${params.recipientName}`)
    return data
  }

  async sendBroadcast(params: SendBroadcastParams): Promise<PalaverBroadcast | null> {
    if (!supabase) {
      logger.warn('Supabase not configured - broadcast not sent')
      return null
    }

    const { data, error } = await supabase
      .from('palaver_broadcasts')
      .insert({
        sender_id: params.senderId,
        sender_name: params.senderName,
        target_role: params.targetRole,
        subject: params.subject,
        body: params.body,
        priority: params.priority || 'normal',
        expires_at: params.expiresAt?.toISOString() || null
      })
      .select()
      .single()

    if (error) {
      logger.error('Failed to send broadcast:', error)
      throw new Error(`Failed to send broadcast: ${error.message}`)
    }

    logger.log(`Broadcast sent to ${params.targetRole} by ${params.senderName}`)
    return data
  }

  async getInboxMessages(userId: string): Promise<PalaverMessage[]> {
    if (!supabase) {
      logger.warn('Supabase not configured - cannot fetch inbox')
      throw new Error('Messaging service not available. Please check your connection.')
    }

    const { data, error } = await supabase
      .from('palaver_messages')
      .select('*')
      .eq('recipient_id', userId)
      .eq('is_archived', false)
      .order('created_at', { ascending: false })

    if (error) {
      logger.error('Failed to fetch inbox:', error)
      throw new Error(`Failed to load messages: ${error.message}`)
    }

    return data || []
  }

  async getSentMessages(userId: string): Promise<PalaverMessage[]> {
    if (!supabase) return []

    const { data, error } = await supabase
      .from('palaver_messages')
      .select('*')
      .eq('sender_id', userId)
      .order('created_at', { ascending: false })

    if (error) {
      logger.error('Failed to fetch sent messages:', error)
      return []
    }

    return data || []
  }

  async getUnreadCount(userId: string): Promise<number> {
    if (!supabase) return 0

    const { count, error } = await supabase
      .from('palaver_messages')
      .select('*', { count: 'exact', head: true })
      .eq('recipient_id', userId)
      .eq('is_read', false)
      .eq('is_archived', false)

    if (error) {
      logger.error('Failed to fetch unread count:', error)
      return 0
    }

    return count || 0
  }

  isAvailable(): boolean {
    return supabase !== null
  }

  async markAsRead(messageId: string): Promise<void> {
    if (!supabase) return

    const { error } = await supabase
      .from('palaver_messages')
      .update({
        is_read: true,
        read_at: new Date().toISOString()
      })
      .eq('id', messageId)

    if (error) {
      logger.error('Failed to mark message as read:', error)
    }
  }

  async archiveMessage(messageId: string): Promise<void> {
    if (!supabase) return

    const { error } = await supabase
      .from('palaver_messages')
      .update({ is_archived: true })
      .eq('id', messageId)

    if (error) {
      logger.error('Failed to archive message:', error)
    }
  }

  async getBroadcasts(userRole: string): Promise<PalaverBroadcast[]> {
    if (!supabase) {
      logger.warn('Supabase not configured - cannot fetch broadcasts')
      return []
    }

    const roleTargets = this.getRoleTargets(userRole)

    const { data, error } = await supabase
      .from('palaver_broadcasts')
      .select('*')
      .eq('is_active', true)
      .in('target_role', roleTargets)
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .order('created_at', { ascending: false })

    if (error) {
      logger.error('Failed to fetch broadcasts:', error)
      return []
    }

    return data || []
  }

  async markBroadcastRead(broadcastId: string, userId: string): Promise<void> {
    if (!supabase) return

    const { error } = await supabase
      .from('palaver_broadcast_reads')
      .upsert({
        broadcast_id: broadcastId,
        user_id: userId,
        read_at: new Date().toISOString()
      }, {
        onConflict: 'broadcast_id,user_id'
      })

    if (error) {
      logger.error('Failed to mark broadcast as read:', error)
    }
  }

  async getConversation(userId: string, otherUserId: string): Promise<PalaverMessage[]> {
    if (!supabase) return []

    try {
      const { data: sent, error: sentError } = await supabase
        .from('palaver_messages')
        .select('*')
        .eq('sender_id', userId)
        .eq('recipient_id', otherUserId)

      const { data: received, error: receivedError } = await supabase
        .from('palaver_messages')
        .select('*')
        .eq('sender_id', otherUserId)
        .eq('recipient_id', userId)

      if (sentError) {
        logger.error('Failed to fetch sent messages:', sentError)
        return []
      }
      if (receivedError) {
        logger.error('Failed to fetch received messages:', receivedError)
        return []
      }

      const allMessages = [...(sent || []), ...(received || [])]
      allMessages.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

      return allMessages
    } catch (err) {
      logger.error('Failed to fetch conversation:', err)
      return []
    }
  }

  async getMessageThread(parentId: string): Promise<PalaverMessage[]> {
    if (!supabase) return []

    try {
      const { data: parent, error: parentError } = await supabase
        .from('palaver_messages')
        .select('*')
        .eq('id', parentId)

      const { data: replies, error: repliesError } = await supabase
        .from('palaver_messages')
        .select('*')
        .eq('parent_id', parentId)

      if (parentError) {
        logger.error('Failed to fetch parent message:', parentError)
        return []
      }
      if (repliesError) {
        logger.error('Failed to fetch replies:', repliesError)
        return []
      }

      const allMessages = [...(parent || []), ...(replies || [])]
      allMessages.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

      return allMessages
    } catch (err) {
      logger.error('Failed to fetch thread:', err)
      return []
    }
  }

  private getRoleTargets(role: string): TargetRole[] {
    const targets: TargetRole[] = ['all_staff']

    if (['doctor', 'nurse', 'pharmacist'].includes(role)) {
      targets.push('all_clinical')
    }

    if (role === 'doctor') targets.push('doctor')
    if (role === 'nurse') targets.push('nurse')
    if (role === 'pharmacist') targets.push('pharmacist')

    return targets
  }
}

export const palaverRoom = new PalaverRoomService()
