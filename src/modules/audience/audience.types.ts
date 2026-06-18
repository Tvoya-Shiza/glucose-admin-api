/**
 * Phase 8 Plan 02 — server-internal audience types.
 *
 * Mirrors glucose-admin-client/src/lib/audience/types.ts wire-shape for the
 * discriminated-union filter; ResolvedRecipient + AudienceResolveResult are
 * server-side only (clients see the lighter AudiencePreview shape).
 *
 * The two repos do NOT share these via shared-types/ — the DTO layer
 * (class-validator) is the contract. If a field is added on one side, add it
 * on the other in the same commit; Plan 03's broadcast smoke catches drift.
 */

export type AudienceKind = 'group' | 'role' | 'region' | 'cohort';
// Free-form: roles are matched against the real `User.role_name` column (e.g. app
// users are 'user'). Validation lives in the DTO (string + maxLength), not a fixed union.
export type AudienceRole = string;
export type RegionField = 'country_id' | 'province_id' | 'city_id' | 'district_id' | 'school_id';
export type AudienceUserStatus = 'active' | 'pending' | 'inactive';

export interface ResolvedRecipient {
    /** Numeric User.id (Int autoincrement; not BigInt). */
    id: number;
    full_name: string | null;
    email: string | null;
    has_fcm: boolean;
    has_email: boolean;
}

export interface AudienceResolveResult {
    recipients: ResolvedRecipient[];
    audience_hash: string;
    /** Equals recipients.length. Capped at AudienceService.MAX_RECIPIENTS. */
    count: number;
    /** True when the resolver hit MAX_RECIPIENTS — broadcast caller should warn the user. */
    capped: boolean;
}

export interface AudiencePreviewResult {
    count: number;
    /** How many of `count` have an active FCM token (will actually receive a push). */
    count_with_fcm: number;
    sample: ResolvedRecipient[];
    audience_hash: string;
    cached: boolean;
}
