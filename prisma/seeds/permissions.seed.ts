/**
 * Permission catalog seed — idempotent.
 *
 *   npm run seed:permissions             # safe mode (default; for prod)
 *   npm run seed:permissions -- --prune  # also removes orphan permissions / groups
 *
 * What it does in safe mode (default):
 *  1. Upserts permission_groups and permissions by `code` (catalog below is source of truth).
 *     name_ru / name_kz / display_order are refreshed; existing role_permissions are untouched.
 *  2. Logs (but does NOT delete) any orphan permissions/groups in the DB that are not in
 *     the catalog. They will continue to function until pruned explicitly.
 *  3. Upserts the three core roles (admin / curator / teacher) with is_system=1.
 *  4. Default grants for curator/teacher are written ONLY when a role has zero rows
 *     in role_permissions — never overwrites manual edits made via /access/roles UI.
 *     Admin gets no rows (super-bypass).
 *  5. Invalidates Redis cache for touched roles ('geonline-admin:perms:role:<id>').
 *
 * In --prune mode (use with care; ops-only):
 *  - Orphans are DELETED. Cascade FK on role_permissions drops grants automatically.
 *  - Required when intentionally removing a permission code from the catalog. Do not run
 *    in prod without verifying the catalog is correct (typos in catalog === lost grants).
 *
 * Safe to re-run. On prod we recommend wiring this into the deploy pipeline AFTER the
 * application has booted (so the catalog drift is fresh) — see docs/access-control.md.
 */

import { PrismaClient } from '../../generated/prisma';
import Redis from 'ioredis';

const prisma = new PrismaClient();

// -- Catalog -----------------------------------------------------------------

type SeedPermission = {
    action: string;
    name_ru: string;
    name_kz: string;
    display_order: number;
    description?: string;
    // Optional override for the auto-generated code. By default code = `${group.code}.${action}`.
    // Used for composite actions like `quizzes.badges_manage` (where action='badges_manage').
    code_override?: string;
};

type SeedGroup = {
    code: string;
    display_order: number;
    name_ru: string;
    name_kz: string;
    permissions: SeedPermission[];
};

