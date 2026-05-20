import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpsertUniversityDto } from './dto/upsert-university.dto';
import { UniversitiesDetailService, type UniversityDetail } from './universities-detail.service';

@Injectable()
export class UniversitiesMutationsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly detail: UniversitiesDetailService,
    ) {}

    public async create(dto: UpsertUniversityDto): Promise<UniversityDetail> {
        if (!dto.unik) throw new BadRequestException('universities.unik_required');
        if (!dto.title_kk) throw new BadRequestException('universities.title_kk_required');

        await this.assertCityValid(dto.city_id ?? null);

        const existing = await this.prisma.university.findFirst({
            where: { unik: dto.unik, deleted_at: null },
            select: { id: true },
        });
        if (existing) throw new ConflictException('universities.unik_taken');

        const now = Math.floor(Date.now() / 1000);
        const created = await this.prisma.university.create({
            data: {
                unik: dto.unik,
                city_id: dto.city_id ?? null,
                website: dto.website ?? null,
                phone: dto.phone ?? null,
                email: dto.email ?? null,
                instagram: dto.instagram ?? null,
                address: dto.address ?? null,
                has_dormitory: dto.has_dormitory ?? false,
                has_military_department: dto.has_military_department ?? false,
                title_kk: dto.title_kk,
                short_desc_kk: dto.short_desc_kk ?? null,
                full_desc_kk: dto.full_desc_kk ?? null,
                icon_asset_id: dto.icon_asset_id ?? null,
                image_asset_id: dto.image_asset_id ?? null,
                created_at: now,
            },
            select: { id: true },
        });
        return this.detail.getDetail(Number(created.id));
    }

    public async update(id: number, dto: UpsertUniversityDto): Promise<UniversityDetail> {
        const existing = await this.prisma.university.findFirst({
            where: { id, deleted_at: null },
            select: { id: true, unik: true },
        });
        if (!existing) throw new NotFoundException('universities.not_found');

        if (dto.unik && dto.unik !== existing.unik) {
            const conflict = await this.prisma.university.findFirst({
                where: { unik: dto.unik, deleted_at: null, NOT: { id } },
                select: { id: true },
            });
            if (conflict) throw new ConflictException('universities.unik_taken');
        }

        await this.assertCityValid(dto.city_id ?? null);

        const data: Record<string, unknown> = {};
        if (dto.unik !== undefined) data.unik = dto.unik;
        if (dto.city_id !== undefined) data.city_id = dto.city_id;
        if (dto.website !== undefined) data.website = dto.website;
        if (dto.phone !== undefined) data.phone = dto.phone;
        if (dto.email !== undefined) data.email = dto.email;
        if (dto.instagram !== undefined) data.instagram = dto.instagram;
        if (dto.address !== undefined) data.address = dto.address;
        if (dto.has_dormitory !== undefined) data.has_dormitory = dto.has_dormitory;
        if (dto.has_military_department !== undefined) data.has_military_department = dto.has_military_department;
        if (dto.title_kk !== undefined) data.title_kk = dto.title_kk;
        if (dto.short_desc_kk !== undefined) data.short_desc_kk = dto.short_desc_kk;
        if (dto.full_desc_kk !== undefined) data.full_desc_kk = dto.full_desc_kk;
        if (dto.icon_asset_id !== undefined) data.icon_asset_id = dto.icon_asset_id;
        if (dto.image_asset_id !== undefined) data.image_asset_id = dto.image_asset_id;

        if (Object.keys(data).length === 0) return this.detail.getDetail(id);

        data.updated_at = Math.floor(Date.now() / 1000);
        await this.prisma.university.update({ where: { id }, data });
        return this.detail.getDetail(id);
    }

    public async softDelete(id: number): Promise<{ id: number; deleted: true }> {
        const existing = await this.prisma.university.findFirst({
            where: { id, deleted_at: null },
            select: { id: true },
        });
        if (!existing) throw new NotFoundException('universities.not_found');

        const now = Math.floor(Date.now() / 1000);
        await this.prisma.university.update({
            where: { id },
            data: { deleted_at: now, updated_at: now },
        });
        return { id, deleted: true };
    }

    private async assertCityValid(cityId: number | null): Promise<void> {
        if (cityId === null) return;
        const row = await this.prisma.region.findFirst({
            where: { id: cityId, type: 'city' },
            select: { id: true },
        });
        if (!row) throw new BadRequestException('universities.city_id_invalid');
    }
}
