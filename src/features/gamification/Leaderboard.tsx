import { useEffect, useState } from 'react'
import { useGam } from '@/stores/gamification'
import { db } from '@/db'

type Row = { volunteerId: string; tokens: number; name: string }