const CATALOG: SeedGroup[] = [
    {
        code: 'dashboard',
        display_order: 100,
        name_ru: 'Дашборд',
        name_kz: 'Басқару тақтасы',
        permissions: [{ action: 'view', display_order: 10, name_ru: 'Просмотр', name_kz: 'Көру' }],
    },
    {
        code: 'users',
        display_order: 200,
        name_ru: 'Пользователи',
        name_kz: 'Пайдаланушылар',
        permissions: [
            { action: 'view', display_order: 10, name_ru: 'Просмотр', name_kz: 'Көру' },
            { action: 'create', display_order: 20, name_ru: 'Создание', name_kz: 'Құру' },
            { action: 'import', display_order: 25, name_ru: 'Импорт', name_kz: 'Импорт' },
            { action: 'edit', display_order: 30, name_ru: 'Редактирование', name_kz: 'Өңдеу' },
            { action: 'delete', display_order: 40, name_ru: 'Удаление', name_kz: 'Жою' },
            { action: 'export', display_order: 50, name_ru: 'Экспорт', name_kz: 'Экспорт' },
            { action: 'impersonate', display_order: 60, name_ru: 'Войти под пользователем', name_kz: 'Пайдаланушы ретінде кіру' },
        ],
    },
    {
        code: 'groups',
        display_order: 300,
        name_ru: 'Группы',
        name_kz: 'Топтар',
        permissions: [
            { action: 'view', display_order: 10, name_ru: 'Просмотр', name_kz: 'Көру' },
            { action: 'create', display_order: 20, name_ru: 'Создание', name_kz: 'Құру' },
            { action: 'edit', display_order: 30, name_ru: 'Редактирование', name_kz: 'Өңдеу' },
            { action: 'delete', display_order: 40, name_ru: 'Удаление', name_kz: 'Жою' },
        ],
    },
    {
        code: 'courses',
        display_order: 400,
        name_ru: 'Курсы',
        name_kz: 'Курстар',
        permissions: [
            { action: 'view', display_order: 10, name_ru: 'Просмотр', name_kz: 'Көру' },
            { action: 'create', display_order: 20, name_ru: 'Создание', name_kz: 'Құру' },
            { action: 'edit', display_order: 30, name_ru: 'Редактирование', name_kz: 'Өңдеу' },
            { action: 'delete', display_order: 40, name_ru: 'Удаление', name_kz: 'Жою' },
            { action: 'publish', display_order: 50, name_ru: 'Публикация', name_kz: 'Жариялау' },
            { action: 'export', display_order: 60, name_ru: 'Экспорт', name_kz: 'Экспорт' },
        ],
    },
    {
        code: 'quizzes',
        display_order: 500,
        name_ru: 'Тесты',
        name_kz: 'Тесттер',
        permissions: [
            { action: 'view', display_order: 10, name_ru: 'Просмотр', name_kz: 'Көру' },
            { action: 'create', display_order: 20, name_ru: 'Создание', name_kz: 'Құру' },
            { action: 'edit', display_order: 30, name_ru: 'Редактирование', name_kz: 'Өңдеу' },
            { action: 'delete', display_order: 40, name_ru: 'Удаление', name_kz: 'Жою' },
            { action: 'publish', display_order: 50, name_ru: 'Публикация', name_kz: 'Жариялау' },
            { action: 'export', display_order: 60, name_ru: 'Экспорт', name_kz: 'Экспорт' },
            { action: 'badges_manage', display_order: 70, name_ru: 'Управление бейджами', name_kz: 'Белгілерді басқару' },
            { action: 'categories_manage', display_order: 80, name_ru: 'Управление категориями', name_kz: 'Санаттарды басқару' },
            { action: 'results_view', display_order: 90, name_ru: 'Просмотр результатов', name_kz: 'Нәтижелерді көру' },
        ],
    },
    {
        code: 'files',
        display_order: 600,
        name_ru: 'Файлы',
        name_kz: 'Файлдар',
        permissions: [
            { action: 'view', display_order: 10, name_ru: 'Просмотр', name_kz: 'Көру' },
            { action: 'create', display_order: 20, name_ru: 'Загрузка', name_kz: 'Жүктеу' },
            { action: 'delete', display_order: 30, name_ru: 'Удаление', name_kz: 'Жою' },
        ],
    },
    {
        code: 'stories',
        display_order: 700,
        name_ru: 'Истории',
        name_kz: 'Сторилер',
        permissions: [
            { action: 'view', display_order: 10, name_ru: 'Просмотр', name_kz: 'Көру' },
            { action: 'create', display_order: 20, name_ru: 'Создание', name_kz: 'Құру' },
            { action: 'edit', display_order: 30, name_ru: 'Редактирование', name_kz: 'Өңдеу' },
            { action: 'delete', display_order: 40, name_ru: 'Удаление', name_kz: 'Жою' },
            { action: 'publish', display_order: 50, name_ru: 'Публикация', name_kz: 'Жариялау' },
        ],
    },
    {
        code: 'banners',
        display_order: 800,
        name_ru: 'Баннеры',
        name_kz: 'Баннерлер',
        permissions: [
            { action: 'view', display_order: 10, name_ru: 'Просмотр', name_kz: 'Көру' },
            { action: 'create', display_order: 20, name_ru: 'Создание', name_kz: 'Құру' },
            { action: 'edit', display_order: 30, name_ru: 'Редактирование', name_kz: 'Өңдеу' },
            { action: 'delete', display_order: 40, name_ru: 'Удаление', name_kz: 'Жою' },
            { action: 'publish', display_order: 50, name_ru: 'Публикация', name_kz: 'Жариялау' },
        ],
    },
    {
        code: 'blogs',
        display_order: 900,
        name_ru: 'Блог',
        name_kz: 'Блог',
        permissions: [
            { action: 'view', display_order: 10, name_ru: 'Просмотр', name_kz: 'Көру' },
            { action: 'create', display_order: 20, name_ru: 'Создание', name_kz: 'Құру' },
            { action: 'edit', display_order: 30, name_ru: 'Редактирование', name_kz: 'Өңдеу' },
            { action: 'delete', display_order: 40, name_ru: 'Удаление', name_kz: 'Жою' },
            { action: 'publish', display_order: 50, name_ru: 'Публикация', name_kz: 'Жариялау' },
            { action: 'categories_manage', display_order: 60, name_ru: 'Управление категориями', name_kz: 'Санаттарды басқару' },
        ],
    },
    {
        code: 'promocodes',
        display_order: 1000,
        name_ru: 'Промокоды',
        name_kz: 'Промокодтар',
        permissions: [
            { action: 'view', display_order: 10, name_ru: 'Просмотр', name_kz: 'Көру' },
            { action: 'create', display_order: 20, name_ru: 'Создание', name_kz: 'Құру' },
            { action: 'edit', display_order: 30, name_ru: 'Редактирование', name_kz: 'Өңдеу' },
            { action: 'delete', display_order: 40, name_ru: 'Удаление', name_kz: 'Жою' },
        ],
    },
    {
        code: 'push',
        display_order: 1100,
        name_ru: 'Push-уведомления',
        name_kz: 'Push-хабарламалар',
        permissions: [
            { action: 'view', display_order: 10, name_ru: 'Просмотр', name_kz: 'Көру' },
            { action: 'create', display_order: 20, name_ru: 'Создание', name_kz: 'Құру' },
            { action: 'schedule', display_order: 30, name_ru: 'Планирование', name_kz: 'Жоспарлау' },
            { action: 'history_view', display_order: 40, name_ru: 'Просмотр истории', name_kz: 'Тарихты көру' },
        ],
    },
    {
        code: 'mailings',
        display_order: 1200,
        name_ru: 'Рассылки',
        name_kz: 'Хат таратулар',
        permissions: [
            { action: 'view', display_order: 10, name_ru: 'Просмотр', name_kz: 'Көру' },
            { action: 'create', display_order: 20, name_ru: 'Создание', name_kz: 'Құру' },
            { action: 'history_view', display_order: 30, name_ru: 'Просмотр истории', name_kz: 'Тарихты көру' },
        ],
    },
    {
        code: 'payments',
        display_order: 1300,
        name_ru: 'Платежи',
        name_kz: 'Төлемдер',
        permissions: [
            { action: 'view', display_order: 10, name_ru: 'Просмотр', name_kz: 'Көру' },
            { action: 'export', display_order: 20, name_ru: 'Экспорт', name_kz: 'Экспорт' },
            { action: 'refund', display_order: 30, name_ru: 'Возврат', name_kz: 'Қайтару' },
        ],
    },
    {
        code: 'sales',
        display_order: 1400,
        name_ru: 'Продажи',
        name_kz: 'Сатулар',
        permissions: [
            { action: 'view', display_order: 10, name_ru: 'Просмотр', name_kz: 'Көру' },
            { action: 'edit', display_order: 20, name_ru: 'Редактирование', name_kz: 'Өңдеу' },
            { action: 'export', display_order: 30, name_ru: 'Экспорт', name_kz: 'Экспорт' },
        ],
    },
    {
        code: 'access',
        display_order: 1500,
        name_ru: 'Доступ',
        name_kz: 'Қол жеткізу',
        permissions: [
            { action: 'manage', display_order: 10, name_ru: 'Управление ролями и правами', name_kz: 'Рөлдер мен құқықтарды басқару' },
        ],
    },
    {
        code: 'boards',
        display_order: 1600,
        name_ru: 'Доски задач',
        name_kz: 'Тапсырмалар тақтасы',
        permissions: [
            { action: 'view', display_order: 10, name_ru: 'Просмотр', name_kz: 'Көру' },
            { action: 'create', display_order: 20, name_ru: 'Создание', name_kz: 'Құру' },
            { action: 'edit', display_order: 30, name_ru: 'Редактирование', name_kz: 'Өңдеу' },
            { action: 'delete', display_order: 40, name_ru: 'Удаление', name_kz: 'Жою' },
            { action: 'manage_members', display_order: 50, name_ru: 'Управление участниками', name_kz: 'Қатысушыларды басқару' },
            { action: 'manage_columns', display_order: 60, name_ru: 'Настройка колонок', name_kz: 'Бағандарды баптау' },
        ],
    },
    {
        code: 'tasks',
        display_order: 1700,
        name_ru: 'Задачи',
        name_kz: 'Тапсырмалар',
        permissions: [
            { action: 'view', display_order: 10, name_ru: 'Просмотр', name_kz: 'Көру' },
            { action: 'create', display_order: 20, name_ru: 'Создание', name_kz: 'Құру' },
            { action: 'edit', display_order: 30, name_ru: 'Редактирование', name_kz: 'Өңдеу' },
            { action: 'delete', display_order: 40, name_ru: 'Удаление', name_kz: 'Жою' },
            { action: 'assign', display_order: 50, name_ru: 'Назначение исполнителей', name_kz: 'Орындаушыларды тағайындау' },
            { action: 'comment', display_order: 60, name_ru: 'Комментирование', name_kz: 'Пікір қалдыру' },
            { action: 'complete', display_order: 70, name_ru: 'Закрытие задач', name_kz: 'Тапсырмаларды жабу' },
        ],
    },
    {
        code: 'assignments',
        display_order: 1800,
        name_ru: 'Задания курсов',
        name_kz: 'Курс тапсырмалары',
        permissions: [
            { action: 'view', display_order: 10, name_ru: 'Просмотр', name_kz: 'Көру' },
            { action: 'create', display_order: 20, name_ru: 'Создание', name_kz: 'Құру' },
            { action: 'edit', display_order: 30, name_ru: 'Редактирование', name_kz: 'Өңдеу' },
            { action: 'delete', display_order: 40, name_ru: 'Удаление', name_kz: 'Жою' },
            { action: 'publish', display_order: 50, name_ru: 'Публикация', name_kz: 'Жариялау' },
            { action: 'submissions_view', display_order: 60, name_ru: 'Просмотр сдач', name_kz: 'Тапсырылғандарды көру' },
            { action: 'grade', display_order: 70, name_ru: 'Проверка и оценка', name_kz: 'Тексеру және бағалау' },
        ],
    },
    {
        code: 'schedules',
        display_order: 1900,
        name_ru: 'Расписания',
        name_kz: 'Кесте',
        permissions: [
            { action: 'view', display_order: 10, name_ru: 'Просмотр', name_kz: 'Көру' },
            { action: 'create', display_order: 20, name_ru: 'Создание', name_kz: 'Құру' },
            { action: 'edit', display_order: 30, name_ru: 'Редактирование', name_kz: 'Өңдеу' },
            { action: 'delete', display_order: 40, name_ru: 'Удаление', name_kz: 'Жою' },
        ],
    },
    {
        code: 'universities',
        display_order: 2000,
        name_ru: 'Университеты',
        name_kz: 'Университеттер',
        permissions: [
            { action: 'view', display_order: 10, name_ru: 'Просмотр', name_kz: 'Көру' },
            { action: 'create', display_order: 20, name_ru: 'Создание', name_kz: 'Құру' },
            { action: 'edit', display_order: 30, name_ru: 'Редактирование', name_kz: 'Өңдеу' },
            { action: 'delete', display_order: 40, name_ru: 'Удаление', name_kz: 'Жою' },
            { action: 'import', display_order: 50, name_ru: 'Импорт', name_kz: 'Импорт' },
            { action: 'export', display_order: 60, name_ru: 'Экспорт', name_kz: 'Экспорт' },
        ],
    },
    {
        code: 'specialties',
        display_order: 2100,
        name_ru: 'Специальности',
        name_kz: 'Мамандықтар',
        permissions: [
            { action: 'view', display_order: 10, name_ru: 'Просмотр', name_kz: 'Көру' },
            { action: 'create', display_order: 20, name_ru: 'Создание', name_kz: 'Құру' },
            { action: 'edit', display_order: 30, name_ru: 'Редактирование', name_kz: 'Өңдеу' },
            { action: 'delete', display_order: 40, name_ru: 'Удаление', name_kz: 'Жою' },
            { action: 'import', display_order: 50, name_ru: 'Импорт', name_kz: 'Импорт' },
            { action: 'export', display_order: 60, name_ru: 'Экспорт', name_kz: 'Экспорт' },
        ],
    },
    {
        code: 'admission_stats',
        display_order: 2200,
        name_ru: 'Приёмные показатели',
        name_kz: 'Қабылдау көрсеткіштері',
        permissions: [
            { action: 'view', display_order: 10, name_ru: 'Просмотр', name_kz: 'Көру' },
            { action: 'edit', display_order: 20, name_ru: 'Редактирование', name_kz: 'Өңдеу' },
            { action: 'import', display_order: 30, name_ru: 'Импорт', name_kz: 'Импорт' },
            { action: 'export', display_order: 40, name_ru: 'Экспорт', name_kz: 'Экспорт' },
        ],
    },
    {
        code: 'course_access',
        display_order: 2300,
        name_ru: 'Доступы к курсам',
        name_kz: 'Курстарға қол жеткізу',
        permissions: [
            { action: 'view', display_order: 10, name_ru: 'Просмотр', name_kz: 'Көру' },
            { action: 'grant', display_order: 20, name_ru: 'Выдача доступа', name_kz: 'Қол жеткізуді беру' },
            { action: 'revoke', display_order: 30, name_ru: 'Отзыв доступа', name_kz: 'Қайтарып алу' },
            { action: 'extend', display_order: 40, name_ru: 'Продление', name_kz: 'Ұзарту' },
        ],
    },
    {
        code: 'progress_overrides',
        display_order: 2400,
        name_ru: 'Открытие уроков',
        name_kz: 'Сабақтарды ашу',
        permissions: [
            { action: 'view', display_order: 10, name_ru: 'Просмотр', name_kz: 'Көру' },
            { action: 'manage', display_order: 20, name_ru: 'Управление', name_kz: 'Басқару' },
        ],
    },
    {
        code: 'settings',
        display_order: 2500,
        name_ru: 'Настройки',
        name_kz: 'Баптаулар',
        permissions: [
            { action: 'view', display_order: 10, name_ru: 'Просмотр', name_kz: 'Көру' },
            { action: 'edit', display_order: 20, name_ru: 'Редактирование', name_kz: 'Өңдеу' },
        ],
    },
];

