import { IsString, Length } from 'class-validator';

/**
 * POST /admin-api/v1/admin/boards/:id/tasks/:tid/attachments
 *
 * Body: `{ upload_asset_id }`. The file bytes are already on disk — uploaded via
 * the Phase 5 X-Upload-Token flow before this call. This endpoint only links
 * the existing UploadAsset row to the task.
 */
export class AddTaskAttachmentDto {
    @IsString()
    @Length(26, 26)
    upload_asset_id!: string;
}
