/**
 * D-13: POST /admin-api/v1/admin/groups/:id/cascade-preview — dry-run that returns
 * affected entities BEFORE delete/deactivate.
 *
 * No input DTO — id is a path param, no body required.
 *
 * affected_schedules:
 *   - Always 0 in Phase 4 (WebinarChapterSchedule UI lands in Phase 5 per D-13).
 *   - affected_schedules_note carries the explanatory string when count is 0.
 */
export class CascadePreviewResponseDto {
    affected_students!: number;
    sample_student_names!: string[]; // first 5 names (full_name from User)
    affected_schedules!: number; // always 0 in Phase 4 — Phase 5 owns WebinarChapterSchedule UI
    affected_schedules_note!: string | null; // 'WebinarChapterSchedule UI lands in Phase 5' when affected_schedules === 0
}
