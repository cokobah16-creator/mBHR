import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { useGam } from '@/stores/gamification';
import { GiftIcon, StarIcon } from '@heroicons/react/24/outline';
const PRIZES = [
    { id: 'sticker', name: 'Volunteer Sticker Pack', cost: 50, description: 'Cool stickers for your gear' },
    { id: 'cap', name: 'MBHR Baseball Cap', cost: 300, description: 'Official volunteer cap' },
    { id: 'lunch', name: 'Free Lunch Voucher', cost: 500, description: 'Enjoy a meal on us!' },
    { id: 'tshirt', name: 'Premium T-Shirt', cost: 800, description: 'High-quality volunteer shirt' }
];
export default function PrizeShop() {
    const { wallet, spendTokens, ensureWallet } = useGam();
    const [badges, setBadges] = useState([]);
    useEffect(() => {
        ensureWallet('demo-volunteer');
    }, []);
    async function redeem(prize) {
        const success = await spendTokens('demo-volunteer', prize.cost);
        if (!success) {
            alert('Not enough tokens! Keep restocking to earn more.');
            return;
        }
        alert(`🎉 Redeemed ${prize.name}! Check with admin to collect your prize.`);
    }
    return (_jsxs("div", { className: "p-4 space-y-6", children: [_jsxs("div", { className: "flex items-center space-x-3", children: [_jsx(GiftIcon, { className: "h-8 w-8 text-primary" }), _jsx("h2", { className: "text-2xl font-bold text-gray-900", children: "Prize Shop" })] }), _jsxs("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-4", children: [_jsx("div", { className: "card bg-green-50 border-green-200", children: _jsxs("div", { className: "flex items-center space-x-2", children: [_jsx("div", { className: "w-8 h-8 bg-green-600 rounded-full flex items-center justify-center", children: _jsx("span", { className: "text-white font-bold text-sm", children: "T" }) }), _jsxs("div", { children: [_jsxs("div", { className: "text-lg font-bold text-green-800", children: [wallet, " Tokens"] }), _jsx("div", { className: "text-sm text-green-600", children: "Available to spend" })] })] }) }), _jsxs("div", { className: "card bg-purple-50 border-purple-200", children: [_jsxs("div", { className: "flex items-center space-x-2 mb-2", children: [_jsx(StarIcon, { className: "h-5 w-5 text-purple-600" }), _jsx("div", { className: "font-medium text-purple-800", children: "Badges Earned" })] }), _jsx("div", { className: "flex flex-wrap gap-1", children: badges.length === 0 ? (_jsx("span", { className: "text-sm text-purple-600", children: "No badges yet" })) : (badges.map(badge => (_jsx("span", { className: "px-2 py-1 bg-purple-100 text-purple-700 rounded-full text-xs font-medium", children: badge.replace('_', ' ') }, badge)))) })] })] }), _jsx("div", { className: "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4", children: PRIZES.map(prize => {
                    const canAfford = wallet >= prize.cost;
                    return (_jsx("div", { className: `card transition-all hover:shadow-md ${canAfford ? 'border-green-200 hover:border-green-300' : 'border-gray-200 opacity-75'}`, children: _jsxs("div", { className: "text-center", children: [_jsx("div", { className: "w-12 h-12 bg-gray-100 rounded-full mx-auto mb-3 flex items-center justify-center", children: _jsx(GiftIcon, { className: "h-6 w-6 text-gray-600" }) }), _jsx("div", { className: "font-medium text-gray-900 mb-1", children: prize.name }), _jsx("div", { className: "text-sm text-gray-600 mb-3", children: prize.description }), _jsxs("div", { className: "text-lg font-bold text-primary mb-3", children: [prize.cost, " tokens"] }), _jsx("button", { className: `w-full ${canAfford ? 'btn-primary' : 'btn-secondary opacity-50 cursor-not-allowed'}`, onClick: () => canAfford && redeem(prize), disabled: !canAfford, children: canAfford ? 'Redeem' : 'Need more tokens' })] }) }, prize.id));
                }) }), _jsx("div", { className: "card bg-blue-50 border-blue-200", children: _jsxs("div", { className: "text-sm text-blue-800", children: [_jsx("div", { className: "font-medium mb-1", children: "\uD83D\uDCA1 How to earn more tokens:" }), _jsxs("ul", { className: "text-xs space-y-1 text-blue-700", children: [_jsx("li", { children: "\u2022 Restock low inventory items (+1-5 tokens per item)" }), _jsx("li", { children: "\u2022 Complete restock sessions (+bonus tokens)" }), _jsx("li", { children: "\u2022 Help during busy clinic days (+activity bonus)" })] })] }) })] }));
}
