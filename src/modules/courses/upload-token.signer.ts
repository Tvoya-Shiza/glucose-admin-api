import { randomUUID } from 'crypto';
import * as jwt from 'jsonwebtoken';

/**
 * Upload-token signer (Phase 5 Plan 04 — CRS-05).
 *
 * Distinct credential from the admin Bearer cookie:
 *  - signed with JWT_UPLOAD_SECRET (separate env var; not JWT_ADMIN_SECRET)
 *  - 5-minute TTL (vs 15-minute admin access token)
 *  - claims scoped to a single intended upload (kind + size + content_type)
 *  - jti single-use enforced via Redis (UploadsService)
 *
 * Why distinct: the upload endpoint is the only admin-api route the browser
 * hits directly without the BFF cookie (per CONTEXT D-13). Using a different
 * secret + claim shape makes confused-deputy attacks (presenting an admin
 * access token in place of an upload token, or vice versa) reject at signature
 * verification — see threat T-05-42.
 *
 * Implementation note: admin-api already depends on `jsonwebtoken` (transitively
 * via @nestjs/jwt). We intentionally do NOT add `jose` to keep the dep surface
 * tight; jsonwebtoken provides the same HS256 sign/verify primitives.
 */
const ALG: jwt.Algorithm = 'HS256';
const KID = 'upload-v1';

export type UploadKind = 'image' | 'video' | 'cover';

export interface UploadTokenClaims {
    sub: number; // actor.id
    role: string; // actor.role_name
    kind: UploadKind;
    size: number; // declared bytes
    content_type: string; // declared MIME
    jti: string;
    iat: number;
    exp: number;
}

export interface SignUploadTokenInput {
    sub: number;
    role: string;
    kind: UploadKind;
    size: number;
    content_type: string;
}

export interface SignUploadTokenResult {
    token: string;
    jti: string;
    expires_at: number;
}

export function signUploadToken(input: SignUploadTokenInput, secret: string, ttlSeconds = 300): SignUploadTokenResult {
    const jti = randomUUID();
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + ttlSeconds;
    const payload = {
        sub: input.sub,
        role: input.role,
        kind: input.kind,
        size: input.size,
        content_type: input.content_type,
        jti,
        iat,
        exp,
    };
    const token = jwt.sign(payload, secret, {
        algorithm: ALG,
        keyid: KID,
        // exp/iat already on payload; do NOT set expiresIn (jsonwebtoken rejects both at once).
    });
    return { token, jti, expires_at: exp };
}

export function verifyUploadToken(token: string, secret: string): UploadTokenClaims {
    const decoded = jwt.verify(token, secret, { algorithms: [ALG] });
    if (typeof decoded === 'string' || decoded === null) {
        throw new Error('upload_token_invalid_payload');
    }
    const claims = decoded as Partial<UploadTokenClaims>;
    if (
        typeof claims.sub !== 'number' ||
        typeof claims.role !== 'string' ||
        typeof claims.kind !== 'string' ||
        typeof claims.size !== 'number' ||
        typeof claims.content_type !== 'string' ||
        typeof claims.jti !== 'string' ||
        typeof claims.iat !== 'number' ||
        typeof claims.exp !== 'number'
    ) {
        throw new Error('upload_token_invalid_claims');
    }
    return claims as UploadTokenClaims;
}