// -- Core roles + default grants --------------------------------------------

type SeedRole = {
    code: string;
    name: string;
    description: string;
    is_admin: boolean;
    display_order: number;
    default_grants: string[]; // permission codes
};

const CORE_ROLES: SeedRole[] = [
    {
        code: 'admin',
        name: 'Администратор',
        description: 'Полный доступ ко всем разделам админ-панели.',
        is_admin: true,
        display_order: 100,
        default_grants: [], // super-bypass: PermissionsService.can() returns true unconditionally
    },
    {
        code: 'curator',
        name: 'Куратор',
        description: 'Управляет группами и просматривает учеников; редактирует курсы.',
        is_admin: false,
        display_order: 200,
        default_grants: [
            'dashboard.view',
            'users.view',
            'users.export',
            'groups.view',
            'groups.create',
            'groups.edit',
            'groups.delete',
            'courses.view',
            'courses.edit',
            'quizzes.view',
            'quizzes.results_view',
            'assignments.view',
            'assignments.submissions_view',
            'assignments.grade',
            'files.view',
            'files.create',
            'boards.view',
            'tasks.view',
            'tasks.edit',
            'tasks.comment',
            'tasks.complete',
            'universities.view',
            'specialties.view',
            'admission_stats.view',
            'course_access.view',
            'progress_overrides.view',
        ],
    },
    {
        code: 'teacher',
        name: 'Учитель',
        description: 'Ведёт свои курсы и тесты; видит своих учеников.',
        is_admin: false,
        display_order: 300,
        default_grants: [
            'dashboard.view',
            'users.view',
            'courses.view',
            'courses.create',
            'courses.edit',
            'courses.publish',
            'quizzes.view',
            'quizzes.create',
            'quizzes.edit',
            'quizzes.publish',
            'quizzes.results_view',
            'assignments.view',
            'assignments.create',
            'assignments.edit',
            'assignments.publish',
            'assignments.submissions_view',
            'files.view',
            'files.create',
            'boards.view',
            'tasks.view',
            'tasks.comment',
            'tasks.complete',
        ],
    },
];

