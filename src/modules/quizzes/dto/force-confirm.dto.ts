/**
 * QZ-06 force-confirm token claims (D-11..D-14).
 *
 * Phase 6 Plan 01 — locked SHAPE only. No signer/verifier here:
 *   - Plan 04 ships the SIGNER (mints a token after a 409 destructive-edit response).
 *   - Plan 05 ships the VERIFIER (consumes the token on the retry POST/PATCH).
 *
 * Why declared in Plan 01:
 *   The shape is shared between Plan 04 (signer) and Plan 05 (verifier + UpsertQuestionDto /
 *   UpsertAnswerDto consumers). Declaring it once in Plan 01 prevents drift across the four
 *   files that touch it.
 *
 * Token mechanics:
 *   - HS256-signed JWT, separate secret JWT_QUIZ_FORCE_SECRET (NOT the admin auth or upload
 *     secret — three independent secrets per defense-in-depth).
 *   - 5-minute TTL (300s) — long enough for the staff member to read the warning + click,
 *     short enough that a stolen token expires before lateral use.
 *   - `edit_intent_hash` binds the token to the specific DTO payload the operator confirmed.
 *     Server recomputes sha256(canonicalized DTO) on retry; mismatch → 401 (token doesn't
 *     match the edit being attempted).
 *
 * NOT a class-validator DTO: this is a TYPE-ONLY interface used by jose.SignJWT /
 * jose.jwtVerify in Plan 04+05. Wire shape is RFC 7519.
 */
export interface ForceConfirmTokenClaims {
    /** Standard JWT subject — actor.id of the staff member who clicked "force confirm". */
    sub: number;
    /** The quiz this confirmation applies to. */
    quiz_id: number;
    /**
     * sha256 of the canonicalized destructive-edit DTO (UpsertQuestionDto or UpsertAnswerDto
     * minus this token field). Server recomputes on retry to bind the token to the exact
     * payload the operator confirmed.
     */
    edit_intent_hash: string;
    /** Unix seconds. Standard JWT iat. */
    iat: number;
    /** Unix seconds. Standard JWT exp — 300s after iat. */
    exp: number;
}

/**
 * 409 envelope returned by Plan 04+05 when a destructive edit hits open attempts.
 *
 * Client receives this body, presents the force-confirm dialog, then re-submits
 * the original mutation with `force_confirm_token` populated from this envelope.
 *
 * Surface frozen here so admin-client (Plan 01 lib/quizzes/types.ts) and the
 * downstream services don't drift.
 */
export interface ForceConfirmEnvelope {
    /** Number of QuizResult rows currently in 'waiting' status for this quiz. */
    open_attempts_count: number;
    /** JWT to include in the retry request as `force_confirm_token`. */
    force_confirm_token: string;
}
