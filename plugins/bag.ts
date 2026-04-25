import type { BotContext } from '../types.js';
import { getWallet, saveWallet, getShop } from '../lib/turso.js';
import { resolveJid } from '../lib/lidUtils.js';
import { DRUG_IDS, DRUG_MAP } from './druglab.js';
import config from '../config.js';

const prefix = config.prefixes[0];
const fmt    = (n: number) => n.toLocaleString();
const cleanJid = (jid: string) => jid.split(':')[0].split('@')[0];

// ── Bag lock state (in-memory, per userId) ────────────────────────────────────
const bagLocks = new Map<string, boolean>();

// ── Item category definitions ─────────────────────────────────────────────────
interface CatDef { label: string; emoji: string; max: number; ids: Set<string>; catchAll?: boolean }

const CATEGORIES: CatDef[] = [
    {
        label: 'IMPORTANT ITEMS', emoji: '🔒', max: 3,
        ids: new Set(['tate_bugatti_key','corrupt_colly','vip_pass_club','god_mode_injector','void_extract','bank_breaker_fluid','master_keycard','ghost_protocol','infinity_battery']),
    },
    {
        label: 'ID & CARDS', emoji: '🪪', max: 15,
        ids: new Set(['bankcard','visa','fake_id','elon_chip']),
    },
    {
        label: 'VALUABLES', emoji: '💎', max: 20,
        ids: new Set(['diamond_ring','rolex_watch','gold_bullion','crypto_wallet','rare_nft','counterfeit_cash','vip','king','lucky']),
    },
    {
        label: 'WEAPONS', emoji: '⚔️', max: 25,
        ids: new Set(['taser_baton','combat_katana','m4a1','brass_knuckles','silenced_pistol','lockpick_set']),
    },
    {
        label: 'TOOLS & EQUIPMENT', emoji: '🧰', max: 30,
        ids: new Set(['lockpick','broken_hourglass','chronos_wand','shield','ticket']),
    },
    {
        label: 'TECH & GADGETS', emoji: '💻', max: 29,
        ids: new Set(['laptop_hacker','burner_phone','dj_equipment','vr_gaming_rig','neon_gaming_pc']),
    },
    {
        label: 'CLOTHING', emoji: '👕', max: 15,
        ids: new Set(),
    },
    {
        label: 'FOOD & RATIONS', emoji: '🍱', max: 50,
        ids: new Set(['energy_drink','protein_bar','neon_water','data_tacos']),
    },
    {
        label: 'MEDICAL SUPPLIES', emoji: '💊', max: 100,
        ids: new Set(['medkit','purification_iv','colly_cleanse']),
    },
    {
        label: 'CHEMICALS & DRUGS', emoji: '🧬', max: 3,
        ids: DRUG_IDS,
    },
    {
        label: 'BOOKS & GUIDES', emoji: '📚', max: 50,
        ids: new Set(),
    },
    {
        label: 'MISC / OTHER', emoji: '📦', max: 50,
        ids: new Set(), catchAll: true,
    },
];

// All non-catch-all IDs for fallback detection
const KNOWN_IDS = new Set(CATEGORIES.flatMap(c => [...c.ids]));

// ── Build item display name ───────────────────────────────────────────────────
function getItemMeta(id: string, shopMap: Map<string, { name: string; emoji: string }>) {
    const shop = shopMap.get(id);
    if (shop) return shop;
    const drug = DRUG_MAP.get(id);
    if (drug) return { name: drug.name, emoji: '🧬' };
    return { name: id.replace(/_/g, ' ').replace(/bw/g, (c: string) => c.toUpperCase()), emoji: '📦' };
}

// ── Bag panel ─────────────────────────────────────────────────────────────────
function buildBagPanel(w: any, shopMap: Map<string, { name: string; emoji: string }>, locked: boolean): string {
    const inv: string[] = w.inventory || [];
    const counts: Record<string, number> = {};
    for (const id of inv) counts[id] = (counts[id] || 0) + 1;

    // Categorise
    const catItems: Map<string, { id: string; name: string; emoji: string; count: number }[]> = new Map();
    for (const cat of CATEGORIES) catItems.set(cat.label, []);

    for (const [id, count] of Object.entries(counts)) {
        let placed = false;
        for (const cat of CATEGORIES) {
            if (cat.catchAll) continue;
            if (cat.ids.has(id)) {
                catItems.get(cat.label)!.push({ id, ...getItemMeta(id, shopMap), count });
                placed = true;
                break;
            }
        }
        if (!placed) {
            catItems.get('MISC / OTHER')!.push({ id, ...getItemMeta(id, shopMap), count });
        }
    }

    const totalSlots  = CATEGORIES.reduce((s, c) => s + c.max, 0);
    const usedSlots   = inv.length;
    const lockTag     = locked ? ' 🔒' : '';

    let out =
`╔═══════════════════════════════════════╗
║ 🎒 *_Colly's  P E R S O N A L  B A G_* 🎒${lockTag} ║
╚═══════════════════════════════════════╝
_CAPACITY_ :: ${usedSlots} / ${totalSlots} slots
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃          *_STORED ITEMS_*              ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛`;

    for (const cat of CATEGORIES) {
        const items = catItems.get(cat.label) || [];
        const used  = items.reduce((s, i) => s + i.count, 0);
        out += `\n_[ ${cat.emoji} ${cat.label} ]_ ─ ${used}/${cat.max}`;
        if (cat.label === 'IMPORTANT ITEMS') out += ' 🔒';
        out += '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
        if (items.length === 0) {
            out += '\n⮕ _Empty_';
        } else {
            for (const item of items) {
                out += `\n⮕ ${item.emoji} _${item.name}_${item.count > 1 ? ` ×${item.count}` : ''}`;
            }
        }
    }

    out +=
`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
›*${prefix}use* <item>               — Use item
›*${prefix}drop* <item> [amount]     — Discard item
›*${prefix}gift* <item> [amt] @user  — Gift item
›*${prefix}sellcolly* <item> [amt]   — Sell to Colly MD
›*${prefix}lockbag*                  — ${locked ? 'Unlock' : 'Lock'} your bag
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[ SHOP ] *${prefix}shop* | [ STATS ] *${prefix}profile* | [ BANK ] *${prefix}balance*`;

    return out;
}