// -- Runner -----------------------------------------------------------------

function nowSec(): number {
    return Math.floor(Date.now() / 1000);
}

function permCode(group: SeedGroup, perm: SeedPermission): string {
    return perm.code_override ?? `${group.code}.${perm.action}`;
}

async function upsertCatalog(prune: boolean): Promise<{ touchedRoleIds: number[]; allCodes: Set<string> }> {
    const allCodes = new Set<string>();
    const groupCodes = new Set<string>();

    for (const g of CATALOG) {
        groupCodes.add(g.code);
        const group = await prisma.permissionGroup.upsert({
            where: { code: g.code },
            create: {
                code: g.code,
                name_ru: g.name_ru,
                name_kz: g.name_kz,
                display_order: g.display_order,
                created_at: nowSec(),
            },
            update: {
                name_ru: g.name_ru,
                name_kz: g.name_kz,
                display_order: g.display_order,
            },
        });

        for (const p of g.permissions) {
            const code = permCode(g, p);
            allCodes.add(code);
            await prisma.permission.upsert({
                where: { code },
                create: {
                    group_id: group.id,
                    code,
                    action: p.action,
                    name_ru: p.name_ru,
                    name_kz: p.name_kz,
                    description: p.description ?? null,
                    display_order: p.display_order,
                },
                update: {
                    group_id: group.id,
                    action: p.action,
                    name_ru: p.name_ru,
                    name_kz: p.name_kz,
                    description: p.description ?? null,
                    display_order: p.display_order,
                },
            });
        }
    }

    // Orphan handling.
    const orphans = await prisma.permission.findMany({
        where: { code: { notIn: Array.from(allCodes) } },
        select: { id: true, code: true },
    });
    const orphanCodes = orphans.map((p) => p.code);
    let touchedRoleIds: number[] = [];

    if (orphans.length > 0 && !prune) {
        console.warn(
            `[seed] WARN: ${orphans.length} orphan permission(s) in DB (not in catalog):`,
            orphanCodes,
        );
        console.warn('[seed]       Re-run with --prune to delete them and cascade-drop their grants.');
    }

    if (orphans.length > 0 && prune) {
        const orphanIds = orphans.map((p) => p.id);
        const grants = await prisma.rolePermission.findMany({
            where: { permission_id: { in: orphanIds } },
            select: { role_id: true },
            distinct: ['role_id'],
        });
        touchedRoleIds = grants.map((g) => g.role_id);
        await prisma.permission.deleteMany({ where: { id: { in: orphanIds } } });
        console.log(`[seed] PRUNED ${orphanIds.length} orphan permission(s):`, orphanCodes);
    }

    const orphanGroupRows = await prisma.permissionGroup.findMany({
        where: { code: { notIn: Array.from(groupCodes) } },
        select: { id: true, code: true },
    });
    if (orphanGroupRows.length > 0 && !prune) {
        console.warn(
            `[seed] WARN: ${orphanGroupRows.length} orphan group(s) in DB (not in catalog):`,
            orphanGroupRows.map((g) => g.code),
        );
    }
    if (orphanGroupRows.length > 0 && prune) {
        const removed = await prisma.permissionGroup.deleteMany({
            where: { code: { notIn: Array.from(groupCodes) } },
        });
        console.log(`[seed] PRUNED ${removed.count} orphan group(s)`);
    }

    return { touchedRoleIds, allCodes };
}

