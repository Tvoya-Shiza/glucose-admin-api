import { createHash, randomUUID } from 'crypto';
import * as jwt from 'jsonwebtoken';

/**
 * Force-confirm token signer (Phase 6 Plan 04 — QZ-06 versioning gate infrastructure).
 *
 * QZ-06 (D-11..D-14): "Destructive edits" to a quiz (changing question text, answer text,
 * answer correctness, deleting a question/answer) require an explicit force-confirm step
 * when one or more `QuizResult.status='waiting'` rows exist. The flow:
 *
 *     1. Client POSTs the destructive edit DTO.
 *     2. Plan 05 service detects open attempts → returns 409 with
 *        { open_attempts_count, force_confirm_token } where force_confirm_token is a
 *        5-min HS256 JWT minted by `signForceConfirmToken` below.
 *     3. Client renders force-confirm dialog. User clicks "Confirm".
 *     4. Client re-POSTs the SAME DTO with force_confirm_token populated.
 *     5. Plan 05 verifies via `verifyForceConfirmToken`, recomputes
 *        `computeEditIntentHash` against the resubmitted payload, and rejects if the
 *        hash drifted (the operator changed the payload between confirm and submit).
 *     6. On success, Plan 05 enforces single-use of the jti via Redis `SET NX EX`
 *        (NOT here — keeps this signer pure / testable in isolation), bumps
 *        Quizzes.version, and applies the edit.
 *
 * Design choices, all baked here in Plan 04 so Plan 05's consumer is one import away:
 *
 *   - HS256 / kid='quiz-force-v1' — distinct kid from upload-v1 / admin-v1 so log triage
 *     can tell tokens apart at sight (T-06-44 confused-deputy mitigation).
 *
 *   - Distinct secret JWT_QUIZ_FORCE_SECRET (≥32 chars; env.validation.ts rejects boot if
 *     short or missing). NEVER reuse JWT_ADMIN_SECRET / JWT_UPLOAD_SECRET — three
 *     independent rotation lifecycles per defense-in-depth (T-06-44).
 *
 *   - 5-minute TTL — long enough for the operator to read the force-confirm dialog +
 *     click; short enough that a stolen token expires before lateral abuse.
 *
 *   - `edit_intent_hash` binds the token to the EXACT payload the operator confirmed.
 *     `computeEditIntentHash` hashes a stable-stringified canonical form so identical
 *     payloads produce identical hashes regardless of property order, but ANY drift
 *     (a typo retry; a different question text) produces a different hash and rejects
 *     the token (T-06-41 token-tampering mitigation).
 *
 *   - jsonwebtoken (NOT jose) — admin-api already pulls jsonwebtoken transitively via
 *     @nestjs/jwt. Mirrors Phase 5 upload-token.signer.ts decision; keeps the JWT
 *     primitive surface single-library.
 *
 * Plan 04 EXPORTS this module. Plan 05 IMPORTS it; Plan 04 itself does not consume it
 * (no destructive edit lands in this plan — only the detail endpoint + tabs UI do).
 */

const ALG: jwt.Algorithm = 'HS256';
const KID = 'quiz-force-v1';

export interface ForceConfirmTokenClaims {
    /** Standard JWT subject — actor.id of the staff member who clicked "force confirm". */
    sub: number;
    /** The quiz this confirmation applies to. */
    quiz_id: number;
    /**
     * sha256 hex of the canonicalized destructive-edit DTO. Server recomputes on retry
     * via computeEditIntentHash and binds the token to the exact payload the operator
     * confirmed (T-06-41).
     */
    edit_intent_hash: string;
    /** Unix seconds. Standard JWT iat. */
    iat: number;
    /** Unix seconds. Standard JWT exp — TTL added at sign time. */
    exp: number;
    /** Single-use anchor. Plan 05 enforces via Redis SET NX EX. */
    jti: string;
}

export interface SignForceConfirmInput {
    actor_id: number;
    quiz_id: number;
    edit_intent_hash: string;
}

export interface SignForceConfirmResult {
    token: string;
    jti: string;
    expires_at: number;
}

