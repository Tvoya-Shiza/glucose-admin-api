import * as ExcelJS from 'exceljs';

/**
 * Phase 17 — Excel template + import builder.
 *
 * Generates Workbook buffers for three templates (universities / specialties /
 * admission_stats), each carrying:
 *   - a `Data` sheet (headers in row 1, optionally pre-filled rows)
 *   - reference sheets (Cities / Universities / Specialties) feeding cell
 *     `dataValidation` list dropdowns so the operator can pick valid IDs
 *     without copy-pasting.
 *
 * Header rows are bold + frozen. Reference IDs use UNSIGNED INT (Region.id /
 * University.id) and codes (Specialty.code).
 *
 * Parser converts a Data-sheet upload into typed rows; row-level errors are
 * surfaced via the returned `errors[]` so the import service can classify
 * each row independently.
 */

export interface CityRef {
    id: number;
    title_kk: string;
}

export interface UniversityRef {
    id: number;
    unik: string;
    title_kk: string;
}

export interface SpecialtyRef {
    code: string;
    title_kk: string;
}

const COL_WIDTH = 22;

function colLetter(idx1: number): string {
    // 1 -> A, 26 -> Z, 27 -> AA, ...
    let n = idx1;
    let out = '';
    while (n > 0) {
        const rem = (n - 1) % 26;
        out = String.fromCharCode(65 + rem) + out;
        n = Math.floor((n - 1) / 26);
    }
    return out;
}

function applyHeader(sheet: ExcelJS.Worksheet, headers: string[]): void {
    sheet.addRow(headers);
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.height = 22;
    headerRow.eachCell((cell) => {
        cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
        cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE8EEF7' },
        };
        cell.border = {
            bottom: { style: 'thin', color: { argb: 'FFB6C0D2' } },
        };
    });
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    for (let i = 1; i <= headers.length; i++) {
        sheet.getColumn(i).width = COL_WIDTH;
    }
}

function addCitiesSheet(wb: ExcelJS.Workbook, cities: CityRef[]): { lastRow: number } {
    const sheet = wb.addWorksheet('Cities');
    applyHeader(sheet, ['НАЗВАНИЕ KK', 'ID']);
    for (const c of cities) sheet.addRow([c.title_kk, c.id]);
    sheet.getColumn(1).width = 40;
    sheet.getColumn(2).width = 12;
    return { lastRow: 1 + cities.length };
}

function addUniversitiesSheet(wb: ExcelJS.Workbook, universities: UniversityRef[]): { lastRow: number } {
    const sheet = wb.addWorksheet('Universities');
    applyHeader(sheet, ['КОД УНИК', 'НАЗВАНИЕ KK', 'ID']);
    for (const u of universities) sheet.addRow([u.unik, u.title_kk, u.id]);
    sheet.getColumn(1).width = 24;
    sheet.getColumn(2).width = 40;
    sheet.getColumn(3).width = 12;
    return { lastRow: 1 + universities.length };
}

function addSpecialtiesSheet(wb: ExcelJS.Workbook, specialties: SpecialtyRef[]): { lastRow: number } {
    const sheet = wb.addWorksheet('Specialties');
    applyHeader(sheet, ['КОД', 'НАЗВАНИЕ KK']);
    for (const s of specialties) sheet.addRow([s.code, s.title_kk]);
    sheet.getColumn(1).width = 18;
    sheet.getColumn(2).width = 40;
    return { lastRow: 1 + specialties.length };
}

function addListValidation(
    sheet: ExcelJS.Worksheet,
    columnLetter: string,
    refSheet: string,
    refColumn: string,
    refLastRow: number,
    errorTitle: string,
    errorMessage: string,
    allowBlank = true,
): void {
    const start = `${columnLetter}2`;
    const end = `${columnLetter}5000`;
    // ExcelJS API: dataValidations.add(range, options).
    // Note: formulae uses absolute references to the named sheet+column range.
    ((sheet as any).dataValidations as any).add(`${start}:${end}`, {
        type: 'list',
        allowBlank,
        formulae: [`=${refSheet}!$${refColumn}$2:$${refColumn}$${Math.max(refLastRow, 2)}`],
        showErrorMessage: true,
        errorStyle: 'warning',
        errorTitle,
        error: errorMessage,
    });
}

