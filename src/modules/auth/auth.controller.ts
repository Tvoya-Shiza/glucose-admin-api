import {
    Body,
    Controller,
    Get,
    HttpCode,
    Post,
    Req,
    Res,
    UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { Audit, SkipAudit } from '../../common/audit/audit.decorator';
import { Roles } from './decorators/roles.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { JwtGuard } from './guards/jwt.guard';
import { RolesGuard } from './guards/roles.guard';
import { AuthService, TokenPair } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { LogoutDto } from './dto/logout.dto';
import { apiResponse } from '../../common/utils/api-response';
import type { AuthenticatedRequestUser } from './jwt/jwt.strategy';

const ACCESS_COOKIE = 'glc_admin_at';
const REFRESH_COOKIE = 'glc_admin_rt';

@Controller('admin-api/auth')
@UseGuards(JwtGuard, RolesGuard) // method-level @Public()/@Roles() override these defaults
export class AuthController {
    constructor(
        private readonly authService: AuthService,
        private readonly config: ConfigService,
    ) {}

    @Post('login')
    @Public()
    @SkipAudit('public auth endpoint — no authenticated actor at this stage')
    @HttpCode(200)
    @Throttle({ default: { limit: 5, ttl: 900_000 } })
    async login(
        @Body() dto: LoginDto,
        @Res({ passthrough: true }) res: Response,
    ) {
        const result = await this.authService.login(dto.email, dto.password);
        if (!result.ok) {
            // Generic error for 'incorrect'/'inactive'/'not_staff' to avoid disclosure;
            // 'ambiguous' is its own status so ops can investigate.
            if (result.reason === 'ambiguous') {
                return apiResponse(0, 'ambiguous', 'admin.auth.ambiguous');
            }
            if (result.reason === 'not_staff') {
                return apiResponse(0, 'forbidden', 'admin.auth.not_staff');
            }
            return apiResponse(0, 'incorrect', 'admin.auth.incorrect');
        }

        this.setAuthCookies(res, result.tokens);
        return apiResponse(1, 'login', 'admin.auth.login', {
            user_id: result.user_id,
            role_name: result.role_name,
            email: result.email,
            expires_at: result.tokens.access_expires_at,
        });
    }

    @Post('refresh')
    @Public()
    @SkipAudit('public auth endpoint — no authenticated actor at this stage')
    @HttpCode(200)
    @Throttle({ default: { limit: 5, ttl: 900_000 } })
    async refresh(
        @Body() dto: RefreshDto,
        @Res({ passthrough: true }) res: Response,
    ) {
        const tokens = await this.authService.refresh(dto.refresh_token);
        this.setAuthCookies(res, tokens);
        return apiResponse(1, 'refresh', 'admin.auth.refresh', {
            expires_at: tokens.access_expires_at,
        });
    }

    @Post('logout')
    @Roles('admin', 'curator', 'teacher')
    @Audit('auth.logout', 'session')
    @HttpCode(200)
    async logout(
        @Body() dto: LogoutDto,
        @Req() req: Request,
        @Res({ passthrough: true }) res: Response,
    ) {
        // Body has refresh_token (BFF route forwards it when present); fallback to cookie if BFF didn't strip it.
        // LogoutDto makes refresh_token optional + non-JWT-validated, so {} or omitted body is accepted.
        const refresh = dto?.refresh_token ?? (req.cookies?.[REFRESH_COOKIE] as string | undefined) ?? null;
        await this.authService.logout(refresh);
        this.clearAuthCookies(res);
        return apiResponse(1, 'logout', 'admin.auth.logout');
    }

    @Get('me')
    @Roles('admin', 'curator', 'teacher')
    async me(@CurrentUser() actor: AuthenticatedRequestUser) {
        return apiResponse(1, 'me', 'admin.auth.me', {
            user_id: actor.id,
            email: actor.email,
            role_name: actor.role_name,
        });
    }

    private setAuthCookies(res: Response, tokens: TokenPair) {
        const isProd = (this.config.get<string>('app.nodeEnv') ?? 'development') === 'production';
        const baseOpts = {
            httpOnly: true,
            secure: isProd,
            sameSite: 'lax' as const,
            path: '/',
            // No `domain` attr — host-only on admin.glucose.kz per STATE.md subdomain decision.
        };

        // maxAge in milliseconds; tokens.*_expires_at is Unix seconds → compute remaining ms.
        const nowMs = Date.now();
        const accessMaxAge = Math.max(0, tokens.access_expires_at * 1000 - nowMs);
        const refreshMaxAge = Math.max(0, tokens.refresh_expires_at * 1000 - nowMs);

        res.cookie(ACCESS_COOKIE, tokens.access_token, { ...baseOpts, maxAge: accessMaxAge });
        res.cookie(REFRESH_COOKIE, tokens.refresh_token, { ...baseOpts, maxAge: refreshMaxAge });
    }

    private clearAuthCookies(res: Response) {
        const isProd = (this.config.get<string>('app.nodeEnv') ?? 'development') === 'production';
        const baseOpts = {
            httpOnly: true,
            secure: isProd,
            sameSite: 'lax' as const,
            path: '/',
            maxAge: 0,
        };
        res.cookie(ACCESS_COOKIE, '', baseOpts);
        res.cookie(REFRESH_COOKIE, '', baseOpts);
    }
}
