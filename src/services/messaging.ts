import { outboxDb, MessageQueue, OutboundMessage } from '@/db/outbox'
import { db } from '@/db'
import { useT } from '@/hooks/useT'

export interface SMSGateway {
  send(message: OutboundMessage): Promise<{ success: boolean; messageId?: string; error?: string }>
}

// Termii SMS Gateway (popular in Nigeria)
export class TermiiGateway implements SMSGateway {
  constructor(
    private apiKey: string,
    private senderId: string = 'MBHR'
  ) {}

  async send(message: OutboundMessage): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      // Get template and render message
      const template = await outboxDb.messageTemplates
        .where('[key+locale]')
        .equals([message.templateKey, message.locale])
        .first()

      if (!template) {
        return { success: false, error: 'Template not found' }
      }

      const renderedMessage = MessageQueue.renderTemplate(template.body, message.payload)

      const response = await fetch('https://api.ng.termii.com/api/sms/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          to: message.to,
          from: this.senderId,
          sms: renderedMessage,
          type: 'plain',
          api_key: this.apiKey,
          channel: 'generic'
        })
      })

      const result = await response.json()

      if (response.ok && result.message_id) {
        return { success: true, messageId: result.message_id }
      } else {
        return { success: false, error: result.message || 'SMS send failed' }
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Network error' }
    }
  }
}

// Mock gateway for testing
export class MockGateway implements SMSGateway {
  async send(message: OutboundMessage): Promise<{ success: boolean; messageId?: string; error?: string }> {
    console.log('📱 Mock SMS sent:', {
      to: message.to,
      template: message.templateKey,
      payload: message.payload
    })
    
    // Simulate random success/failure for testing
    const success = Math.random() > 0.1 // 90% success rate
    
    return success 
      ? { success: true, messageId: `mock_${Date.now()}` }
      : { success: false, error: 'Mock delivery failure' }
  }
}

// Message service for the app
export class MessageService {
  private gateway: SMSGateway

  constructor(gateway: SMSGateway) {
    this.gateway = gateway
  }

  // Queue medication reminder
  async queueMedicationReminder(
    patientId: string,
    medicationName: string,
    dosage: string,
    frequency: string,
    scheduledFor?: Date
  ): Promise<string> {
    const patient = await db.patients.get(patientId)
    if (!patient) throw new Error('Patient not found')

    return MessageQueue.queueMessage(
      patientId,
      patient.phone,
      'followup.medication',
      {
        patientName: `${patient.givenName} ${patient.familyName}`,
        medicationName,
        dosage,
        frequency,
        clinicName: 'MBHR Clinic'
      },
      {
        channel: 'sms',
        locale: 'en', // TODO: Get from patient preferences
        scheduledFor
      }
    )
  }

  // Queue appointment reminder
  async queueAppointmentReminder(
    patientId: string,
    appointmentDate: Date,
    scheduledFor?: Date
  ): Promise<string> {
    const patient = await db.patients.get(patientId)
    if (!patient) throw new Error('Patient not found')

    return MessageQueue.queueMessage(
      patientId,
      patient.phone,
      'appointment.reminder',
      {
        patientName: `${patient.givenName} ${patient.familyName}`,
        date: appointmentDate.toLocaleDateString(),
        time: appointmentDate.toLocaleTimeString(),
        clinicName: 'MBHR Clinic'
      },
      {
        channel: 'sms',
        locale: 'en',
        scheduledFor
      }
    )
  }

  // Process outbox (send queued messages)
  async processOutbox(): Promise<{ sent: number; failed: number }> {
    const pending = await MessageQueue.getPendingMessages(50)
    let sent = 0
    let failed = 0

    for (const message of pending) {
      try {
        const result = await this.gateway.send(message)
        
        if (result.success) {
          await MessageQueue.markSent(message.id)
          sent++
        } else {
          await MessageQueue.markFailed(message.id, result.error || 'Unknown error')
          failed++
        }
      } catch (error) {
        await MessageQueue.markFailed(message.id, error instanceof Error ? error.message : 'Send failed')
        failed++
      }
    }

    return { sent, failed }
  }

  // Get outbox statistics
  async getStats() {
    return MessageQueue.getStats()
  }
}

// Default service instance
let messageService: MessageService | null = null

export function getMessageService(): MessageService {
  if (!messageService) {
    // Use mock gateway by default, can be configured with real gateway
    const gateway = new MockGateway()
    messageService = new MessageService(gateway)
  }
  return messageService
}

export function configureMessageService(gateway: SMSGateway) {
  messageService = new MessageService(gateway)
}