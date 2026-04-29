import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtAdminModule } from './jwt/jwt.module-config';
import { JwtStrategy } from './jwt/jwt.strategy';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RefreshTokenRepo } from './refresh-token.repo';

@Module({
    imports: [
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtAdminModule,
    ],
    controllers: [AuthController],
    providers: [AuthService, JwtStrategy, RefreshTokenRepo],
    exports: [AuthService, JwtAdminModule],
})
export class AuthModule {}
