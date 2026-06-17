/**
 * Удаление generic-регионов «Другая … школа/колледж» из таблицы regions.
 *
 *   npm run seed:delete-generic-schools                 # боевой запуск
 *   npm run seed:delete-generic-schools -- --dry-run    # только показать, что удалится
 *
 * Эти варианты использовались как fallback в выборе школы при регистрации.
 * Удаляем сами регионы (type=place_of_study); region_translations и promocodes
 * уходят каскадом (onDelete: Cascade), universities.city_id → NULL (onDelete: SetNull).
 *
 * ВАЖНО: users.school_id (и др. region-FK) имеют onDelete=Restrict — нельзя удалить
 * регион, пока на него ссылается пользователь. Поэтому сначала обнуляем ссылки
 * пользователей на удаляемые регионы, затем удаляем регионы.
 *
 * Чтобы `npm run seed:regions` не вернул их обратно — в regions.seed.ts добавлен
 * denylist по тем же заголовкам (DENYLISTED_REGION_TITLES).
 */

import { PrismaClient } from '../../generated/prisma';
import { DENYLISTED_REGION_TITLES } from './generic-schools.const';

const prisma = new PrismaClient();

function chunk<T>(arr: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}

async function main(): Promise<void> {
    const dryRun = process.argv.slice(2).includes('--dry-run');

    // 1. Найти id регионов по заголовкам (в любой локали).
    const matches = await prisma.regionTranslation.findMany({
        where: { title: { in: [...DENYLISTED_REGION_TITLES] } },
        select: { region_id: true, title: true, locale: true },
    });
    const ids = Array.from(new Set(matches.map((m) => m.region_id)));
    console.log(`Найдено ${matches.length} переводов → ${ids.length} уникальных регионов к удалению.`);
    for (const t of [...DENYLISTED_REGION_TITLES]) {
        console.log(`  «${t}»: ${matches.filter((m) => m.title === t).length} переводов`);
    }

    if (ids.length === 0) {
        console.log('Нечего удалять.');
        return;
    }

    // Сколько пользователей ссылается на эти регионы (для отчёта).
    const referencing = await prisma.user.count({
        where: {
            OR: [
                { country_id: { in: ids } },
                { province_id: { in: ids } },
                { city_id: { in: ids } },
                { district_id: { in: ids } },
                { school_id: { in: ids } },
            ],
        },
    });
    console.log(`Пользователей со ссылкой на эти регионы: ${referencing} (их FK будут обнулены).`);

    if (dryRun) {
        console.log('DRY RUN — записи не изменялись.');
        return;
    }

    // 2. Обнулить ссылки пользователей (иначе FK Restrict заблокирует удаление).
    const cols = ['country_id', 'province_id', 'city_id', 'district_id', 'school_id'] as const;
    for (const col of cols) {
        const res = await prisma.user.updateMany({
            where: { [col]: { in: ids } },
            data: { [col]: null },
        });
        if (res.count > 0) console.log(`  users.${col} обнулено: ${res.count}`);
    }

    // 3. Удалить регионы (translations/promocodes — каскадом, universities.city_id → NULL).
    let deleted = 0;
    for (const batch of chunk(ids, 500)) {
        const res = await prisma.region.deleteMany({ where: { id: { in: batch } } });
        deleted += res.count;
    }
    console.log(`Удалено регионов: ${deleted}`);
    console.log('Готово.');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
