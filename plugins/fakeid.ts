import type { BotContext } from '../types.js';

const FIRST_NAMES_M = ['James','John','Robert','Michael','William','David','Richard','Joseph','Thomas','Charles','Christopher','Daniel','Matthew','Anthony','Mark','Donald','Steven','Andrew','Kenneth','Paul','Joshua','Kevin','Brian','George','Edward','Ronald','Timothy','Jason','Jeffrey','Ryan','Jacob','Gary','Nicholas','Eric','Jonathan','Larry','Justin','Scott','Brandon','Benjamin','Samuel','Raymond','Gregory','Frank','Alexander','Patrick','Raymond'];
const FIRST_NAMES_F = ['Mary','Patricia','Jennifer','Linda','Barbara','Elizabeth','Susan','Jessica','Sarah','Karen','Lisa','Nancy','Betty','Margaret','Sandra','Ashley','Dorothy','Kimberly','Emily','Donna','Michelle','Carol','Amanda','Melissa','Deborah','Stephanie','Rebecca','Sharon','Laura','Cynthia','Kathleen','Amy','Angela','Shirley','Anna','Brenda','Pamela','Emma','Nicole','Helen','Samantha','Katherine','Christine'];
const LAST_NAMES = ['Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis','Rodriguez','Martinez','Hernandez','Lopez','Gonzalez','Wilson','Anderson','Thomas','Taylor','Moore','Jackson','Martin','Lee','Perez','Thompson','White','Harris','Sanchez','Clark','Ramirez','Lewis','Robinson','Walker','Young','Allen','King','Wright','Scott','Torres','Nguyen','Hill','Flores','Green','Adams','Nelson','Baker','Hall','Rivera','Campbell','Mitchell','Carter'];
const CITIES = ['New York','Los Angeles','Chicago','Houston','Phoenix','Philadelphia','San Antonio','San Diego','Dallas','San Jose','Austin','Jacksonville','Fort Worth','Columbus','Charlotte','Indianapolis','San Francisco','Seattle','Denver','Nashville','Oklahoma City','Portland','Las Vegas','Memphis','Louisville','Baltimore','Miami','Atlanta','Boston','Raleigh'];
const STATES: Record<string, string> = {
    'New York': 'NY','Los Angeles': 'CA','Chicago': 'IL','Houston': 'TX','Phoenix': 'AZ',
    'Philadelphia': 'PA','San Antonio': 'TX','San Diego': 'CA','Dallas': 'TX','San Jose': 'CA',
    'Austin': 'TX','Jacksonville': 'FL','Fort Worth': 'TX','Columbus': 'OH','Charlotte': 'NC',
    'Indianapolis': 'IN','San Francisco': 'CA','Seattle': 'WA','Denver': 'CO','Nashville': 'TN',
    'Oklahoma City': 'OK','Portland': 'OR','Las Vegas': 'NV','Memphis': 'TN','Louisville': 'KY',
    'Baltimore': 'MD','Miami': 'FL','Atlanta': 'GA','Boston': 'MA','Raleigh': 'NC'
};
const BLOOD_TYPES = ['A+','A-','B+','B-','AB+','AB-','O+','O-'];
const OCCUPATIONS = ['Software Engineer','Teacher','Doctor','Lawyer','Accountant','Nurse','Sales Manager','Marketing Director','Graphic Designer','Chef','Police Officer','Firefighter','Electrician','Plumber','Construction Worker','Real Estate Agent','Financial Analyst','Physical Therapist','Pharmacist','Mechanic'];
const NATIONALITIES = ['American','Canadian','British','Australian','German','French','Italian','Spanish','Brazilian','Japanese'];
const HAIR = ['Black','Brown','Blonde','Red','Gray','White','Auburn'];
const EYES = ['Brown','Blue','Green','Hazel','Gray','Amber'];

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function rand(min: number, max: number) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pad(n: number, len = 2) { return String(n).padStart(len, '0'); }

function genDOB(ageMin = 18, ageMax = 65) {
    const year = new Date().getFullYear() - rand(ageMin, ageMax);
    const month = rand(1, 12);
    const day = rand(1, 28);
    return { dob: `${pad(month)}/${pad(day)}/${year}`, year, age: new Date().getFullYear() - year };
}

function genSSN() { return `${rand(100,999)}-${rand(10,99)}-${rand(1000,9999)}`; }

