import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { apiResponse } from '../../common/utils/api-response';
import { EbooksCacheService } from './utils/ebooks-cache.service';
import { EBOOKS_INVALIDATE_PATTERN, EBOOKS_PUBLIC_INVALIDATE_PATTERN } from './utils/ebooks-cache';
import { ListQuizSubjectsDto } from './dto/list-quiz-subjects.dto';
import { UpsertQuizSubjectDto } from './dto/upsert-quiz-subject.dto';

/** Единственная локаль контентной библиотеки (см. UpsertQuizSubjectDto). */
const LOCALE = 'kz';

/**
 * Phase 43 — справочник предметов (ТЗ 3.2.2, 6.0).
 *
 * `quiz_subjects` — общая таксономия тестов, тренажёров и книг, но эндпоинтов у
 * неё не было: книге предмет можно было привязать только вписав числовой id
 * руками. Здесь появляется список для выбора и возможность добавить/переименовать
 * предмет.
 *
 * Удаления сознательно нет: на предмет ссылаются тесты, категории и книги, а ТЗ
 * требует «настраивается» — то есть пополнение и правку названий. Удаление
 * предмета, за которым висят тесты, — отдельное решение с миграцией данных.
 *
 * Название предмета вкраплено в кэшированные строки каталога книг, поэтому
 * каждая мутация сбрасывает namespace'ы кэша ebooks (как в PublishersService).
 */
@Injectable()
export class QuizSubjectsService {
    public static readonly DEFAULT_PAGE_SIZE = 50;
    public static readonly MAX_PAGE_SIZE = 200;

    constructor(
        private readonly prisma: PrismaService,
        private readonly cache: EbooksCacheService,
    ) {}

    public async list(query: ListQuizSubjectsDto) {
        const page = Math.max(1, query.page ?? 1);
        const page_size = Math.min(
            QuizSubjectsService.MAX_PAGE_SIZE,
            Math.max(1, query.page_size ?? QuizSubjectsService.DEFAULT_PAGE_SIZE),
        );

        const where: any = {};
        const q = query.q?.trim();
        if (q) {
            where.translations = { some: { title: { contains: q } } };
        }

        const skip = (page - 1) * page_size;
        const [total, rowsRaw] = await this.prisma.$transaction([
            this.prisma.quizSubject.count({ where }),
            this.prisma.quizSubject.findMany({
                where,
                // Сортировать по названию нельзя — оно в связанной таблице переводов,
                // поэтому упорядочиваем по id и сортируем по названию уже в памяти.
                orderBy: { id: 'asc' },
                take: page_size,
                skip,
                select: {
                    id: true,
                    created_at: true,
                    updated_at: true,
                    translations: { select: { locale: true, title: true } },
                    _count: { select: { books: true, quizzes: true } },
                },
            }),
        ]);

        const rows = (rowsRaw as any[])
            .map((r) => ({
                id: Number(r.id),
                title: pickTitle(r.translations),
                book_count: Number(r._count?.books ?? 0),
                quiz_count: Number(r._count?.quizzes ?? 0),
                created_at: r.created_at == null ? null : Number(r.created_at),
                updated_at: r.updated_at == null ? null : Number(r.updated_at),
            }))
            .sort((a, b) => a.title.localeCompare(b.title, 'kk'));

        return { rows, total, pageCount: Math.max(1, Math.ceil(total / page_size)) };
    }

    public async create(dto: UpsertQuizSubjectDto) {
        const title = dto.title.trim();
        await this.assertTitleFree(title, null);

        const now = Math.floor(Date.now() / 1000);
        const created = await this.prisma.quizSubject.create({
            data: {
                created_at: now,
                updated_at: now,
                translations: { create: [{ locale: LOCALE, title }] },
            },
            select: { id: true, translations: { select: { locale: true, title: true } } },
        });
        await this.invalidate();

        return apiResponse(1, 'created', 'subjects.created', {
            id: Number(created.id),
            title: pickTitle(created.translations),
        });
    }

    public async update(id: number, dto: UpsertQuizSubjectDto) {
        const subject = await this.prisma.quizSubject.findUnique({
            where: { id },
            select: { id: true, translations: { select: { id: true, locale: true } } },
        });
        if (!subject) throw new NotFoundException('subjects.not_found');

        const title = dto.title.trim();
        await this.assertTitleFree(title, id);

        const existing = subject.translations.find((t) => t.locale === LOCALE);
        const now = Math.floor(Date.now() / 1000);
        await this.prisma.$transaction(async (tx) => {
            if (existing) {
                await tx.quizSubjectTranslation.update({ where: { id: existing.id }, data: { title } });
            } else {
                // Легаси-предмет без kz-перевода — досоздаём, иначе название негде хранить.
                await tx.quizSubjectTranslation.create({ data: { quiz_subject_id: id, locale: LOCALE, title } });
            }
            await tx.quizSubject.update({ where: { id }, data: { updated_at: now } });
        });
        await this.invalidate();

        return apiResponse(1, 'updated', 'subjects.updated', { id, title });
    }

    /**
     * Названия предметов должны быть различимы: два «Биология» в выпадающем списке
     * не дают оператору понять, к какому из них он привязывает книгу. Уникального
     * индекса в БД на это нет (таблица переводов общая), поэтому проверяем здесь.
     */
    private async assertTitleFree(title: string, exceptId: number | null) {
        const clash = await this.prisma.quizSubjectTranslation.findFirst({
            where: {
                locale: LOCALE,
                title,
                ...(exceptId == null ? {} : { quiz_subject_id: { not: exceptId } }),
            },
            select: { quiz_subject_id: true },
        });
        if (clash) throw new ConflictException('subjects.duplicate');
    }

    private async invalidate() {
        await this.cache.invalidate(EBOOKS_INVALIDATE_PATTERN);
        await this.cache.invalidate(EBOOKS_PUBLIC_INVALIDATE_PATTERN);
    }
}

function pickTitle(translations: Array<{ locale: string; title: string }> | null | undefined): string {
    const rows = translations ?? [];
    return (rows.find((t) => t.locale === LOCALE)?.title ?? rows[0]?.title ?? '').trim();
}
