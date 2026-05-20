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

export type UploadKind = 'image' | 'video' | 'cover' | 'document';

export interface UploadTokenClaims {
    sub: number; // actor.id
    role: string; // actor.role_name
    role_id: number; // actor.role_id — Phase 11; required by PermissionGuard
    kind: UploadKind;
    size: number; // declared bytes
    content_type: string; // declared MIME
    folder_id: number | null; // Phase 10 — destination folder, null = root
    folder_path: string; // Phase 10 — slug path (resolved at sign-time); '' = root
    jti: string;
    iat: number;
    exp: number;
}

export interface SignUploadTokenInput {
    sub: number;
    role: string;
    role_id: number;
    kind: UploadKind;
    size: number;
    content_type: string;
    folder_id?: number | null;
    folder_path?: string;
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
        role_id: input.role_id,
        kind: input.kind,
        size: input.size,
        content_type: input.content_type,
        folder_id: input.folder_id ?? null,
        folder_path: input.folder_path ?? '',
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
    // folder_id / folder_path are Phase-10 additions. Older tokens (pre-Phase-10)
    // do not have these claims; default to root so legacy tokens keep working
    // through their 5-min TTL. New tokens always carry both fields.
    if (typeof claims.folder_id === 'undefined') {
        (claims as UploadTokenClaims).folder_id = null;
    }
    if (typeof claims.folder_path === 'undefined') {
        (claims as UploadTokenClaims).folder_path = '';
    }
    // role_id is a Phase-11 addition. Tokens issued pre-Phase-11 lack it; default to 0
    // so legacy tokens through their 5-min TTL still verify, but PermissionGuard will
    // deny any permission check (no role has id=0). Upload endpoints typically don't
    // require granular permission checks anyway.
    if (typeof claims.role_id !== 'number') {
        (claims as UploadTokenClaims).role_id = 0;
    }
    return claims as UploadTokenClaims;
}
