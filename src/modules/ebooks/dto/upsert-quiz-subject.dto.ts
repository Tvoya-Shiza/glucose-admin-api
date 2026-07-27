import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Phase 43 — create/rename body DTO for a subject (ТЗ 3.2.2, 6.0 — «список
 * предметов настраивается администратором»).
 *
 * Only the kz title is accepted: the whole content library is kz-only (the
 * student app ships a single locale), and books/quizzes read the kz translation.
 * Any ru rows created earlier are left untouched by a rename.
 */
export class UpsertQuizSubjectDto {
    @IsString()
    @MinLength(1)
    @MaxLength(255)
    title!: string;
}
