/**
 * Unix-seconds timestamp helper. All Phase 12 tables store timestamps as
 * `INT UNSIGNED` Unix seconds (Phase 11 convention); use this everywhere
 * instead of `Math.floor(Date.now() / 1000)` so the call site is grep-able.
 */
export function nowSec(): number {
    return Math.floor(Date.now() / 1000);
}
