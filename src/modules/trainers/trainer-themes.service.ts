import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { apiResponse } from '../../common/utils/api-response';
import { TrainersCacheService } from './utils/trainers-cache.service';
import { TRAINERS_INVALIDATE_PATTERN, TRAINERS_PUBLIC_INVALIDATE_PATTERN } from './utils/trainers-cache';
import { ListTrainerThemesDto } from './dto/list-trainer-themes.dto';
import { UpsertTrainerThemeDto } from './dto/upsert-trainer-theme.dto';

/**
 * Phase 43 — справочник тем оформления тренажёра.
 *
 * Тема = картинка-фон + ключ палитры, которой красятся плитки ответов. Ученик
 * переключает темы прямо в игровом меню (образец wayground.com), поэтому список
 * общий, а не свойство одного тренажёра; у тренажёра хранится лишь тема по
 * умолчанию (trainer_settings.theme_id).
 *
 * Удаления нет намеренно: тему может держать открытая попытка ученика, а FK
 * стоит на SET NULL — «удалить» значит незаметно обнулить оформление у
 * тренажёров. Вместо этого is_active=false убирает тему из выдачи ученику,
 * оставляя её видимой в админке.
 *
 * Название темы попадает в кэшированные ответы каталога, поэтому каждая мутация
 * сбрасывает оба namespace'а — админский и студенческий (как в
 * TrainersMutationsService).
 */
@Injectable()
export class TrainerThemesService {
    public static readonly DEFAULT_PAGE_SIZE = 50;
    public static readonly MAX_PAGE_SIZE = 200;

    constructor(
        private readonly prisma: PrismaService,
        private readonly cache: TrainersCacheService,
    ) {}

    public async list(query: ListTrainerThemesDto) {
        const page = Math.max(1, query.page ?? 1);
        const page_size = Math.min(
            TrainerThemesService.MAX_PAGE_SIZE,
            Math.max(1, query.page_size ?? TrainerThemesService.DEFAULT_PAGE_SIZE),
        );

        const where: any = {};
        const q = query.q?.trim();
        if (q) where.title = { contains: q };
        if (query.active_only === 'true') where.is_active = true;

        const [total, rows] = await this.prisma.$transaction([
            this.prisma.trainerTheme.count({ where }),
            this.prisma.trainerTheme.findMany({
                where,
                orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
                take: page_size,
                skip: (page - 1) * page_size,
                select: {
                    id: true,
                    title: true,
                    image: true,
                    palette: true,
                    sort_order: true,
                    is_active: true,
                    created_at: true,
                    updated_at: true,
                    _count: { select: { trainer_settings: true } },
                },
            }),
        ]);

        return {
            rows: (rows as any[]).map((row) => ({
                id: Number(row.id),
                title: row.title,
                image: row.image ?? null,
                palette: row.palette,
                sort_order: Number(row.sort_order ?? 0),
                is_active: Boolean(row.is_active),
                // Сколько тренажёров держат тему по умолчанию — видно, что отключение заметят.
                trainer_count: Number(row._count?.trainer_settings ?? 0),
                created_at: row.created_at == null ? null : Number(row.created_at),
                updated_at: row.updated_at == null ? null : Number(row.updated_at),
            })),
            total,
            pageCount: Math.max(1, Math.ceil(total / page_size)),
        };
    }

    public async create(dto: UpsertTrainerThemeDto) {
        const title = dto.title.trim();
        await this.assertTitleFree(title, null);

        const now = Math.floor(Date.now() / 1000);
        const created = await this.prisma.trainerTheme.create({
            data: {
                title,
                image: dto.image?.trim() || null,
                palette: dto.palette ?? 'classic',
                sort_order: dto.sort_order ?? 0,
                is_active: dto.is_active ?? true,
                created_at: now,
                updated_at: now,
            },
            select: { id: true, title: true },
        });
        await this.invalidate();

        return apiResponse(1, 'created', 'trainer-themes.created', { id: Number(created.id), title: created.title });
    }

    public async update(id: number, dto: UpsertTrainerThemeDto) {
        const theme = await this.prisma.trainerTheme.findUnique({ where: { id }, select: { id: true } });
        if (!theme) throw new NotFoundException('trainer-themes.not_found');

        const title = dto.title.trim();
        await this.assertTitleFree(title, id);

        await this.prisma.trainerTheme.update({
            where: { id },
            data: {
                title,
                // undefined — поле не прислали, оставляем как есть; пустая строка чистит картинку.
                ...(dto.image === undefined ? {} : { image: dto.image?.trim() || null }),
                ...(dto.palette === undefined ? {} : { palette: dto.palette }),
                ...(dto.sort_order === undefined ? {} : { sort_order: dto.sort_order }),
                ...(dto.is_active === undefined ? {} : { is_active: dto.is_active }),
                updated_at: Math.floor(Date.now() / 1000),
            },
        });
        await this.invalidate();

        return apiResponse(1, 'updated', 'trainer-themes.updated', { id, title });
    }

    /** Два «Космос» в сетке тем неразличимы — оператор не поймёт, какую выбирает. */
    private async assertTitleFree(title: string, exceptId: number | null) {
        const clash = await this.prisma.trainerTheme.findFirst({
            where: { title, ...(exceptId == null ? {} : { id: { not: exceptId } }) },
            select: { id: true },
        });
        if (clash) throw new ConflictException('trainer-themes.duplicate');
    }

    private async invalidate() {
        await this.cache.invalidate(TRAINERS_INVALIDATE_PATTERN);
        await this.cache.invalidate(TRAINERS_PUBLIC_INVALIDATE_PATTERN);
    }
}
