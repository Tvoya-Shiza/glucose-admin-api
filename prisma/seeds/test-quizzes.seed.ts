/**
 * Test data seed — 10 quizzes + 5 quiz badges with assorted listing/pricing flags.
 *
 *   npx ts-node -r tsconfig-paths/register prisma/seeds/test-quizzes.seed.ts
 *
 * Idempotent: deletes any pre-existing rows whose KZ title starts with the
 * marker `[TEST]` before re-inserting. Safe to re-run.
 *
 * Coverage matrix (Phase 22 + 23):
 *   Quizzes (10):
 *     - 4 free + listed (public free)
 *     - 3 paid + listed (public paid, different prices/access_days)
 *     - 2 free + unlisted (course-only)
 *     - 1 paid + unlisted (premium course add-on)
 *   Badges (5):
 *     - 2 free + listed
 *     - 2 paid + listed
 *     - 1 free + unlisted (for testing visibility gate)
 *
 * Each quiz has 5 single-choice questions, each with 4 answer options (1 correct).
 * Each badge contains 2-3 quizzes (mixed listed/unlisted to demonstrate that
 * badges can wrap any quiz regardless of its is_listed flag).
 */

import { PrismaClient } from '../../generated/prisma';

const prisma = new PrismaClient();

const TEST_MARKER = '[TEST]';

function nowSec(): number {
    return Math.floor(Date.now() / 1000);
}

type QuizSpec = {
    label: string;
    is_listed: boolean;
    is_paid: boolean;
    price?: string;
    access_days?: number;
    pass_mark: number;
    time?: number;
    attempt?: number | null;
    certificate?: boolean;
};

const quizSpecs: QuizSpec[] = [
    { label: 'Биология — 7 сынып негіздері',     is_listed: true,  is_paid: false, pass_mark: 60, time: 600 },
    { label: 'Математика — есеп шығару',          is_listed: true,  is_paid: false, pass_mark: 70, time: 900 },
    { label: 'Тарих — Қазақстан тарихы',          is_listed: true,  is_paid: false, pass_mark: 50, time: 1200 },
    { label: 'География — материктер',            is_listed: true,  is_paid: false, pass_mark: 55 },
    { label: 'Физика — ЕНТ дайындық',             is_listed: true,  is_paid: true,  price: '5000.000', access_days: 30, pass_mark: 70, certificate: true },
    { label: 'Химия — органикалық химия',         is_listed: true,  is_paid: true,  price: '3000.000', access_days: 14, pass_mark: 65 },
    { label: 'Ағылшын тілі — деңгей B2',          is_listed: true,  is_paid: true,  price: '4000.000', access_days: 60, pass_mark: 75 },
    { label: 'Курс 1-сабақ — кіріспе тест',       is_listed: false, is_paid: false, pass_mark: 50 },
    { label: 'Курс 2-сабақ — практикалық тест',   is_listed: false, is_paid: false, pass_mark: 60 },
    { label: 'Премиум қосымша — терең талдау',    is_listed: false, is_paid: true,  price: '1500.000', access_days: 14, pass_mark: 70 },
];

type BadgeSpec = {
    label: string;
    is_listed: boolean;
    is_paid: boolean;
    price?: string;
    access_days?: number;
    /** Which quizSpecs (by 1-based index) to include as items. */
    quizIndexes: number[];
};

const badgeSpecs: BadgeSpec[] = [
    { label: 'Пробное ЕНТ — Жалпы дайындық',          is_listed: true,  is_paid: false, quizIndexes: [1, 2, 3] },
    { label: 'Пробное ЕНТ — Жаратылыстану ғылымдары', is_listed: true,  is_paid: false, quizIndexes: [1, 4] },
    { label: 'Премиум пробное ЕНТ',                    is_listed: true,  is_paid: true, price: '10000.000', access_days: 90, quizIndexes: [5, 6, 7] },
    { label: 'Жоғары деңгей пакет',                    is_listed: true,  is_paid: true, price: '15000.000', access_days: 60, quizIndexes: [5, 7, 10] },
    { label: 'Жасырын тренировочный (test only)',      is_listed: false, is_paid: false, quizIndexes: [8, 9] },
];

