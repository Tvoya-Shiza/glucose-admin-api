import * as ExcelJS from 'exceljs';

/**
 * Phase 26 — quiz-question bulk-import Excel template builder + parser.
 *
 * One sheet per question type (Russian headers; question CONTENT is entered in
 * Kazakh because the data model is KZ-only — see mapQuestionRow/readAnswer which
 * filter translations to locale === 'kz'):
 *
 *   - «Один ответ»     (single)         — N variants, one correct index.
 *   - «Множественный»  (multiple)       — N variants, list of correct indexes.
 *   - «Текстовый»      (descriptive)    — expected answer text (no answer rows).
 *   - «Соотношение»    (identificative) — ENT format: 2 prompts + 4 shared
 *                                         options, each prompt's correct option.
 *   - «Инструкция»                       — plain-text rules + error-code legend.
 *
 * The parser carries the REAL spreadsheet row number (1-based, as the operator
 * sees it) and the sheet name so the import service can cite the offending row.
 * Validation lives in the import service — this file only reads cells.
 *
 * Cell-coercion helpers (cellString / parseGradeCell) mirror
 * universities/utils/excel-template.ts (number→string, richText, formula result,
 * trim + NBSP normalize).
 */

export type ImportQuestionType = 'single' | 'multiple' | 'descriptive' | 'identificative';

export const SHEET_SINGLE = 'Один ответ';
export const SHEET_MULTIPLE = 'Множественный';
export const SHEET_DESCRIPTIVE = 'Текстовый';
export const SHEET_MATCHING = 'Соотношение';
export const SHEET_INSTRUCTIONS = 'Инструкция';
/**
 * Лист со стимульными текстами (phase-52). Отдельным листом, а не колонкой:
 * текст ҰБТ бывает на страницу, и дублировать его в каждой строке вопроса
 * значило бы просить методиста скопировать одно и то же пять раз подряд —
 * с неизбежным расхождением версий.
 */
export const SHEET_PASSAGES = 'Мәтіндер';

/** Max variant columns for single/multiple sheets. */
export const MAX_OPTIONS = 8;
/** Fixed ENT identificative layout. */
export const MATCH_PROMPT_COUNT = 2;
export const MATCH_OPTION_COUNT = 4;

const SHEET_TYPE: Record<string, ImportQuestionType> = {
    [SHEET_SINGLE]: 'single',
    [SHEET_MULTIPLE]: 'multiple',
    [SHEET_DESCRIPTIVE]: 'descriptive',
    [SHEET_MATCHING]: 'identificative',
};

const COL_WIDTH = 22;

/**
 * Parsed row — type-specific fields are populated per sheet; the rest stay
 * empty/null. The import service interprets them based on `type`.
 */
export interface ParsedQuestionRow {
    sheet: string;
    /** Real spreadsheet row number (1-based, header is row 1). */
    row: number;
    /**
     * The operator's own «№» value (column 1), when they filled it in. This is
     * what a methodologist means by "question 3" — the physical `row` above is
     * off by one from it because of the header, and differs again per sheet.
     * null = left empty, which is allowed and documented in the template.
     */
    seq: number | null;
    type: ImportQuestionType;
    /** Raw grade cell text (null = empty). */
    gradeRaw: string | null;
    /** Strict integer grade (null when empty OR not an integer). */
    grade: number | null;
    /** Название темы из справочника (phase-51). null = не заполнено. */
    topicName: string | null;
    /**
     * Идентификатор стимульного текста с листа «Мәтіндер» (phase-52).
     * Произвольная метка оператора («Т1», «текст-А»), не id из базы.
     */
    passageKey: string | null;
    title: string | null;
    description: string | null;
    // single / multiple
    /** Positional variant cells (length MAX_OPTIONS); null = empty cell. */
    options: (string | null)[];
    /** Raw "correct index(es)" cell text. */
    correctRaw: string | null;
    // descriptive
    correctText: string | null;
    // identificative (ENT)
    /** [prompt1, prompt2]. */
    prompts: (string | null)[];
    /** [A, B, C, D]. */
    matchOptions: (string | null)[];
    /** [correctForPrompt1Raw, correctForPrompt2Raw]. */
    matchCorrectRaw: (string | null)[];
}

// ──────────────────────────────────────────────────────────────────────────────
// Cell coercion
// ──────────────────────────────────────────────────────────────────────────────