function addYesNoValidation(sheet: ExcelJS.Worksheet, columnLetter: string): void {
    ((sheet as any).dataValidations as any).add(`${columnLetter}2:${columnLetter}5000`, {
        type: 'list',
        allowBlank: true,
        formulae: ['"Ия,Жок"'],
        showErrorMessage: true,
        errorStyle: 'warning',
        errorTitle: 'Тек "Ия" немесе "Жок"',
        error: 'Тек "Ия" немесе "Жок" мәндерін таңдаңыз',
    });
}

// ----- builders -----

const UNIVERSITIES_HEADERS = [
    'КОД УНИК',
    'ГОРОД',
    'ВЕБ-САЙТ',
    'ТЕЛЕФОН',
    'EMAIL',
    'INSTAGRAM',
    'АДРЕС',
    'ОБЩЕЖИТИЕ',
    'ВОЕННАЯ КАФЕДРА',
    'НАЗВАНИЕ KK',
    'КРАТКОЕ ОПИСАНИЕ KK',
    'ПОЛНОЕ ОПИСАНИЕ KK',
];

const SPECIALTIES_HEADERS = [
    'КОД СПЕЦИАЛЬНОСТИ',
    'НАЗВАНИЕ KK',
    'КОД УНИК (УНИВЕРСИТЕТ)',
    'ЕСТЬ СЕЛЬСКАЯ КВОТА',
    'КРАТКОЕ ОПИСАНИЕ KK',
    'ПОЛНОЕ ОПИСАНИЕ KK',
];

const ADMISSION_HEADERS = [
    'КОД УНИК (УНИВЕРСИТЕТ)',
    'КОД СПЕЦИАЛЬНОСТИ',
    'ГОД',
    'ГРАНТЫ',
    'ПОРОГ',
    'ПОРОГ КВОТА',
];

export interface UniversityDataRow {
    unik?: string;
    /** City name in KK (resolved to city_id by the import service). */
    city_name?: string | null;
    website?: string | null;
    phone?: string | null;
    email?: string | null;
    instagram?: string | null;
    address?: string | null;
    has_dormitory?: boolean | null;
    has_military_department?: boolean | null;
    title_kk?: string | null;
    short_desc_kk?: string | null;
    full_desc_kk?: string | null;
}

export interface SpecialtyDataRow {
    code?: string;
    title_kk?: string;
    /** University UNIK code (resolved to university_id by the import service). */
    university_unik?: string;
    has_rural_quota?: boolean | null;
    short_desc_kk?: string | null;
    full_desc_kk?: string | null;
}

export interface AdmissionDataRow {
    /** University UNIK code (resolved to university_id by the import service). */
    university_unik?: string;
    specialty_code?: string;
    year?: number;
    grants_count?: number | null;
    threshold?: number | null;
    threshold_rural?: number | null;
}

export interface ParsedRow<T> {
    row_index: number; // 1-based index of the data row (excluding header)
    data: T;
}

export interface ParseError {
    row_index: number;
    field?: string;
    message: string;
}

// ----- helpers for parsing cell values -----

function cellString(v: ExcelJS.CellValue): string | null {
    if (v === null || v === undefined) return null;
    if (typeof v === 'string') {
        const trimmed = v.trim();
        return trimmed.length === 0 ? null : trimmed;
    }
    if (typeof v === 'number') return String(v).trim();
    if (typeof v === 'boolean') return v ? 'Ия' : 'Жок';
    // ExcelJS hyperlink: { text, hyperlink }
    if (typeof v === 'object') {
        const o: any = v;
        if (typeof o.text === 'string') return o.text.trim() || null;
        if (typeof o.result === 'string') return o.result.trim() || null;
        if (typeof o.richText === 'object' && Array.isArray(o.richText)) {
            const joined = o.richText.map((p: any) => p.text ?? '').join('').trim();
            return joined.length === 0 ? null : joined;
        }
    }
    return String(v).trim() || null;
}

function cellInt(v: ExcelJS.CellValue): number | null {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
    const s = cellString(v);
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? Math.trunc(n) : null;
}

function cellYesNo(v: ExcelJS.CellValue): boolean | null {
    const s = cellString(v);
    if (!s) return null;
    const lower = s.toLowerCase();
    if (lower === 'ия' || lower === 'иа' || lower === 'yes' || lower === 'true' || lower === '1') return true;
    if (lower === 'жок' || lower === 'жоқ' || lower === 'no' || lower === 'false' || lower === '0') return false;
    return null;
}

// ----- public API -----