// ── Sell-back price table (30% of item price) ─────────────────────────────────
async function getSellbackPrice(id: string, shopMap: Map<string, { name: string; emoji: string; price?: number }>): Promise<number> {
    const s = shopMap.get(id) as any;
    if (s?.price) return Math.floor(s.price * 0.30);
    const d = DRUG_MAP.get(id);
    if (d) return Math.floor(d.price * 0.30);
    return 50; // default fallback for unpriced items
}

// ── Exports ────────────────────────────────────────────────────────────────────
export default [
    // .inventory moved to plugins/shopsystem.ts (unified bag with shop filter)

    {
        command: 'drop',
        aliases: ['discard', 'throwaway'],
        category: 'economy',
        description: 'Discard an item from your bag',
        usage: `.drop <item_id> [amount]`,

        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            if (bagLocks.get(senderId)) return sock.sendMessage(chatId, { text: `🔒 Your bag is locked. Use *${prefix}lockbag* to unlock it first.`, ...channelInfo }, { quoted: message });

            const itemId = args[0]?.toLowerCase().replace(/-/g, '_');
            const amount = Math.max(1, parseInt(args[1]) || 1);
            if (!itemId) return sock.sendMessage(chatId, { text: `❌ Usage: *${prefix}drop <item_id> [amount]*`, ...channelInfo }, { quoted: message });

            const w = await getWallet(senderId, message.pushName || cleanJid(senderId));
            const inInv = w.inventory.filter(i => i === itemId).length;
            if (!inInv) return sock.sendMessage(chatId, { text: `❌ You don't have *${itemId}* in your bag.`, ...channelInfo }, { quoted: message });

            const toDrop = Math.min(amount, inInv);
            for (let i = 0; i < toDrop; i++) {
                const idx = w.inventory.indexOf(itemId);
                if (idx !== -1) w.inventory.splice(idx, 1);
            }
            await saveWallet(w);

            const displayName = itemId.replace(/_/g, ' ').replace(/bw/g, (c: string) => c.toUpperCase());
            await sock.sendMessage(chatId, { text: `🗑️ Dropped *${toDrop}×* _${displayName}_ from your bag.`, ...channelInfo }, { quoted: message });
        },
    },

    // .gift moved to plugins/shopsystem.ts (unified gift command)

    {
        command: 'sellcolly',
        aliases: ['sellback', 'sellbotback'],
        category: 'economy',
        description: 'Sell an item back to Colly MD (30% market value)',
        usage: `.sellcolly <item_id> [amount]`,

        async handler(sock: any, message: any, args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            if (bagLocks.get(senderId)) return sock.sendMessage(chatId, { text: `🔒 Bag is locked. Unlock first with *${prefix}lockbag*.`, ...channelInfo }, { quoted: message });

            const itemId = args[0]?.toLowerCase().replace(/-/g, '_');
            const amount = Math.max(1, parseInt(args[1]) || 1);
            if (!itemId) return sock.sendMessage(chatId, { text: `❌ Usage: *${prefix}sellcolly <item_id> [amount]*`, ...channelInfo }, { quoted: message });

            const [w, shop] = await Promise.all([
                getWallet(senderId, message.pushName || cleanJid(senderId)),
                getShop(),
            ]);
            const shopMap = new Map(shop.map((s: any) => [s.id, { name: s.name, emoji: s.emoji, price: s.price }]));

            const inInv = w.inventory.filter(i => i === itemId).length;
            if (!inInv) return sock.sendMessage(chatId, { text: `❌ You don't have *${itemId}* in your bag.`, ...channelInfo }, { quoted: message });

            const toSell = Math.min(amount, inInv);
            const unitPrice = await getSellbackPrice(itemId, shopMap as any);
            const total = unitPrice * toSell;

            for (let i = 0; i < toSell; i++) {
                const idx = w.inventory.indexOf(itemId);
                w.inventory.splice(idx, 1);
            }
            w.balance += total;
            await saveWallet(w);

            const displayName = itemId.replace(/_/g, ' ').replace(/bw/g, (c: string) => c.toUpperCase());
            await sock.sendMessage(chatId, {
                text:
`💸 *SOLD TO COLLY MD*
╽ Item    :: ${displayName} ×${toSell}
╽ Payout  :: +${fmt(total)} 🪙 (30% value)
╽ Balance :: ${fmt(w.balance)} 🪙`,
                ...channelInfo
            }, { quoted: message });
        },
    },

    {
        command: 'lockbag',
        aliases: ['lockitems', 'baglock'],
        category: 'economy',
        description: 'Toggle bag lock (prevents accidental drops/gifts)',
        usage: `.lockbag`,

        async handler(sock: any, message: any, _args: any[], context: BotContext) {
            const { chatId, channelInfo, senderId } = context;
            const isLocked = bagLocks.get(senderId) || false;
            bagLocks.set(senderId, !isLocked);
            await sock.sendMessage(chatId, {
                text: isLocked
                    ? `🔓 *Bag unlocked.* You can now drop, gift, and sell items.`
                    : `🔒 *Bag locked.* Items are protected — no drops, gifts, or sells until unlocked.`,
                ...channelInfo
            }, { quoted: message });
        },
    },
];
