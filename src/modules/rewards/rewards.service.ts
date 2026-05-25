import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { UpdateRewardDto } from './dto/update-reward.dto';

@Injectable()
export class RewardsService {
    constructor(private readonly prisma: PrismaService) {}

    public async listRules() {
        const rules = await this.prisma.reward.findMany({
            orderBy: { id: 'asc' },
            select: {
                id: true,
                type: true,
                score: true,
                status: true,
            },
        });
        return { rules };
    }

    public async updateRule(type: string, dto: UpdateRewardDto) {
        const existing = await this.prisma.reward.findFirst({
            where: { type: type as any },
            select: { id: true },
        });
        if (!existing) throw new NotFoundException(`reward_rule_not_found: ${type}`);

        const updated = await this.prisma.reward.update({
            where: { id: existing.id },
            data: {
                ...(dto.score !== undefined && { score: dto.score }),
                ...(dto.status !== undefined && { status: dto.status as any }),
            },
            select: {
                id: true,
                type: true,
                score: true,
                status: true,
            },
        });
        return updated;
    }
}