async function upsertCoreRoles(catalogCodes: Set<string>): Promise<number[]> {
    const touched: number[] = [];

    for (const r of CORE_ROLES) {
        const existing = await prisma.role.findUnique({ where: { code: r.code } });
        let roleId: number;
        let isFirstSeedForRole: boolean;

        if (existing) {
            await prisma.role.update({
                where: { id: existing.id },
                data: {
                    name: r.name,
                    description: r.description,
                    is_admin: r.is_admin,
                    is_system: true,
                    display_order: r.display_order,
                    updated_at: nowSec(),
                },
            });
            roleId = existing.id;
            // Apply default grants ONLY if this role has no grants at all yet (e.g. an
            // existing curator/teacher row that predates Phase 11). Once it has grants
            // — even one — we never overwrite, so manual matrix edits survive re-seed.
            const grantCount = await prisma.rolePermission.count({ where: { role_id: existing.id } });
            isFirstSeedForRole = grantCount === 0;
        } else {
            const created = await prisma.role.create({
                data: {
                    code: r.code,
                    name: r.name,
                    description: r.description,
                    is_admin: r.is_admin,
                    is_system: true,
                    display_order: r.display_order,
                    created_at: nowSec(),
                },
            });
            roleId = created.id;
            isFirstSeedForRole = true;
        }
        touched.push(roleId);

        if (r.default_grants.length === 0 || !isFirstSeedForRole) {
            console.log(
                `[seed] role '${r.code}' — ${existing ? 'updated' : 'created'}${
                    isFirstSeedForRole ? '' : '; preserved existing grants'
                }`,
            );
            continue;
        }

        const perms = await prisma.permission.findMany({
            where: { code: { in: r.default_grants } },
            select: { id: true, code: true },
        });
        const known = new Set(perms.map((p) => p.code));
        const missing = r.default_grants.filter((c) => !known.has(c));
        if (missing.length > 0) {
            console.warn(`[seed] role '${r.code}': skipping unknown codes`, missing);
        }

        await prisma.rolePermission.createMany({
            data: perms.map((p) => ({
                role_id: roleId,
                permission_id: p.id,
                granted_at: nowSec(),
                granted_by: null,
            })),
            skipDuplicates: true,
        });
        console.log(`[seed] role '${r.code}' — ${existing ? 'updated' : 'created'} with ${perms.length} default grant(s)`);

        // Sanity log — flag if any catalog code isn't grant-eligible (just a smoke for catalog/grants drift).
        void catalogCodes;
    }

    return touched;
}