/**
 * Sign a force-confirm token. Returns the wire token + jti (for Plan 05's Redis
 * single-use anchor) + expires_at (Unix seconds, for the 409 envelope's UI countdown).
 *
 * @param input  actor_id + quiz_id + edit_intent_hash (the latter computed via
 *               computeEditIntentHash on the destructive DTO).
 * @param secret JWT_QUIZ_FORCE_SECRET (≥32 chars).
 * @param ttlSeconds Token TTL in seconds. Default 300 (5 min).
 */
export function signForceConfirmToken(
    input: SignForceConfirmInput,
    secret: string,
    ttlSeconds = 300,
): SignForceConfirmResult {
    const jti = randomUUID();
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + ttlSeconds;
    const payload: ForceConfirmTokenClaims = {
        sub: input.actor_id,
        quiz_id: input.quiz_id,
        edit_intent_hash: input.edit_intent_hash,
        iat,
        exp,
        jti,
    };
    const token = jwt.sign(payload, secret, {
        algorithm: ALG,
        keyid: KID,
        // exp/iat already on payload; do NOT set expiresIn (jsonwebtoken rejects both at once).
    });
    return { token, jti, expires_at: exp };
}

/**
 * Verify and shape-check a force-confirm token. Throws on:
 *   - signature mismatch (jwt.verify default behavior)
 *   - expired (jwt.verify default behavior with the exp claim)
 *   - any claim missing or wrong type (manual shape assertion below)
 *
 * Plan 05's consumer additionally:
 *   - asserts claims.quiz_id matches the URL :id
 *   - asserts claims.sub === actor.id
 *   - recomputes computeEditIntentHash on the retry DTO and compares to claims.edit_intent_hash
 *   - enforces single-use via Redis SET NX EX on `geonline-admin:quizzes:force-confirm:jti:<jti>`
 *
 * @param token The wire token from `force_confirm_token` field on the retry DTO.
 * @param secret JWT_QUIZ_FORCE_SECRET (must match signing-side secret).
 */
export function verifyForceConfirmToken(token: string, secret: string): ForceConfirmTokenClaims {
    const decoded = jwt.verify(token, secret, { algorithms: [ALG] });
    if (typeof decoded === 'string' || decoded === null) {
        throw new Error('quizzes.force_confirm.invalid_payload');
    }
    const c = decoded as Partial<ForceConfirmTokenClaims>;
    if (typeof c.sub !== 'number') throw new Error('quizzes.force_confirm.invalid_sub');
    if (typeof c.quiz_id !== 'number') throw new Error('quizzes.force_confirm.invalid_quiz_id');
    if (typeof c.edit_intent_hash !== 'string') throw new Error('quizzes.force_confirm.invalid_hash');
    if (typeof c.jti !== 'string') throw new Error('quizzes.force_confirm.invalid_jti');
    if (typeof c.iat !== 'number' || typeof c.exp !== 'number') {
        throw new Error('quizzes.force_confirm.invalid_times');
    }
    return c as ForceConfirmTokenClaims;
}

/**
 * Compute a deterministic sha256 hex of a destructive-edit payload. Used to bind a
 * force-confirm token to the SPECIFIC edit the operator confirmed (T-06-41 mitigation).
 *
 * Normalization rules (recursive):
 *   - Primitives (string|number|boolean|null) → JSON.stringify(primitive)
 *   - Arrays → preserve order, recurse into each element
 *   - Objects → keys sorted ascending; recurse into each value
 *
 * Result: `{a:1, b:2}` and `{b:2, a:1}` produce IDENTICAL hashes; any change in a value
 * (even a single character in a question title) produces a DIFFERENT hash and rejects
 * the token at verify-time on the retry submission.
 *
 * NOTE: BigInt is not expected in destructive-edit DTOs (Phase 6 entity ids are Int →
 * number per Plan 01 decision). If a BigInt slips in, JSON.stringify will throw — we
 * accept that as a loud failure rather than silent coercion.
 */
export function computeEditIntentHash(payload: unknown): string {
    return createHash('sha256').update(stableStringify(payload)).digest('hex');
}

function stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return '[' + value.map((v) => stableStringify(v)).join(',') + ']';
    }
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return (
        '{' +
        keys
            .map((k) => JSON.stringify(k) + ':' + stableStringify((value as Record<string, unknown>)[k]))
            .join(',') +
        '}'
    );
}