export class ExcelTemplateBuilder {
    public buildUniversitiesTemplate(opts: {
        cities: CityRef[];
        rows?: UniversityDataRow[];
    }): Promise<Buffer> {
        const wb = new ExcelJS.Workbook();
        wb.creator = 'glucose-admin';
        wb.created = new Date();

        const data = wb.addWorksheet('Data');
        applyHeader(data, UNIVERSITIES_HEADERS);
        for (const r of opts.rows ?? []) {
            data.addRow([
                r.unik ?? '',
                r.city_name ?? '',
                r.website ?? '',
                r.phone ?? '',
                r.email ?? '',
                r.instagram ?? '',
                r.address ?? '',
                r.has_dormitory === null || r.has_dormitory === undefined ? '' : r.has_dormitory ? 'Ия' : 'Жок',
                r.has_military_department === null || r.has_military_department === undefined
                    ? ''
                    : r.has_military_department
                      ? 'Ия'
                      : 'Жок',
                r.title_kk ?? '',
                r.short_desc_kk ?? '',
                r.full_desc_kk ?? '',
            ]);
        }

        // Wider for description columns.
        data.getColumn(10).width = 40; // title
        data.getColumn(11).width = 60; // short
        data.getColumn(12).width = 80; // full

        const { lastRow: citiesLastRow } = addCitiesSheet(wb, opts.cities);
        // Cities sheet column A = НАЗВАНИЕ KK (the value the operator picks);
        // import service resolves it to city_id by exact title_kk match.
        addListValidation(
            data,
            colLetter(2),
            'Cities',
            'A',
            citiesLastRow,
            'Қала',
            'Cities парағындағы қаланың бірін таңдаңыз',
        );
        addYesNoValidation(data, colLetter(8));
        addYesNoValidation(data, colLetter(9));

        return wb.xlsx.writeBuffer().then((ab) => Buffer.from(ab));
    }

    public buildSpecialtiesTemplate(opts: {
        universities: UniversityRef[];
        rows?: SpecialtyDataRow[];
    }): Promise<Buffer> {
        const wb = new ExcelJS.Workbook();
        wb.creator = 'glucose-admin';
        wb.created = new Date();

        const data = wb.addWorksheet('Data');
        applyHeader(data, SPECIALTIES_HEADERS);
        for (const r of opts.rows ?? []) {
            data.addRow([
                r.code ?? '',
                r.title_kk ?? '',
                r.university_unik ?? '',
                r.has_rural_quota === null || r.has_rural_quota === undefined ? '' : r.has_rural_quota ? 'Ия' : 'Жок',
                r.short_desc_kk ?? '',
                r.full_desc_kk ?? '',
            ]);
        }
        data.getColumn(2).width = 40;
        data.getColumn(5).width = 60;
        data.getColumn(6).width = 80;

        const { lastRow: universitiesLastRow } = addUniversitiesSheet(wb, opts.universities);
        // Universities sheet column A = КОД УНИК (operator picks the code);
        // import service resolves it to university_id by unik match.
        addListValidation(
            data,
            colLetter(3),
            'Universities',
            'A',
            universitiesLastRow,
            'Университет коды',
            'Universities парағындағы УНИК кодтарының бірін таңдаңыз',
            false,
        );
        addYesNoValidation(data, colLetter(4));

        return wb.xlsx.writeBuffer().then((ab) => Buffer.from(ab));
    }

    public buildAdmissionStatsTemplate(opts: {
        universities: UniversityRef[];
        specialties: SpecialtyRef[];
        rows?: AdmissionDataRow[];
    }): Promise<Buffer> {
        const wb = new ExcelJS.Workbook();
        wb.creator = 'glucose-admin';
        wb.created = new Date();

        const data = wb.addWorksheet('Data');
        applyHeader(data, ADMISSION_HEADERS);
        for (const r of opts.rows ?? []) {
            data.addRow([
                r.university_unik ?? '',
                r.specialty_code ?? '',
                r.year ?? null,
                r.grants_count ?? null,
                r.threshold ?? null,
                r.threshold_rural ?? null,
            ]);
        }

        const { lastRow: universitiesLastRow } = addUniversitiesSheet(wb, opts.universities);
        const { lastRow: specialtiesLastRow } = addSpecialtiesSheet(wb, opts.specialties);

        addListValidation(
            data,
            colLetter(1),
            'Universities',
            'A',
            universitiesLastRow,
            'Университет коды',
            'Universities парағындағы УНИК кодын таңдаңыз',
            false,
        );
        addListValidation(
            data,
            colLetter(2),
            'Specialties',
            'A',
            specialtiesLastRow,
            'Мамандық коды',
            'Specialties парағындағы кодты таңдаңыз',
            false,
        );

        // Year dropdown: 2021..current_year+1.
        const currentYear = new Date().getFullYear();
        const years: string[] = [];
        for (let y = 2021; y <= currentYear + 1; y++) years.push(String(y));
        ((data as any).dataValidations as any).add(`${colLetter(3)}2:${colLetter(3)}5000`, {
            type: 'list',
            allowBlank: false,
            formulae: [`"${years.join(',')}"`],
            showErrorMessage: true,
            errorStyle: 'warning',
            errorTitle: 'Год',
            error: 'Жыл 2021-ден ағымдағыдан +1-ге дейінгі диапазонда болуы керек',
        });

        return wb.xlsx.writeBuffer().then((ab) => Buffer.from(ab));
    }

