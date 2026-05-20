import { IsIn, IsString, MaxLength } from 'class-validator';

/**
 * Bilingual translation for WebinarAssignmentTranslation.
 * Locales are 'ru' and 'kz' (matching admin-client URL convention and
 * existing translations across the project).
 */
export class AssignmentTranslationDto {
    @IsIn(['ru', 'kz'])
    locale!: 'ru' | 'kz';

    @IsString()
    @MaxLength(255)
    title!: string;

    @IsString()
    @MaxLength(8000)
    description!: string;
}
