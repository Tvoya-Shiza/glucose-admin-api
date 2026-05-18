import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AccessModule } from '../access/access.module';
import { JwtAdminModule } from './jwt/jwt.module-config';
import { JwtStrategy } from './jwt/jwt.strategy';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RefreshTokenRepo } from './refresh-token.repo';

@Module({
    imports: [
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtAdminModule,
        // Phase 11 — AuthController.me uses PermissionsService.listEffectivePermissions
        // so the client can bootstrap usePermission() with one /me call.
        AccessModule,
    ],
    controllers: [AuthController],
    providers: [AuthService, JwtStrategy, RefreshTokenRepo],
    exports: [AuthService, JwtAdminModule],
})
export class AuthModule {}
