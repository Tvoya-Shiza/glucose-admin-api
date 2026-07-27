import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../../prisma/prisma.service';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { ExportTrainerResultsDto } from './dto/export-trainer-results.dto';
import { buildTrainerResultsWhere } from './utils/trainer-results-where';
import { pickKzTitle } from './trainers.service';

/**
 * Phase 38 — export the filtered trainer-results list to CSV or XLSX.
 *
 * Copy of the users-export pattern (src/modules/users/users-export.service.ts):
 *   - Synchronous inline export capped at MAX_ROWS (50k) rows per call.
 *   - Scope: the SAME buildTrainerResultsWhere as the list/stats endpoints —
 *     curators/teachers can only export attempts they could see in the list.
 *   - CSV: UTF-8 BOM prepended for Excel auto-detection; cells starting with
 *     `=`, `+`, `-`, `@` are apostrophe-prefixed to defuse formula evaluation
 *     (OWASP CSV-injection defense).
 *   - XLSX: built via exceljs; the controller sets the spreadsheetml Content-Type
 *     so the BigIntStringInterceptor sidesteps the binary buffer.
 *
 * Date columns («Начало» / «Завершение») are rendered as Asia/Almaty local
 * strings (YYYY-MM-DD HH:mm:ss); «Время» is мм:сс from elapsed_sec.
 */
interface TrainerResultExportRow {
    student: string;
    mobile: string;
    groups: string;
    trainer: string;
    attempt: number | string;
    score: number;
    max_score: number;
    percent: number | string;
    correct: number;
    incorrect: number;
    skipped: number;
    elapsed: string;
    started_at: string;
    finished_at: string;
}

@Injectable()
export class TrainerResultsExportService {
    /** 50k row cap. Filtered counts greater than this should be narrowed by the caller. */
    public static readonly MAX_ROWS = 50_000;

    public static readonly COLUMNS: Array<{ key: keyof TrainerResultExportRow; header: string }> = [
        { key: 'student', header: 'Студент' },
        { key: 'mobile', header: 'Телефон' },
        { key: 'groups', header: 'Группы' },
        { key: 'trainer', header: 'Тренажёр' },
        { key: 'attempt', header: 'Попытка' },
        { key: 'score', header: 'Балл' },
        { key: 'max_score', header: 'Макс. балл' },
        { key: 'percent', header: '%' },
        { key: 'correct', header: 'Верных' },
        { key: 'incorrect', header: 'Неверных' },
        { key: 'skipped', header: 'Пропущено' },
        { key: 'elapsed', header: 'Время (мм:сс)' },
        { key: 'started_at', header: 'Начало' },
        { key: 'finished_at', header: 'Завершение' },
    ];

    constructor(private readonly prisma: PrismaService) {}

    /**
     * Resolve filters + scope through buildTrainerResultsWhere and fetch up to
     * MAX_ROWS rows in the same order the list endpoint would show them.
     */
    public async fetchRows(actor: ScopeActor, dto: ExportTrainerResultsDto): Promise<TrainerResultExportRow[]> {
        const { where, shortCircuit } = await buildTrainerResultsWhere(actor, dto, this.prisma);
        if (shortCircuit) return [];

        const sort = dto.sort ?? 'started_at';
        const order: 'asc' | 'desc' = dto.order ?? 'desc';
        const orderBy: any = sort === 'score' ? { score: order } : { started_at: order };

        const raw: any[] = await this.prisma.trainerAttempt.findMany({
            where: where as any,
            orderBy: [orderBy, { id: order }],
            take: TrainerResultsExportService.MAX_ROWS,
            select: {
                attempt_number: true,
                score: true,
                max_score: true,
                correct_count: true,
                incorrect_count: true,
                skipped_count: true,
                elapsed_sec: true,
                started_at: true,
                finished_at: true,
                quiz: { select: { translations: { select: { locale: true, title: true } } } },
                user: {
                    select: {
                        full_name: true,
                        mobile: true,
                        group_users: { select: { group: { select: { name: true } } } },
                    },
                },
            },
        });

        return raw.map((r) => {
            const maxScore = Number(r.max_score ?? 0);
            const score = Number(r.score ?? 0);
            return {
                student: r.user?.full_name ?? '',
                mobile: r.user?.mobile ?? '',
                groups: ((r.user?.group_users ?? []) as any[])
                    .map((gu) => String(gu.group?.name ?? ''))
                    .filter((name) => name.length > 0)
                    .join(', '),
                trainer: pickKzTitle(r.quiz?.translations) ?? '',
                attempt: r.attempt_number == null ? '' : Number(r.attempt_number),
                score,
                max_score: maxScore,
                percent: maxScore > 0 ? Math.round((score / maxScore) * 1000) / 10 : '',
                correct: Number(r.correct_count ?? 0),
                incorrect: Number(r.incorrect_count ?? 0),
                skipped: Number(r.skipped_count ?? 0),
                elapsed: formatMmSs(Number(r.elapsed_sec ?? 0)),
                started_at: formatAlmaty(r.started_at == null ? null : Number(r.started_at)),
                finished_at: formatAlmaty(r.finished_at == null ? null : Number(r.finished_at)),
            };
        });
    }

    /**
     * Render rows to a UTF-8 (BOM-prefixed) CSV string with the OWASP
     * formula-injection defense (copy of users-export toCsv).
     */
    public toCsv(rows: TrainerResultExportRow[]): string {
        const lines: string[] = [];
        lines.push(TrainerResultsExportService.COLUMNS.map((c) => csvEscape(c.header)).join(','));
        for (const r of rows) {
            lines.push(TrainerResultsExportService.COLUMNS.map((c) => csvEscape(r[c.key] as string | number)).join(','));
        }
        // Prepend UTF-8 BOM so Excel detects encoding correctly when opening the .csv.
        return '﻿' + lines.join('\n');
    }

    /** Render rows to an XLSX Buffer via exceljs (copy of users-export toXlsx). */
    public async toXlsx(rows: TrainerResultExportRow[]): Promise<Buffer> {
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet('trainer-results');
        ws.columns = TrainerResultsExportService.COLUMNS.map((c) => ({
            header: c.header,
            key: String(c.key),
            width: 18,
        }));
        for (const r of rows) {
            ws.addRow(r);
        }
        ws.getRow(1).font = { bold: true };
        const arrBuf = await wb.xlsx.writeBuffer();
        return Buffer.from(arrBuf as ArrayBuffer);
    }
}

/** elapsed_sec → «мм:сс» (minutes are not capped at 59 — long runs read as 75:03). */
function formatMmSs(totalSec: number): string {
    const sec = Math.max(0, Math.floor(totalSec));
    const minutes = Math.floor(sec / 60);
    const seconds = sec % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// sv-SE locale renders as `YYYY-MM-DD HH:mm:ss` — combined with the Almaty
// timeZone this yields the exact contract string without manual offset math.
const ALMATY_FORMATTER = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Almaty',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
});

/** Unix seconds → 'YYYY-MM-DD HH:mm:ss' in Asia/Almaty; '' for null (unfinished). */
function formatAlmaty(unixSec: number | null): string {
    if (unixSec == null) return '';
    return ALMATY_FORMATTER.format(new Date(unixSec * 1000));
}

/** Shared CSV escape with formula-injection defense (copy of users-export csvEscape). */
function csvEscape(v: string | number | null | undefined): string {
    if (v === null || v === undefined) return '';
    let s = String(v);
    if (s.length > 0 && (s[0] === '=' || s[0] === '+' || s[0] === '-' || s[0] === '@')) {
        s = "'" + s;
    }
    if (/[",\n\r]/.test(s)) {
        return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
}