function cellString(v: ExcelJS.CellValue): string | null {
    if (v === null || v === undefined) return null;
    if (typeof v === 'string') {
        const trimmed = v.replace(/ /g, ' ').trim();
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

/**
 * «№» column. Lenient on purpose — this is the operator's hand-written ordering
 * hint, not data: anything that isn't a positive integer is treated as "не
 * заполнено" and never fails the row. Note that readRow's empty-row checks
 * deliberately ignore seq, so a pre-numbered but otherwise blank template row
 * stays skipped instead of turning into an error line.
 */
function parseSeqCell(v: ExcelJS.CellValue): number | null {
    const raw = cellString(v);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : null;
}

function parseGradeCell(v: ExcelJS.CellValue): { raw: string | null; value: number | null } {
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

function addNumberValidation(sheet: ExcelJS.Worksheet, columnIndex: number, list: string): void {
    const col = sheet.getColumn(columnIndex).letter;
    ((sheet as any).dataValidations as any).add(`${col}2:${col}5000`, {
        type: 'list',
        allowBlank: true,
        formulae: [`"${list}"`],
        showErrorMessage: true,
        errorStyle: 'warning',
        errorTitle: 'Номер',
        error: `Выберите число из списка: ${list}`,
    });
}

function buildCommonLead(): string[] {
    return ['№', 'Балл', 'Тема', 'Мәтін', 'Вопрос (KZ)', 'Описание (KZ, необязательно)'];
}

function singleHeaders(correctLabel: string): string[] {
    const variants = Array.from({ length: MAX_OPTIONS }, (_, i) => `Вариант ${i + 1} (KZ)`);
    return [...buildCommonLead(), ...variants, correctLabel];
}

function matchingHeaders(): string[] {
    return [
        ...buildCommonLead(),
        'Промпт 1 (KZ)',
        'Промпт 2 (KZ)',
        'Вариант A (KZ)',
        'Вариант B (KZ)',
        'Вариант C (KZ)',
        'Вариант D (KZ)',
        'Правильный для П1 (1-4)',
        'Правильный для П2 (1-4)',
    ];
}

function styleContentColumns(sheet: ExcelJS.Worksheet, questionColIdx: number, descColIdx: number): void {
    sheet.getColumn(questionColIdx).width = 44;
    sheet.getColumn(descColIdx).width = 50;
    sheet.getColumn(1).width = 8; // №
    sheet.getColumn(2).width = 10; // Балл
    sheet.getColumn(3).width = 24; // Тема
    sheet.getColumn(4).width = 12; // Мәтін
}

function addInstructionsSheet(wb: ExcelJS.Workbook): void {
    const sheet = wb.addWorksheet(SHEET_INSTRUCTIONS);
    sheet.getColumn(1).width = 120;
    const lines: string[] = [
        'Инструкция по заполнению шаблона импорта вопросов',
        '',
        'Общие правила:',
        '• Каждый тип вопроса — на своём листе. Заполняйте только нужные листы; пустые листы можно не трогать.',
        '• Колонка «№» задаёт ПОРЯДОК вопросов в тесте — сквозной по всем листам. Например, №1 на листе «Один ответ» и №2 на листе «Соотношение» встанут именно в этом порядке.',
        '• Если «№» не заполнить, вопросы встанут в порядке листов: сначала все «Один ответ», потом «Множественный» и так далее.',
        '• Строки без «№» добавляются после пронумерованных.',
        '• Колонка «Тема» — название темы из справочника (Тесты → Тақырыптар). Должно совпадать точно; регистр не важен.',
        '• Если тема не найдена в справочнике, строка загрузится БЕЗ темы, а в отчёте появится предупреждение. Темы автоматически не создаются.',
        '• Колонку «Тема» можно не заполнять — тогда вопрос просто не попадёт в разбор по темам.',
        '',
        'Общий текст для нескольких вопросов (формат ЕНТ):',
        `• Сами тексты — на листе «${SHEET_PASSAGES}»: придумайте короткую метку («Т1»), впишите текст.`,
        '• В строках вопросов укажите ту же метку в колонке «Мәтін» — эти вопросы получат общий текст.',
        '• ВАЖНО: вопросы одного текста должны идти ПОДРЯД по колонке «№». Иначе текст будет пропадать и появляться у ученика, и загрузка не пройдёт.',
        '• Метка живёт только внутри файла и в базу не попадает.',
        '• В отчёте об ошибках показываются оба номера: ваш «№» и реальный номер строки в Excel (он на единицу больше из-за строки-шапки).',
        '• Полностью пустые строки игнорируются.',
        '• Текст вопросов и ответов вводится на казахском языке (KZ).',
        '• «Балл» — целое число ≥ 1 (обязательно).',
        '• Если строку не удалось загрузить — остальные валидные строки всё равно загрузятся.',
        '',
        `Лист «${SHEET_SINGLE}» (один правильный ответ):`,
        '• Заполните минимум 2 варианта (Вариант 1…8).',
        '• «Номер правильного варианта» — одно число (например 2), указывает на заполненный вариант.',
        '',
        `Лист «${SHEET_MULTIPLE}» (несколько правильных):`,
        '• Заполните минимум 2 варианта.',
        '• «Номера правильных вариантов» — список через ; или , (например 1;3). Минимум один.',
        '',
        `Лист «${SHEET_DESCRIPTIVE}» (текстовый ответ):`,
        '• Варианты не нужны. Заполните «Правильный ответ» — ожидаемый текст ответа.',
        '',
        `Лист «${SHEET_MATCHING}» (соотношение, формат ЕНТ):`,
        '• Формат фиксированный: 2 промпта (вопроса) слева + 4 общих варианта (A–D) справа.',
        '• Заполните «Промпт 1», «Промпт 2» и все 4 варианта A, B, C, D.',
        '• «Правильный для П1» и «Правильный для П2» — номер варианта 1–4 (1=A, 2=B, 3=C, 4=D).',
        '• Рекомендуется «Балл» = 2 (по 1 баллу за каждое верное соответствие).',
        '',
        'Коды ошибок:',
        '• grade_required — не указан балл; grade_not_int — балл не целое число ≥ 1.',
        '• question_empty — пустой текст вопроса; title_too_long — текст длиннее 2000 символов.',
        '• no_variants — меньше 2 вариантов (один/несколько ответов).',
        '• correct_required — не указан правильный вариант; correct_index_out_of_range — номер вне диапазона/пустой вариант.',
        '• single_multiple_correct — для «Один ответ» указано больше одного правильного.',
        '• multiple_no_correct — для «Множественный» не указан ни один правильный.',
        '• descriptive_answer_required — пустой «Правильный ответ»; descriptive_answer_too_long — длиннее 5000 символов.',
        '• matching_prompt_required — пустой промпт; matching_option_required — пустой вариант A–D.',
        '• matching_correct_invalid — «Правильный для П1/П2» не в диапазоне 1–4.',
        '• db_error — ошибка при сохранении в базу.',
    ];
    for (const line of lines) sheet.addRow([line]);
    sheet.getRow(1).font = { bold: true, size: 13 };
}

// ──────────────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────────────

export class QuestionsExcelTemplateBuilder {
    public async buildTemplate(): Promise<Buffer> {
        const wb = new ExcelJS.Workbook();
        wb.creator = 'glucose-admin';
        wb.created = new Date();

        // single
        const single = wb.addWorksheet(SHEET_SINGLE);
        applyHeader(single, singleHeaders('Номер правильного варианта'));
        styleContentColumns(single, 5, 6);
        addNumberValidation(single, 6 + MAX_OPTIONS + 1, '1,2,3,4,5,6,7,8');

        // multiple
        const multiple = wb.addWorksheet(SHEET_MULTIPLE);
        applyHeader(multiple, singleHeaders('Номера правильных вариантов (1;3)'));
        styleContentColumns(multiple, 5, 6);

        // descriptive
        const descriptive = wb.addWorksheet(SHEET_DESCRIPTIVE);
        applyHeader(descriptive, [...buildCommonLead(), 'Правильный ответ (KZ)']);
        styleContentColumns(descriptive, 5, 6);
        descriptive.getColumn(7).width = 50;

        // matching (ENT)
        const matching = wb.addWorksheet(SHEET_MATCHING);
        applyHeader(matching, matchingHeaders());
        styleContentColumns(matching, 5, 6);
        addNumberValidation(matching, 13, '1,2,3,4');
        addNumberValidation(matching, 14, '1,2,3,4');

        // Лист стимульных текстов (phase-52).
        const passages = wb.addWorksheet(SHEET_PASSAGES);
        applyHeader(passages, ['Мәтін (белгі)', 'Тақырып (қосымша)', 'Мәтін (KZ)']);
        passages.getColumn(1).width = 16;
        passages.getColumn(2).width = 30;
        passages.getColumn(3).width = 100;

        addInstructionsSheet(wb);

        const ab = await wb.xlsx.writeBuffer();
        return Buffer.from(ab);
    }

    /**
     * Стимульные тексты с листа «Мәтіндер»: метка оператора → содержимое.
     *
     * Метка произвольная («Т1», «текст-А») и живёт только внутри файла: связывать
     * строки вопросов с текстом по id из базы нельзя — при первом импорте этих
     * id ещё не существует.
     */
    public async parsePassages(buf: Buffer): Promise<Map<string, { title: string | null; body: string }>> {
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buf as unknown as ArrayBuffer);
        const sheet = wb.getWorksheet(SHEET_PASSAGES);
        const out = new Map<string, { title: string | null; body: string }>();
        if (!sheet) return out;

        sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
            if (rowNumber === 1) return; // шапка
            const key = cellString(row.getCell(1).value);
            const body = cellString(row.getCell(3).value);
            if (!key || !body) return;
            // Первое вхождение выигрывает: дубль метки — ошибка оператора, и
            // выбирать между версиями наугад хуже, чем стабильно брать первую.
            const normalized = key.trim().toLowerCase();
            if (!out.has(normalized)) {
                out.set(normalized, { title: cellString(row.getCell(2).value), body });
            }
        });
        return out;
    }

    public async parse(buf: Buffer): Promise<ParsedQuestionRow[]> {
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buf as unknown as ArrayBuffer);

        const out: ParsedQuestionRow[] = [];
        for (const [sheetName, type] of Object.entries(SHEET_TYPE)) {
            const sheet = wb.getWorksheet(sheetName);
            if (!sheet) continue; // operator may have removed/renamed unused sheets
            sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
                if (rowNumber === 1) return; // header
                const parsed = this.readRow(sheetName, type, row, rowNumber);
                if (parsed) out.push(parsed);
            });
        }
        return out;
    }

    private readRow(
        sheet: string,
        type: ImportQuestionType,
        row: ExcelJS.Row,
        rowNumber: number,
    ): ParsedQuestionRow | null {
        const seq = parseSeqCell(row.getCell(1).value);
        const grade = parseGradeCell(row.getCell(2).value);
        const topicName = cellString(row.getCell(3).value);
        const passageKey = cellString(row.getCell(4).value);
        const title = cellString(row.getCell(5).value);
        const description = cellString(row.getCell(6).value);

        const base: ParsedQuestionRow = {
            sheet,
            row: rowNumber,
            seq,
            type,
            gradeRaw: grade.raw,
            grade: grade.value,
            topicName,
            passageKey,
            title,
            description,
            options: [],
            correctRaw: null,
            correctText: null,
            prompts: [],
            matchOptions: [],
            matchCorrectRaw: [],
        };

        if (type === 'single' || type === 'multiple') {
            const options: (string | null)[] = [];
            for (let i = 0; i < MAX_OPTIONS; i++) options.push(cellString(row.getCell(7 + i).value));
            base.options = options;
            base.correctRaw = cellString(row.getCell(7 + MAX_OPTIONS).value);
            if (!title && !grade.raw && options.every((o) => o == null) && !base.correctRaw) return null;
            return base;
        }

        if (type === 'descriptive') {
            base.correctText = cellString(row.getCell(7).value);
            if (!title && !grade.raw && !base.correctText) return null;
            return base;
        }

        // identificative (ENT): cols 5,6 prompts; 7-10 options A-D; 11,12 correct
        base.prompts = [cellString(row.getCell(7).value), cellString(row.getCell(8).value)];
        base.matchOptions = [
            cellString(row.getCell(9).value),
            cellString(row.getCell(10).value),
            cellString(row.getCell(11).value),
            cellString(row.getCell(12).value),
        ];
        base.matchCorrectRaw = [cellString(row.getCell(13).value), cellString(row.getCell(14).value)];
        const matchEmpty =
            base.prompts.every((p) => p == null) &&
            base.matchOptions.every((o) => o == null) &&
            base.matchCorrectRaw.every((c) => c == null);
        if (!title && !grade.raw && matchEmpty) return null;
        return base;
    }
}
