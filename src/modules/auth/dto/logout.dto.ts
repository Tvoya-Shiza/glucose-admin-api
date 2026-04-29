import { IsOptional, IsString } from 'class-validator';

/**
 * Logout payload — fully optional.
 *
 * Logout is idempotent: caller may send `{}`, omit body entirely, or provide
 * `{ refresh_token: '<jwt>' }`. We deliberately do NOT use `Partial<RefreshDto>`
 * because RefreshDto's @IsJWT() runs at runtime and would reject `null` /
 * non-JWT strings — the BFF (Plan 06) sometimes has no refresh cookie to forward,
 * and the request must still succeed.
 *
 * @IsString() (without @IsJWT()) accepts any non-empty string; if the value isn't
 * a valid JWT, AuthService.logout swallows the verifyAsync error (logout never
 * leaks token validity).
 */
export class LogoutDto {
    @IsOptional()
    @IsString()
    refresh_token?: string;
}