function genPhone() { return `(${rand(200,999)}) ${rand(200,999)}-${rand(1000,9999)}`; }

function genID() {
    const letters = 'ABCDEFGHJKLMNPRSTUVWXYZ';
    return `${pick(letters.split(''))}${pick(letters.split(''))}${rand(100000,999999)}`;
}

function genCreditCard() {
    const prefixes = ['4','5','37','6011'];
    const p = pick(prefixes);
    let num = p;
    while (num.length < 16) num += rand(0, 9);
    const groups = [num.slice(0,4), num.slice(4,8), num.slice(8,12), num.slice(12,16)];
    const exp = `${pad(rand(1,12))}/${(new Date().getFullYear() + rand(1,5)).toString().slice(2)}`;
    const cvv = `${rand(100,999)}`;
    return { number: groups.join(' '), exp, cvv };
}

export default {
    command: 'fakeid',
    aliases: ['fakeprofile', 'genid', 'fake', 'pranked'],
    category: 'fun',
    description: 'Generate a fake ID / prank profile',
    usage: '.fakeid [male|female]',

    async handler(sock: any, message: any, args: any[], context: BotContext) {
        const { chatId, channelInfo } = context;
        const gender = args[0]?.toLowerCase() === 'female' ? 'F' : args[0]?.toLowerCase() === 'male' ? 'M' : (Math.random() > 0.5 ? 'M' : 'F');
        const firstName = gender === 'F' ? pick(FIRST_NAMES_F) : pick(FIRST_NAMES_M);
        const lastName = pick(LAST_NAMES);
        const fullName = `${firstName} ${lastName}`;
        const city = pick(CITIES);
        const state = STATES[city] || 'XX';
        const { dob, age } = genDOB();
        const address = `${rand(100, 9999)} ${pick(['Main','Oak','Pine','Maple','Cedar','Elm','Washington','Park','Lake','Hill'])} ${pick(['St','Ave','Blvd','Dr','Rd','Ln','Way'])}, ${city}, ${state} ${rand(10000,99999)}`;
        const ssn = genSSN();
        const phone = genPhone();
        const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${rand(10,99)}@${pick(['gmail.com','yahoo.com','hotmail.com','outlook.com'])}`;
        const idNum = genID();
        const bloodType = pick(BLOOD_TYPES);
        const occupation = pick(OCCUPATIONS);
        const nationality = pick(NATIONALITIES);
        const height = `${rand(5,6)}'${rand(0,11)}"`;
        const weight = `${rand(120,220)} lbs`;
        const hair = pick(HAIR);
        const eyes = pick(EYES);
        const card = genCreditCard();

        const text = `┌─〔 🪪 𝐅𝐀𝐊𝐄 𝐈𝐃 𝐆𝐄𝐍𝐄𝐑𝐀𝐓𝐎𝐑 〕────────┈⊷\n` +
            `┆  ⚠️ *FOR PRANK/ENTERTAINMENT ONLY*\n┆\n` +
            `┆  👤 *Name:* ${fullName}\n` +
            `┆  🎂 *DOB:* ${dob} (Age: ${age})\n` +
            `┆  ⚧️ *Gender:* ${gender === 'M' ? 'Male' : 'Female'}\n` +
            `┆  🌍 *Nationality:* ${nationality}\n` +
            `┆  🏠 *Address:* ${address}\n` +
            `┆  📞 *Phone:* ${phone}\n` +
            `┆  📧 *Email:* ${email}\n` +
            `┆  💼 *Occupation:* ${occupation}\n` +
            `┆\n` +
            `┆  🪪 *ID Number:* ${idNum}\n` +
            `┆  🩸 *Blood Type:* ${bloodType}\n` +
            `┆  📏 *Height:* ${height}\n` +
            `┆  ⚖️ *Weight:* ${weight}\n` +
            `┆  💇 *Hair:* ${hair}\n` +
            `┆  👁️ *Eyes:* ${eyes}\n` +
            `┆\n` +
            `┆  💳 *CC:* ${card.number}\n` +
            `┆  📅 *Exp:* ${card.exp} | 🔒 *CVV:* ${card.cvv}\n` +
            `┆  🔐 *SSN:* ${ssn}\n` +
            `└──────────────────────────────────────┈⊷\n` +
            `_⚠️ This is 100% fake data for pranks only_`;

        await sock.sendMessage(chatId, { text, ...channelInfo }, { quoted: message });
    }
};