async function cleanup() {
    // Delete existing TEST rows (cascades through translations / questions / answers).
    const oldQuizTrs = await prisma.quizTranslation.findMany({
        where: { title: { startsWith: TEST_MARKER } },
        select: { quiz_id: true },
    });
    const oldQuizIds = [...new Set(oldQuizTrs.map((t) => t.quiz_id))];
    if (oldQuizIds.length > 0) {
        await prisma.quizzes.deleteMany({ where: { id: { in: oldQuizIds } } });
    }

    const oldBadgeTrs = await prisma.quizBadgeTranslation.findMany({
        where: { title: { startsWith: TEST_MARKER } },
        select: { quiz_badge_id: true },
    });
    const oldBadgeIds = [...new Set(oldBadgeTrs.map((t) => t.quiz_badge_id))];
    if (oldBadgeIds.length > 0) {
        // Badge items must be removed manually — cascade on QuizBadgeItem is partial.
        await prisma.quizBadgeItem.deleteMany({ where: { quiz_badge_id: { in: oldBadgeIds } } });
        await prisma.quizBadgeTranslation.deleteMany({ where: { quiz_badge_id: { in: oldBadgeIds } } });
        await prisma.quizBadge.deleteMany({ where: { id: { in: oldBadgeIds } } });
    }

    return { removedQuizzes: oldQuizIds.length, removedBadges: oldBadgeIds.length };
}

async function seedQuiz(spec: QuizSpec): Promise<number> {
    const title = `${TEST_MARKER} ${spec.label}`;
    const created_at = nowSec();

    const quiz = await prisma.quizzes.create({
        data: {
            status: 'active',
            pass_mark: spec.pass_mark,
            time: spec.time ?? 0,
            attempt: spec.attempt ?? null,
            certificate: spec.certificate ?? false,
            display_questions_randomly: false,
            is_listed: spec.is_listed,
            is_paid: spec.is_paid,
            price: spec.is_paid ? spec.price ?? null : null,
            access_days: spec.is_paid ? spec.access_days ?? null : null,
            version: 1,
            created_at,
            translations: { create: { locale: 'kz', title } },
        },
        select: { id: true },
    });

    // Five single-choice questions, four answers each (1 correct, 3 incorrect).
    for (let qIdx = 1; qIdx <= 5; qIdx++) {
        const question: any = await (prisma as any).quizQuestion.create({
            data: {
                quiz_id: quiz.id,
                type: 'single',
                grade: 1,
                order: qIdx,
                created_at,
                translations: {
                    create: {
                        locale: 'kz',
                        title: `${qIdx}-сұрақ: «${spec.label}» бойынша сұрақ`,
                        description: null,
                        correct: null,
                    },
                },
            },
            select: { id: true },
        });

        for (let aIdx = 1; aIdx <= 4; aIdx++) {
            await (prisma as any).quizQuestionAnswer.create({
                data: {
                    question_id: question.id,
                    correct: aIdx === 1, // First option is the correct one.
                    created_at,
                    translations: {
                        create: {
                            locale: 'kz',
                            title: aIdx === 1 ? 'Дұрыс жауап' : `Жауап нұсқасы ${aIdx}`,
                        },
                    },
                },
            });
        }
    }

    return quiz.id;
}

/**
 * Phase 24 — seed an identificative (ENT-format) question into an existing quiz.
 * Creates 4 shared options first, then 2 prompts whose `match_target_id` points
 * to the option indicated by `match_idx` (1-based, 1..4).
 */
async function seedIdentificativeQuestion(
    quizId: number,
    order: number,
    grade: number,
    promptTitlePrefix: string,
    prompts: Array<{ title: string; match_idx: number }>,
    options: string[],
): Promise<void> {
    const created_at = nowSec();

    const question: any = await (prisma as any).quizQuestion.create({
        data: {
            quiz_id: quizId,
            type: 'identificative',
            grade,
            order,
            created_at,
            translations: {
                create: {
                    locale: 'kz',
                    title: `${order}-сұрақ: ${promptTitlePrefix}`,
                    description: null,
                    correct: null,
                },
            },
        },
        select: { id: true },
    });

    const optionIds: number[] = [];
    for (const optTitle of options) {
        const o: any = await (prisma as any).quizQuestionAnswer.create({
            data: {
                question_id: question.id,
                parent_id: null,
                match_target_id: null,
                correct: false,
                created_at,
                translations: { create: { locale: 'kz', title: optTitle } },
            },
            select: { id: true },
        });
        optionIds.push(o.id);
    }

    for (const p of prompts) {
        const targetId = optionIds[p.match_idx - 1];
        if (!targetId) continue;
        await (prisma as any).quizQuestionAnswer.create({
            data: {
                question_id: question.id,
                parent_id: null,
                match_target_id: targetId,
                correct: false,
                created_at,
                translations: { create: { locale: 'kz', title: p.title } },
            },
        });
    }
}

