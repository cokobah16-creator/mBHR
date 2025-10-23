import { create } from 'zustand';
export const useToast = create((set, get) => ({
    items: [],
    push: (t) => {
        set(s => ({ items: [...s.items, t] }));
        // auto-dismiss after 6s
        setTimeout(() => get().remove(t.id), 6000);
    },
    remove: (id) => set(s => ({ items: s.items.filter(i => i.id !== id) })),
}));
