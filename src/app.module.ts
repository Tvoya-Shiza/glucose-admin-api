// smoke import — proves @shared alias resolves at build time.
// Remove this comment + import once a feature module legitimately uses RoleName.
import type { RoleName } from '@shared/roles';
type _UnusedRoleNameSmoke = RoleName;

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuditInterceptor } from './common/audit/audit.interceptor';
import { CronLockModule } from './common/decorators/cron-lock.module';
import { configuration } from './config/configuration';
import { validateEnv } from './config/env.validation';
import { AccessModule } from './modules/access/access.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { AudienceModule } from './modules/audience/audience.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { BannersModule } from './modules/banners/banners.module';
import { BlogsModule } from './modules/blogs/blogs.module';
import { BoardsModule } from './modules/boards/boards.module';
import { CourseAccessModule } from './modules/course-access/course-access.module';
import { CoursesModule } from './modules/courses/courses.module';
import { GroupsModule } from './modules/groups/groups.module';
import { HealthModule } from './modules/health/health.module';
import { MailingsModule } from './modules/mailings/mailings.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { ProgressOverridesModule } from './modules/progress-overrides/progress-overrides.module';
import { PromocodesModule } from './modules/promocodes/promocodes.module';
import { PushModule } from './modules/push/push.module';
import { AssignmentsModule } from './modules/assignments/assignments.module';
import { SchedulesModule } from './modules/schedules/schedules.module';
import { QuizzesModule } from './modules/quizzes/quizzes.module';
import { RedisModule } from './modules/redis/redis.module';
import { SalesModule } from './modules/sales/sales.module';
import { StoriesModule } from './modules/stories/stories.module';
import { RewardsModule } from './modules/rewards/rewards.module';
import { UniversitiesModule } from './modules/universities/universities.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { UsersModule } from './modules/users/users.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            load: [configuration],
            validate: validateEnv,
        }),
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
        // Phase 8 Plan 04 — ScheduleModule enables @Cron handlers; CronLockModule
        // provides CronLockService for @CronLock(name, ttl) cluster-mode locking.
        // CronLockModule is @Global so cron-host services only inject CronLockService
        // (public readonly cronLock) — see push-cron.service.ts.
        ScheduleModule.forRoot(),
        PrismaModule,
        RedisModule,
        CronLockModule,
        AuthModule,
        // Phase 11 — RBAC (roles + permissions matrix). AccessModule exports
        // PermissionsService so AuthController.me can list effective permissions
        // and the global PermissionGuard can inject it.
        AccessModule,
        HealthModule,
        UsersModule,
        GroupsModule,
        CoursesModule,
        // Phase 5+ — uploads extracted from CoursesModule. Owns POST /token,
        // POST /file, GET /uploads, DELETE /uploads/:id.
        UploadsModule,
        QuizzesModule,
        AssignmentsModule,
        // Phase 15 — Lesson schedules (calendar of curator+group events).
        SchedulesModule,
        // Phase 7 — marketing surfaces (admin-only per D-20; empty skeletons in Plan 01,
        // controllers + services land in Plans 02-05).
        StoriesModule,
        BannersModule,
        BlogsModule,
        PromocodesModule,
        // Phase 8 — push notifications + mailings (admin-only per D-19;
        // module skeletons + service providers in Plan 01; controllers land
        // in Plans 03-05).
        // Plan 02 — AudienceModule is @Global() so PushModule + MailingsModule
        // get AudienceService injected without explicit imports.
        AudienceModule,
        PushModule,
        MailingsModule,
        // Phase 9 — payments + sales + analytics (admin-only payments+sales per
        // D-18 + D-20; analytics is role-scoped per D-19 with per-endpoint actor
        // narrowing). Module skeletons + scope rules + cache namespaces in
        // Plan 01; controllers + services land in Plans 02 (payments), 03
        // (sales), 04 (analytics).
        PaymentsModule,
        SalesModule,
        AnalyticsModule,
        // Phase 10 Plan 01 — audit-read surface (AUD-01 / AUD-02 / AUD-03). Three GETs
        // under /admin-api/v1/admin/audit; admin sees all rows, curator/teacher narrow
        // to their own actor_id (D-02 + D-24, server-enforced via AUDIT_READ_SCOPE_RULES).
        AuditModule,
        // Phase 12 — kanban boards (mini-Trello). RBAC via `boards.*` / `tasks.*`
        // permission groups; per-board data scope via kanban_board_members.
        // NotificationsModule is @Global so it must be imported before any
        // feature module that emits notifications.
        NotificationsModule,
        BoardsModule,
        // Phase 17 — Universities & Specialties catalog. Three sub-domains share one
        // module: universities (vuz), specialties (directory), university_specialties
        // (M-M links), admission_stats (per-link, per-year).
        UniversitiesModule,
        // Phase 18 — Group → Course access (Feature A) + per-course Accessors list
        // (Feature C). Skeleton in PR-2 (single _status stub returning 501);
        // full surface lands in PR-3 / PR-5.
        CourseAccessModule,
        // Phase 18 — Per-item content unlock overrides (Feature B1, "Контроль
        // прогресса"). Skeleton in PR-2; full CRUD lands in PR-6.
        ProgressOverridesModule,
        // Phase 25 — Reward rules admin CRUD (GET /rewards/rules, PATCH /rewards/rules/:type).
        RewardsModule,
    ],
    controllers: [AppController],
    providers: [
        AppService,
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        // PermissionGuard is applied controller-locally via @UseGuards so it runs
        // AFTER JwtGuard fills req.user (global guards run before controller-level,
        // which left req.user undefined and tripped the 'unauthenticated' branch).
        // AuditInterceptor runs after ThrottlerGuard so throttled requests are
        // never audited (they're 429 before reaching the handler).
        { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    ],
})
export class AppModule {}
