import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Phase 39/40 — create/update body DTO for publishers. Name-only entity.
 *
 * name → Publisher.name (VarChar(255), UNIQUE). Duplicate names reject with 409
 * in the service (unique constraint `uniq_publishers_name`).
 */
export class UpsertPublisherDto {
    @IsString()
    @MinLength(1)
    @MaxLength(255)
    name!: string;
}
