import * as ExcelJS from 'exceljs';

/**
 * Credit («зачёт») question-bank bulk-import Excel template builder + parser.
 *
 * One data sheet «Вопросы» — the bank has a SINGLE question type (oral check), so
 * unlike the quiz importer there is one sheet, not one-per-type. The target topic
 * / lesson is chosen in the import dialog (like the quiz importer scopes to one
 * quiz), so there is NO topic column — every row lands under that one topic.
 *
 * Columns (Russian headers, KZ content — mirrors the quiz importer staff already
 * use):
 *   № | Балл | Сложность (A/B/C) | Вопрос (KZ) | Правильный ответ (KZ)
 *
 * The parser carries the REAL spreadsheet row number so the import service can
 * cite the offending row. Validation lives in the import service — this file only
 * reads cells. Cell coercion mirrors quizzes/utils/questions-excel-template.ts.
 */

export const SHEET_QUESTIONS = 'Вопросы';
export const SHEET_INSTRUCTIONS = 'Инструкция';

const COL_WIDTH = 22;

export interface ParsedCreditQuestionRow {
    /** Real spreadsheet row number (1-based, header is row 1). */
    row: number;
    /** Raw score cell text (null = empty → defaults to 1). */
    scoreRaw: string | null;
    /** Strict integer score (null when non-integer; empty defaults to 1 downstream). */
    score: number | null;
    /** Raw difficulty cell (upper-cased, trimmed). */
    difficultyRaw: string | null;
    question: string | null;
    answer: string | null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Cell coercion (mirrors quizzes/utils/questions-excel-template.ts)
// ──────────────────────────────────────────────────────────────────────────────

function cellString(v: ExcelJS.CellValue): string | null {
    if (v === null || v === undefined) return null;
    if (typeof v === 'string') {
        const trimmed = v.replace(/ /g, ' ').trim();
        return trimmed.length === 0 ? null : trimmed;
    }
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : null;
    if (typeof v === 'boolean') return v ? '1' : '0';
    if (typeof v === 'object') {
        const o: any = v;
        if (typeof o.text === 'string') return cellString(o.text);
        if (typeof o.result === 'string' || typeof o.result === 'number') return cellString(o.result);
        if (Array.isArray(o.richText)) {
            const joined = o.richText.map((p: any) => p.text ?? '').join('');
            return cellString(joined);
        }
    }
    const s = String(v).trim();
    return s.length === 0 ? null : s;
}

function parseScoreCell(v: ExcelJS.CellValue): { raw: string | null; value: number | null } {
    const raw = cellString(v);
    if (!raw) return { raw: null, value: null };
    const n = Number(raw);
    if (!Number.isFinite(n) || !Number.isInteger(n)) return { raw, value: null };
    return { raw, value: n };
}

// ──────────────────────────────────────────────────────────────────────────────
// Builder helpers
// ──────────────────────────────────────────────────────────────────────────────

function applyHeader(sheet: ExcelJS.Worksheet, headers: string[]): void {
    sheet.addRow(headers);
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.height = 24;
    headerRow.eachCell((cell) => {
        cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } };
        cell.border = { bottom: { style: 'thin', color: { argb: 'FFB6C0D2' } } };
    });
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    for (let i = 1; i <= headers.length; i++) sheet.getColumn(i).width = COL_WIDTH;
}

function addInstructionsSheet(wb: ExcelJS.Workbook): void {
    const sheet = wb.addWorksheet(SHEET_INSTRUCTIONS);
    sheet.getColumn(1).width = 120;
    const lines: string[] = [
        'Инструкция по заполнению шаблона импорта вопросов зачёта',
        '',
        'Общие правила:',
        `• Заполняйте лист «${SHEET_QUESTIONS}». Каждая строка — один вопрос.`,
        '• Тема/урок выбирается в окне импорта — все загруженные вопросы попадут в выбранную тему.',
        '• Колонка «№» — справочная, можно не заполнять. При ошибке система укажет реальный номер строки в Excel.',
        '• Полностью пустые строки игнорируются.',
        '• Текст вопроса и ответа вводится на казахском языке (KZ).',
        '• «Балл» — целое число ≥ 1. Если оставить пустым — будет 1.',
        '• «Сложность» — одна из букв: A, B, C (A — базовый, B — средний, C — повышенный).',
        '• Если строку не удалось загрузить — остальные валидные строки всё равно загрузятся.',
        '',
        'Коды ошибок:',
        '• difficulty_required — не указана сложность; difficulty_invalid — сложность не A/B/C.',
        '• question_empty — пустой текст вопроса; question_too_long — вопрос длиннее 50000 символов.',
        '• answer_empty — пустой правильный ответ; answer_too_long — ответ длиннее 50000 символов.',
        '• score_not_int — балл не целое число ≥ 1.',
        '• db_error — ошибка при сохранении в базу.',
    ];
    for (const line of lines) sheet.addRow([line]);
    sheet.getRow(1).font = { bold: true, size: 13 };
}

// ──────────────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────────────

export class CreditQuestionsExcelTemplateBuilder {
    public async buildTemplate(): Promise<Buffer> {
        const wb = new ExcelJS.Workbook();
        wb.creator = 'glucose-admin';
        wb.created = new Date();

        const sheet = wb.addWorksheet(SHEET_QUESTIONS);
        applyHeader(sheet, ['№', 'Балл', 'Сложность (A/B/C)', 'Вопрос (KZ)', 'Правильный ответ (KZ)']);
        sheet.getColumn(1).width = 8; // №
        sheet.getColumn(2).width = 10; // Балл
        sheet.getColumn(3).width = 18; // Сложность
        sheet.getColumn(4).width = 50; // Вопрос
        sheet.getColumn(5).width = 50; // Ответ

        // Difficulty dropdown A/B/C.
        ((sheet as any).dataValidations as any).add('C2:C5000', {
            type: 'list',
            allowBlank: false,
            formulae: ['"A,B,C"'],
            showErrorMessage: true,
            errorStyle: 'warning',
            errorTitle: 'Сложность',
            error: 'Выберите A, B или C',
        });

        addInstructionsSheet(wb);

        const ab = await wb.xlsx.writeBuffer();
        return Buffer.from(ab);
    }

    public async parse(buf: Buffer): Promise<ParsedCreditQuestionRow[]> {
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buf as unknown as ArrayBuffer);

        const sheet = wb.getWorksheet(SHEET_QUESTIONS);
        if (!sheet) return [];

        const out: ParsedCreditQuestionRow[] = [];
        sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
            if (rowNumber === 1) return; // header
            const score = parseScoreCell(row.getCell(2).value);
            const difficultyRaw = cellString(row.getCell(3).value);
            const question = cellString(row.getCell(4).value);
            const answer = cellString(row.getCell(5).value);
            // Skip a fully empty row (only the reference «№» filled, or nothing).
            if (!score.raw && !difficultyRaw && !question && !answer) return;
            out.push({
                row: rowNumber,
                scoreRaw: score.raw,
                score: score.value,
                difficultyRaw: difficultyRaw ? difficultyRaw.toUpperCase() : null,
                question,
                answer,
            });
        });
        return out;
    }
}
