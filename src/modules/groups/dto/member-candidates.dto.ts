import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

/**
 * GRP-08 — поиск учеников для добавления в поток.
 *
 *   GET /admin-api/v1/admin/groups/:id/member-candidates?q=...
 *
 * Зачем отдельный эндпоинт, а не общий список пользователей: `USER_SCOPE_RULES`
 * сужает выдачу куратору до людей, которые уже состоят в его потоках. Для
 * страницы «Пользователи» это правильно, но здесь получается замкнутый круг —
 * нового ученика куратор не найдёт никогда, потому что он ещё не в потоке.
 * Расширять общий скоуп нельзя: он держит весь модуль users.
 *
 * Поэтому — узкая дверь вместо снятия замка:
 *   - только ученические роли (`STUDENT_ROLE_NAMES`), сотрудники не ищутся;
 *   - запрос от MIN_QUERY_LENGTH символов, то есть перебрать базу листанием
 *     нельзя, нужно уже знать, кого ищешь;
 *   - в ответе нет email; телефон — только последние 4 цифры, чтобы различить
 *     тёзок и не выдать контакт целиком;
 *   - право `groups.edit` и та же проверка владения потоком, что у остальных
 *     мутаций (чужой куратор получает 403 до всякого поиска).
 *
 * Существующий `POST /:id/members/resolve` (импорт из Excel) и так ищет по всей
 * базе без скоупа — то есть этот эндпоинт не открывает новую поверхность, а
 * даёт ручному пути те же возможности на более строгих условиях.
 */

/** Минимальная длина запроса — защита от перебора базы через пустой поиск. */
export const MIN_QUERY_LENGTH = 3;
export const DEFAULT_CANDIDATES_LIMIT = 20;
export const MAX_CANDIDATES_LIMIT = 50;

export class MemberCandidatesQueryDto {
    @IsString()
    @MinLength(MIN_QUERY_LENGTH, { message: 'groups.candidates.query_too_short' })
    q!: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(MAX_CANDIDATES_LIMIT)
    limit?: number;
}

export class MemberCandidateDto {
    user_id!: number;
    full_name!: string | null;
    /** Последние 4 цифры телефона для различения тёзок; null, если телефона нет. */
    mobile_tail!: string | null;
    status!: 'active' | 'inactive' | 'pending';
    /** Уже в этом потоке — строка показывается, но выбрать её нельзя. */
    in_this_group!: boolean;
}

export class MemberCandidatesResultDto {
    rows!: MemberCandidateDto[];
    /** Сколько нашлось всего — чтобы показать «показаны первые N из M». */
    total!: number;
}
