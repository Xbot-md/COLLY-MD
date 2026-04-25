import type { BotContext } from '../types.js';

const GUIDE_INDEX =
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽  📚 *C O L L Y  G U I D E*
╽
╽  Available guides:
╽
╽  1️⃣  Economy & Gangs
╽      ↳ Business, Work, Court & Gang system
╽
╽  ───────────────────────────
╽  Usage: *.guide <number>*
╽  Example: *.guide 1*
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`;

const GUIDE_ECONOMY =
`┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷
╽ [?] *C O L L Y G U I D E : E C O N O M Y & G A N G S*
┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷

*[ 👑 BUSINESS OWNER COMMANDS ]*
- *.applicants [Business Name]* — View a list of players who applied for a job.
- *.hire @user [Business Name]* — Accept an applicant to your staff.
- *.fire @user [Business Name]* — Terminate a worker's contract.
- *.setsalary @user [Amount]* — Set specific pay for a human worker.
- *.work > [Business Name]* — Perform active shifts for maximum profit.
- *.paytax [Business Name]* — Pay daily tax (Missing = +2% Tax Rate).
- *.collect* — Claim passive income and pay all employee wages.
- *.buysecurity [Type] [Business Name]* — Buy security to protect your business.
- *.insure [Business Name]* — One-time protection against foreclosure or bankruptcy.
- *.business info [Business Name]* — View business details and stats.
- *.lawyer hire* — Hire a lawyer to represent you in court ($50k).
- *.lawyer list* — View available lawyers and their fees.

*[ 👷 WORKER & APPLICANT COMMANDS ]*
- *.business list* — View all registered businesses and hiring status.
- *.apply [Business Name]* — Submit your application to the owner.
- *.quit* — Resign from your current job immediately.
- *.mysalary* — Check your current pay rate and pending earnings.
- *.work* — Generate revenue for your employer to earn your cut.
- *.myjobs* — View your current job and salary.

*[ 🏴‍☠️ GANG OPERATIONS & EXTORTION ]*
_Gangs target private player-owned businesses for profit. Default jobs are off-limits._
- *.gang create [Name]* — Form a criminal organization ($500k).
- *.shakedown [Business Name]* — Demand protection money from an owner.
- *.raid [Business Name]* — Attempt to steal a portion of the business vault.
- *.quitgang* — Leave your current gang immediately.
- *.gang invite @user* — Invite a player to join your gang.
- *.gang kick @user* — Remove a member from your gang.

*[ 🏛️ GOVERNMENT & JUDICIAL ]*
- *.taxrate [Amount]* — (Gov) Set the base global tax percentage.
- *.sue @user [Amount]* — (Public) File a legal case against a player/owner.
- *.jury [CaseID] [Guilty/Innocent]* — (Public) Vote in a court trial.
- *.seize [Business Name]* — (Judge) Forcibly liquidate an asset.
- *.investigate [Plot]* — (Police) Scan for gang activity or illegal permits.
- *.court list* — View active court cases.
- *.court attend [CaseID]* — Attend a court trial as a witness.

*[ 🏢 STARTING A BUSINESS ]*
1. *.buyland* — System assigns the next available automated plot.
2. *.getpermit [Plot]* — Legal authorization to build on that plot.
3. *.build [Type] [Plot]* — Constructs the facility (Office, Shop, etc.).
4. *.buyasset [Name]* — Registers the company name and activates ownership.

*[ ! ] REALISM COMPLIANCE*
- *Tax Penalty:* Missing .paytax = +2% Tax Rate increase every 24h.
- *Foreclosure:* Missing 3 consecutive taxes = Asset Deletion & Land Reset.
- *48H Shield:* The *Iron Gate* provides a hard lock against gangs for 2 full days.
- *Worker Strike:* Missing 3 salary payments = Workers/Bots stop producing.

(?) Full Command List: .guide

┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈⊷`;

const GUIDES: Record<string, string> = {
    '1':       GUIDE_ECONOMY,
    'economy': GUIDE_ECONOMY,
    'eco':     GUIDE_ECONOMY,
    'gangs':   GUIDE_ECONOMY,
    'gang':    GUIDE_ECONOMY,
    'business':GUIDE_ECONOMY,
};

export default {
    command: 'guide',
    aliases: ['guides', 'help2', 'tutorial'],
    category: 'info',
    description: 'View system guides for economy, gangs, court and more',
    usage: '.guide [number]',

    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo } = context;

        const key = (args[0] ?? '').toLowerCase().trim();

        if (!key) {
            return sock.sendMessage(chatId, { text: GUIDE_INDEX, ...channelInfo }, { quoted: message });
        }

        const guide = GUIDES[key];
        if (!guide) {
            return sock.sendMessage(chatId, {
                text: `❌ No guide found for *"${args[0]}"*.\n\nType *.guide* to see the available list.`,
                ...channelInfo
            }, { quoted: message });
        }

        return sock.sendMessage(chatId, { text: guide, ...channelInfo }, { quoted: message });
    }
};
