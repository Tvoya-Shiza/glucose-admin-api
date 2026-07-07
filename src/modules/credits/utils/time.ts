/** Unix seconds now — every credit-domain timestamp is unix seconds (contract decision 10). */
export function nowSec(): number {
    return Math.floor(Date.now() / 1000);
}

/** Grace window (seconds) after ends_at during which conduct mutations are still accepted (decision 11). */
export const SESSION_GRACE_SEC = 5;
