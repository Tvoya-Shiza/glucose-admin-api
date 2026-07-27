import { IsIn } from 'class-validator';
import type { TrainerPublishStatus } from './list-trainers.dto';

/**
 * Phase 38 — body DTO for PATCH /admin-api/v1/admin/trainers/:id/publish.
 *
 * publish_status maps onto Quizzes.status (phase-38 MANUAL reuse decision —
 * trainer_settings has NO publish_status column):
 *   'public' → quizzes.status='active'  (student catalog + access checks pass)
 *   'hidden' → quizzes.status='inactive' (student side locks with reason 'hidden')
 *
 * 'public' is REFUSED (409 trainers.publish_blocked) while the trainer has zero
 * runnable questions (single/multiple) or zero linked courses — the service gate
 * mirrors the student-side no_questions / not_configured dead-ends.
 */
export class PublishTrainerDto {
    @IsIn(['hidden', 'public'])
    publish_status!: TrainerPublishStatus;
}