async function invalidateRedis(roleIds: number[]): Promise<void> {
    if (roleIds.length === 0) return;
    const host = process.env.REDIS_HOST ?? '127.0.0.1';
    const port = parseInt(process.env.REDIS_PORT ?? '6379', 10);
    const password = process.env.REDIS_PASSWORD || undefined;
    const redis = new Redis({ host, port, password, lazyConnect: true });
    try {
        await redis.connect();
        const keys = roleIds.map((id) => `geonline-admin:perms:role:${id}`);
        await redis.del(...keys);
        await redis.incr('geonline-admin:perms:version');
        console.log(`[seed] invalidated Redis cache for ${roleIds.length} role(s)`);
    } catch (err) {
        console.warn('[seed] Redis invalidation skipped:', (err as Error).message);
    } finally {
        redis.disconnect();
    }
}

async function main() {
    const prune = process.argv.includes('--prune');
    console.log(`[seed] starting permissions seed${prune ? ' (PRUNE mode)' : ' (safe mode)'}...`);
    const { touchedRoleIds: cleanupTouched, allCodes } = await upsertCatalog(prune);
    const newlyCreated = await upsertCoreRoles(allCodes);
    await invalidateRedis(Array.from(new Set([...cleanupTouched, ...newlyCreated])));

    const groupCount = await prisma.permissionGroup.count();
    const permCount = await prisma.permission.count();
    const sysRoleCount = await prisma.role.count({ where: { is_system: true } });
    console.log(
        `[seed] done — ${groupCount} group(s), ${permCount} permission(s), ${sysRoleCount} system role(s).`,
    );
}

main()
    .catch((e) => {
        console.error('[seed] FAILED:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
