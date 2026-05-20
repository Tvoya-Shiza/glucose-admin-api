import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface UniversityDetail {
    id: number;
    unik: string;
    city_id: number | null;
    city_title_kk: string | null;
    website: string | null;
    phone: string | null;
    email: string | null;
    instagram: string | null;
    address: string | null;
    has_dormitory: boolean;
    has_military_department: boolean;
    title_kk: string;
    short_desc_kk: string | null;
    full_desc_kk: string | null;
    icon_asset_id: string | null;
    image_asset_id: string | null;
    specialty_count: number;
    created_at: number;
    updated_at: number | null;
}

@Injectable()
export class UniversitiesDetailService {
    constructor(private readonly prisma: PrismaService) {}

    public async getDetail(id: number): Promise<UniversityDetail> {
        const row: any = await this.prisma.university.findFirst({
            where: { id, deleted_at: null },
            select: {
                id: true,
                unik: true,
                city_id: true,
                website: true,
                phone: true,
                email: true,
                instagram: true,
                address: true,
                has_dormitory: true,
                has_military_department: true,
                title_kk: true,
                short_desc_kk: true,
                full_desc_kk: true,
                icon_asset_id: true,
                image_asset_id: true,
                created_at: true,
                updated_at: true,
                city: { select: { translations: { where: { locale: 'kk' }, select: { title: true } } } },
                _count: { select: { specialties: { where: { deleted_at: null } } } },
            },
        });
        if (!row) throw new NotFoundException('universities.not_found');

        return {
            id: Number(row.id),
            unik: row.unik,
            city_id: row.city_id === null ? null : Number(row.city_id),
            city_title_kk: row.city?.translations?.[0]?.title ?? null,
            website: row.website ?? null,
            phone: row.phone ?? null,
            email: row.email ?? null,
            instagram: row.instagram ?? null,
            address: row.address ?? null,
            has_dormitory: !!row.has_dormitory,
            has_military_department: !!row.has_military_department,
            title_kk: row.title_kk,
            short_desc_kk: row.short_desc_kk ?? null,
            full_desc_kk: row.full_desc_kk ?? null,
            icon_asset_id: row.icon_asset_id ?? null,
            image_asset_id: row.image_asset_id ?? null,
            specialty_count: Number(row._count?.specialties ?? 0),
            created_at: Number(row.created_at),
            updated_at: row.updated_at === null ? null : Number(row.updated_at),
        };
    }
}
