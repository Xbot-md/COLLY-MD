export interface ActiveEffect {
    drug: string;
    effectName: string;
    expiresAt: number;
    data?: Record<string, any>;
}

const store = new Map<string, ActiveEffect[]>();

export function addEffect(userId: string, effect: ActiveEffect): void {
    const existing = store.get(userId) || [];
    const idx = existing.findIndex(e => e.effectName === effect.effectName);
    if (idx !== -1) existing[idx] = effect;
    else existing.push(effect);
    store.set(userId, existing);
}

export function hasEffect(userId: string, effectName: string): boolean {
    const effects = store.get(userId) || [];
    return effects.some(e => e.effectName === effectName && e.expiresAt > Date.now());
}

export function getEffect(userId: string, effectName: string): ActiveEffect | undefined {
    const effects = store.get(userId) || [];
    return effects.find(e => e.effectName === effectName && e.expiresAt > Date.now());
}

export function removeEffect(userId: string, effectName: string): void {
    const effects = store.get(userId) || [];
    store.set(userId, effects.filter(e => e.effectName !== effectName));
}

export function getActiveEffects(userId: string): ActiveEffect[] {
    const effects = store.get(userId) || [];
    const live = effects.filter(e => e.expiresAt > Date.now());
    store.set(userId, live);
    return live;
}

export function clearAllEffects(userId: string): void {
    store.delete(userId);
}
