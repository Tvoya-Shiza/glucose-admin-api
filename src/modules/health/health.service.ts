import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class HealthService {
    constructor(private readonly prisma: PrismaService) {}

    async getHealth() {
        let db: 'ok' | 'fail' = 'ok';
        try {
            await this.prisma.$queryRaw`SELECT 1`;
        } catch (e) {
            db = 'fail';
        }
        return {
            status: db === 'ok' ? 'ok' : 'degraded',
            commit: process.env.GIT_SHA ?? 'dev',
            uptime_seconds: Math.floor(process.uptime()),
            db,
        };
    }
}
