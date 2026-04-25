type BotStatus = 'idle' | 'waiting_number' | 'generating' | 'code_ready' | 'connected' | 'error';

interface BotState {
    status: BotStatus;
    pairingCode: string | null;
    phoneNumber: string | null;
    connectedNumber: string | null;
    errorMessage: string | null;
    startedAt: number;
}

const state: BotState = {
    status: 'idle',
    pairingCode: null,
    phoneNumber: null,
    connectedNumber: null,
    errorMessage: null,
    startedAt: Date.now()
};

let phoneNumberResolver: ((num: string) => void) | null = null;
let phoneNumberPromise: Promise<string> | null = null;

function waitForPhoneNumber(): Promise<string> {
    state.status = 'waiting_number';
    state.pairingCode = null;
    phoneNumberPromise = new Promise((resolve) => {
        phoneNumberResolver = resolve;
    });
    return phoneNumberPromise;
}

function submitPhoneNumber(num: string): boolean {
    if (state.status !== 'waiting_number' || !phoneNumberResolver) return false;
    state.phoneNumber = num;
    state.status = 'generating';
    phoneNumberResolver(num);
    phoneNumberResolver = null;
    return true;
}

function setPairingCode(code: string): void {
    state.pairingCode = code;
    state.status = 'code_ready';
}

function setConnected(number?: string): void {
    state.status = 'connected';
    state.pairingCode = null;
    if (number) state.connectedNumber = number;
}

function setError(msg: string): void {
    state.status = 'error';
    state.errorMessage = msg;
}

function setIdle(): void {
    state.status = 'idle';
    state.pairingCode = null;
    state.phoneNumber = null;
    state.errorMessage = null;
}

function getState(): BotState {
    return { ...state };
}

export {
    waitForPhoneNumber,
    submitPhoneNumber,
    setPairingCode,
    setConnected,
    setError,
    setIdle,
    getState
};
