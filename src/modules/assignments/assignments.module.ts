import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { AssignmentsListController } from './assignments-list.controller';
import { AssignmentsListService } from './assignments-list.service';
import { AssignmentsMutationsController } from './assignments-mutations.controller';
import { AssignmentsMutationsService } from './assignments-mutations.service';
import { AssignmentsSubmissionFilesController } from './assignments-submission-files.controller';
import { AssignmentsSubmissionFilesService } from './assignments-submission-files.service';
import { AssignmentsSubmissionsController } from './assignments-submissions.controller';
import { AssignmentsSubmissionsService } from './assignments-submissions.service';

/**
 * AssignmentsModule — course-assignment (Тапсырма) admin surface.
 *
 * Mirrors QuizzesModule's shape but leaner (no cache layer / duplicate / question
 * sub-resource — assignments have a flatter structure).
 *
 * Controllers route order matters: AssignmentsListController has `:id` and
 * `:id/analytics`. Nest matches `/analytics` first (static segment beats param).
 * AssignmentsSubmissionsController is mounted at `/:assignmentId/submissions`
 * so it does not collide with the parent surface.
 */
@Module({
    imports: [AccessModule],
    controllers: [
        AssignmentsListController,
        AssignmentsMutationsController,
        AssignmentsSubmissionsController,
        AssignmentsSubmissionFilesController,
    ],
    providers: [
        AssignmentsListService,
        AssignmentsMutationsService,
        AssignmentsSubmissionsService,
        AssignmentsSubmissionFilesService,
    ],
    exports: [],
})
export class AssignmentsModule {}
