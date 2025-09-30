import { FormEvent, useState } from 'react'
import { useQueue } from '@/stores/queue'
import { TicketIcon, UserGroupIcon } from '@heroicons/react/24/outline'

const categories = ['adult','child','antenatal'] as const
const priorities = ['normal','urgent','low'] as const
