import { IsIn } from 'class-validator';

/**
 * Phase 39/40 — body DTO for PATCH /admin-api/v1/admin/ebooks/:id/publish.
 *
 * status maps directly onto Book.status (BookStatus enum):
 *   'active'   → student-visible (catalog + reader). REFUSED (409 ebooks.publish_blocked)
 *               while page_count = 0 (an empty book must never reach students).
 *   'inactive' → hidden from students.
 *   'draft'    → work-in-progress, hidden.
 *
 * On a transition INTO 'active' the service enqueues a Postgres search reindex
 * (fire-and-forget, after the MySQL write commits).
 */
export class PublishBookDto {
    @IsIn(['active', 'inactive', 'draft'])
    status!: 'active' | 'inactive' | 'draft';
}
