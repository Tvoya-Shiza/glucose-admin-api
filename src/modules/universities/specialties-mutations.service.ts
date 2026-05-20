import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpsertSpecialtyDto } from './dto/upsert-specialty.dto';

export interface SpecialtyRow {
    id: number;
    code: string;
    title_kk: string;
    created_at: number;
    updated_at: number | null;
}

@Injectable()
export class SpecialtiesMutationsService {
    constructor(private readonly prisma: PrismaService) {}

    public async create(dto: UpsertSpecialtyDto): Promise<SpecialtyRow> {
        if (!dto.code) throw new BadRequestException('specialties.code_required');
        if (!dto.title_kk) throw new BadRequestException('specialties.title_kk_required');

        const existing = await this.prisma.specialty.findFirst({
            where: { code: dto.code, deleted_at: null },
            select: { id: true },
        });
        if (existing) throw new ConflictException('specialties.code_taken');

        const now = Math.floor(Date.now() / 1000);
        const created: any = await this.prisma.specialty.create({
            data: { code: dto.code, title_kk: dto.title_kk, created_at: now },
            select: { id: true, code: true, title_kk: true, created_at: true, updated_at: true },
        });
        return this.toRow(created);
    }

    public async update(id: number, dto: UpsertSpecialtyDto): Promise<SpecialtyRow> {
        const existing: any = await this.prisma.specialty.findFirst({
            where: { id, deleted_at: null },
            select: { id: true, code: true },
        });
        if (!existing) throw new NotFoundException('specialties.not_found');

        if (dto.code && dto.code !== existing.code) {
            const conflict = await this.prisma.specialty.findFirst({
                where: { code: dto.code, deleted_at: null, NOT: { id } },
                select: { id: true },
            });
            if (conflict) throw new ConflictException('specialties.code_taken');
        }

        const data: Record<string, unknown> = {};
        if (dto.code !== undefined) data.code = dto.code;
        if (dto.title_kk !== undefined) data.title_kk = dto.title_kk;
        if (Object.keys(data).length === 0) {
            const row: any = await this.prisma.specialty.findFirst({
                where: { id, deleted_at: null },
                select: { id: true, code: true, title_kk: true, created_at: true, updated_at: true },
            });
            return this.toRow(row);
        }
        data.updated_at = Math.floor(Date.now() / 1000);
        const updated: any = await this.prisma.specialty.update({
            where: { id },
            data,
            select: { id: true, code: true, title_kk: true, created_at: true, updated_at: true },
        });
        return this.toRow(updated);
    }

    public async softDelete(id: number): Promise<{ id: number; deleted: true }> {
        const existing: any = await this.prisma.specialty.findFirst({
            where: { id, deleted_at: null },
            select: { id: true, _count: { select: { links: { where: { deleted_at: null } } } } },
        });
        if (!existing) throw new NotFoundException('specialties.not_found');
        if (Number(existing._count?.links ?? 0) > 0) {
            throw new ConflictException('specialties.has_active_links');
        }

        const now = Math.floor(Date.now() / 1000);
        await this.prisma.specialty.update({
            where: { id },
            data: { deleted_at: now, updated_at: now },
        });
        return { id, deleted: true };
    }

    private toRow(r: any): SpecialtyRow {
        return {
            id: Number(r.id),
            code: r.code,
            title_kk: r.title_kk,
            created_at: Number(r.created_at),
            updated_at: r.updated_at === null ? null : Number(r.updated_at),
        };
    }
}
