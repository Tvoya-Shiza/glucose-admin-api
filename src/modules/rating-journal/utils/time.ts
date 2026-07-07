/** Unix seconds now — every rating-journal timestamp is unix seconds (mirrors the credit domain). */
export function nowSec(): number {
    return Math.floor(Date.now() / 1000);
}