async function seedBadge(spec: BadgeSpec, quizIds: number[]): Promise<number> {
    const title = `${TEST_MARKER} ${spec.label}`;

    const badge = await prisma.quizBadge.create({
        data: {
            is_active: true,
            is_listed: spec.is_listed,
            is_paid: spec.is_paid,
            price: spec.is_paid ? spec.price ?? null : null,
            access_days: spec.is_paid ? spec.access_days ?? null : null,
            translations: { create: { locale: 'kz', title } },
        },
        select: { id: true },
    });

    let order = 1;
    for (const idx of spec.quizIndexes) {
        const quizId = quizIds[idx - 1];
        if (!quizId) continue;
        await prisma.quizBadgeItem.create({
            data: { quiz_badge_id: badge.id, quiz_id: quizId, order: order++ },
        });
    }

    return badge.id;
}

async function main() {
    console.log('— Test data seed —');
    const removed = await cleanup();
    console.log(`Removed previous TEST rows: ${removed.removedQuizzes} quizzes, ${removed.removedBadges} badges`);

    const quizIds: number[] = [];
    for (const spec of quizSpecs) {
        const id = await seedQuiz(spec);
        quizIds.push(id);
        const flag = `${spec.is_listed ? 'listed' : 'unlisted'} / ${spec.is_paid ? `paid ${spec.price} / ${spec.access_days}d` : 'free'}`;
        console.log(`  quiz #${id}  ${flag}  — ${spec.label}`);
    }

    // Phase 24 — dedicated quiz with 3 identificative-ENT questions.
    console.log('');
    const identQuizId = await seedQuiz({
        label: 'ЕНТ идентификация — тест формат',
        is_listed: true,
        is_paid: false,
        pass_mark: 60,
        time: 600,
    });
    // The seedQuiz call above already added 5 single-choice questions (order 1..5).
    // We add 3 more identificative questions starting at order 6.
    await seedIdentificativeQuestion(
        identQuizId,
        6,
        2,
        'Биология ұғымдарын анықтаңыз',
        [
            { title: 'Фотосинтез деген...', match_idx: 1 },
            { title: 'Митоз деген...', match_idx: 3 },
        ],
        [
            'Күн энергиясынан органикалық зат жасау',
            'Жасуша тыныс алуы',
            'Жасушаның бөлінуі (соматикалық)',
            'Жыныс жасушаларын түзу',
        ],
    );
    await seedIdentificativeQuestion(
        identQuizId,
        7,
        2,
        'Қазақстан тарихындағы оқиғаларды сәйкестендіріңіз',
        [
            { title: 'Ұлы Отан соғысы басталған жыл', match_idx: 2 },
            { title: 'Тәуелсіздік алған жыл', match_idx: 4 },
        ],
        ['1939', '1941', '1986', '1991'],
    );
    await seedIdentificativeQuestion(
        identQuizId,
        8,
        2,
        'Химия элементтерін топтарға бөліңіз',
        [
            { title: 'Сілтілі металл', match_idx: 1 },
            { title: 'Инертті газ', match_idx: 4 },
        ],
        ['Натрий (Na)', 'Темір (Fe)', 'Хлор (Cl)', 'Гелий (He)'],
    );
    console.log(`  quiz #${identQuizId}  listed / free  — ЕНТ идентификация — тест формат (5 single + 3 identificative)`);
    quizIds.push(identQuizId);

    console.log('');
    for (const spec of badgeSpecs) {
        const id = await seedBadge(spec, quizIds);
        const flag = `${spec.is_listed ? 'listed' : 'unlisted'} / ${spec.is_paid ? `paid ${spec.price} / ${spec.access_days}d` : 'free'}`;
        console.log(`  badge #${id}  ${flag}  items=[${spec.quizIndexes.join(',')}]  — ${spec.label}`);
    }

    console.log('\nDone.');
}

main()
    .catch((err) => {
        console.error(err);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
