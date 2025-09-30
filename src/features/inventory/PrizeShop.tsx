import React, { useEffect, useState } from 'react'
import { mbhrDb, ulid } from '@/db/mbhr'
import { GiftIcon, StarIcon } from '@heroicons/react/24/outline'

const PRIZES = [
  { id: 'sticker', name: 'Volunteer Sticker Pack', cost: 50, description: 'Cool stickers for your gear' },
  { id: 'cap', name: 'MBHR Baseball Cap', cost: 300, description: 'Official volunteer cap' },
  { id: 'lunch', name: 'Free Lunch Voucher', cost: 500, description: 'Enjoy a meal on us!' },
  { id: 'tshirt', name: 'Premium T-Shirt', cost: 800, description: 'High-quality volunteer shirt' }
]

export default function PrizeShop() {
  const [wallet, setWallet] = useState(0)
  const [badges, setBadges] = useState<string[]>([])

  useEffect(() => {
    ;(async () => {
      // Single volunteer demo wallet
      let g = await mbhrDb.gamification.get('demo')
      if (!g) {
        const now = new Date().toISOString()
        await mbhrDb.gamification.add({ 
          id: 'demo', 
          volunteerId: 'demo', 
          tokens: 450, 
          badges: ['first_restock'], 
          updatedAt: now 
        })
        g = await mbhrDb.gamification.get('demo')
      }
      setWallet(g?.tokens || 0)
      setBadges(g?.badges || [])
    })()
  }, [])

  async function redeem(prize: typeof PRIZES[0]) {
    const g = await mbhrDb.gamification.get('demo')
    if (!g || g.tokens < prize.cost) {
      alert('Not enough tokens! Keep restocking to earn more.')
      return
    }
    
    const newBadges = [...g.badges]
    if (prize.id === 'lunch' && !newBadges.includes('big_spender')) {
      newBadges.push('big_spender')
    }
    
    await mbhrDb.gamification.update('demo', { 
      tokens: g.tokens - prize.cost, 
      badges: newBadges,
      updatedAt: new Date().toISOString() 
    })
    
    setWallet(g.tokens - prize.cost)
    setBadges(newBadges)
    alert(`🎉 Redeemed ${prize.name}! Check with admin to collect your prize.`)
  }

  return (
    <div className="p-4 space-y-6">
      <div className="flex items-center space-x-3">
        <GiftIcon className="h-8 w-8 text-primary" />
        <h2 className="text-2xl font-bold text-gray-900">Prize Shop</h2>
      </div>

      {/* Wallet & Badges */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card bg-green-50 border-green-200">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-green-600 rounded-full flex items-center justify-center">
              <span className="text-white font-bold text-sm">T</span>
            </div>
            <div>
              <div className="text-lg font-bold text-green-800">{wallet} Tokens</div>
              <div className="text-sm text-green-600">Available to spend</div>
            </div>
          </div>
        </div>

        <div className="card bg-purple-50 border-purple-200">
          <div className="flex items-center space-x-2 mb-2">
            <StarIcon className="h-5 w-5 text-purple-600" />
            <div className="font-medium text-purple-800">Badges Earned</div>
          </div>
          <div className="flex flex-wrap gap-1">
            {badges.length === 0 ? (
              <span className="text-sm text-purple-600">No badges yet</span>
            ) : (
              badges.map(badge => (
                <span key={badge} className="px-2 py-1 bg-purple-100 text-purple-700 rounded-full text-xs font-medium">
                  {badge.replace('_', ' ')}
                </span>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Prizes */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {PRIZES.map(prize => {
          const canAfford = wallet >= prize.cost
          return (
            <div key={prize.id} className={`card transition-all hover:shadow-md ${
              canAfford ? 'border-green-200 hover:border-green-300' : 'border-gray-200 opacity-75'
            }`}>
              <div className="text-center">
                <div className="w-12 h-12 bg-gray-100 rounded-full mx-auto mb-3 flex items-center justify-center">
                  <GiftIcon className="h-6 w-6 text-gray-600" />
                </div>
                <div className="font-medium text-gray-900 mb-1">{prize.name}</div>
                <div className="text-sm text-gray-600 mb-3">{prize.description}</div>
                <div className="text-lg font-bold text-primary mb-3">{prize.cost} tokens</div>
                <button 
                  className={`w-full ${canAfford ? 'btn-primary' : 'btn-secondary opacity-50 cursor-not-allowed'}`}
                  onClick={() => canAfford && redeem(prize)}
                  disabled={!canAfford}
                >
                  {canAfford ? 'Redeem' : 'Need more tokens'}
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <div className="card bg-blue-50 border-blue-200">
        <div className="text-sm text-blue-800">
          <div className="font-medium mb-1">💡 How to earn more tokens:</div>
          <ul className="text-xs space-y-1 text-blue-700">
            <li>• Restock low inventory items (+1-5 tokens per item)</li>
            <li>• Complete restock sessions (+bonus tokens)</li>
            <li>• Help during busy clinic days (+activity bonus)</li>
          </ul>
        </div>
      </div>
    </div>
  )
}