    // ----- parsers -----

    public async parseUniversities(buf: Buffer): Promise<{ rows: ParsedRow<UniversityDataRow>[]; errors: ParseError[] }> {
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buf as unknown as ArrayBuffer);
        const sheet = wb.getWorksheet('Data') ?? wb.worksheets[0];
        if (!sheet) return { rows: [], errors: [{ row_index: 0, message: 'no_data_sheet' }] };

        const rows: ParsedRow<UniversityDataRow>[] = [];
        const errors: ParseError[] = [];

        sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
            if (rowNumber === 1) return; // header
            const r: UniversityDataRow = {
                unik: cellString(row.getCell(1).value) ?? undefined,
                city_name: cellString(row.getCell(2).value),
                website: cellString(row.getCell(3).value),
                phone: cellString(row.getCell(4).value),
                email: cellString(row.getCell(5).value),
                instagram: cellString(row.getCell(6).value),
                address: cellString(row.getCell(7).value),
                has_dormitory: cellYesNo(row.getCell(8).value),
                has_military_department: cellYesNo(row.getCell(9).value),
                title_kk: cellString(row.getCell(10).value),
                short_desc_kk: cellString(row.getCell(11).value),
                full_desc_kk: cellString(row.getCell(12).value),
            };
            // Skip blank rows entirely (no unik AND no title — likely a stray new row from Excel)
            if (!r.unik && !r.title_kk) return;
            rows.push({ row_index: rowNumber - 1, data: r });
        });

        return { rows, errors };
    }

    public async parseSpecialties(buf: Buffer): Promise<{ rows: ParsedRow<SpecialtyDataRow>[]; errors: ParseError[] }> {
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buf as unknown as ArrayBuffer);
        const sheet = wb.getWorksheet('Data') ?? wb.worksheets[0];
        if (!sheet) return { rows: [], errors: [{ row_index: 0, message: 'no_data_sheet' }] };

        const rows: ParsedRow<SpecialtyDataRow>[] = [];
        const errors: ParseError[] = [];

        sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
            if (rowNumber === 1) return;
            const r: SpecialtyDataRow = {
                code: cellString(row.getCell(1).value) ?? undefined,
                title_kk: cellString(row.getCell(2).value) ?? undefined,
                university_unik: cellString(row.getCell(3).value) ?? undefined,
                has_rural_quota: cellYesNo(row.getCell(4).value),
                short_desc_kk: cellString(row.getCell(5).value),
                full_desc_kk: cellString(row.getCell(6).value),
            };
            if (!r.code && !r.title_kk && !r.university_unik) return;
            rows.push({ row_index: rowNumber - 1, data: r });
        });

        return { rows, errors };
    }

    public async parseAdmissionStats(buf: Buffer): Promise<{ rows: ParsedRow<AdmissionDataRow>[]; errors: ParseError[] }> {
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buf as unknown as ArrayBuffer);
        const sheet = wb.getWorksheet('Data') ?? wb.worksheets[0];
        if (!sheet) return { rows: [], errors: [{ row_index: 0, message: 'no_data_sheet' }] };

        const rows: ParsedRow<AdmissionDataRow>[] = [];
        const errors: ParseError[] = [];

        sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
            if (rowNumber === 1) return;
            const r: AdmissionDataRow = {
                university_unik: cellString(row.getCell(1).value) ?? undefined,
                specialty_code: cellString(row.getCell(2).value) ?? undefined,
                year: cellInt(row.getCell(3).value) ?? undefined,
                grants_count: cellInt(row.getCell(4).value),
                threshold: cellInt(row.getCell(5).value),
                threshold_rural: cellInt(row.getCell(6).value),
            };
            if (!r.university_unik && !r.specialty_code && !r.year) return;
            rows.push({ row_index: rowNumber - 1, data: r });
        });

        return { rows, errors };
    }
}
