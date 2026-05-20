/**
 * One-shot dumper: reads `regions` + `region_translations` from a legacy
 * `geonline_test`-style MySQL database and writes the snapshot to
 * `prisma/seeds/data/regions.json`. The companion seed script
 * (`prisma/seeds/regions.seed.ts`) then upserts that JSON into the
 * glucose schema, preserving original IDs so `universities.city_id`
 * (Phase 17) keeps stable references across environments.
 *
 *   npm run dump:regions
 *
 * Env (all optional except creds — has 127.0.0.1:3306 / geonline_test defaults):
 *   GEONLINE_DB_HOST     (default 127.0.0.1)
 *   GEONLINE_DB_PORT     (default 3306)
 *   GEONLINE_DB_USER     (required)
 *   GEONLINE_DB_PASSWORD (required, may be empty string)
 *   GEONLINE_DB_NAME     (default geonline_test)
 *
 * READ-ONLY. Only SELECT statements are issued; nothing is written back to
 * the source DB. Safe to run repeatedly — the output JSON is overwritten.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as mysql from 'mysql2/promise';

interface SourceRegion {
    id: number;
    country_id: number | null;
    province_id: number | null;
    city_id: number | null;
    district_id: number | null;
    type: 'country' | 'province' | 'city' | 'district' | 'place_of_study';
    created_at: number;
}

interface SourceTranslation {
    id: number;
    region_id: number;
    locale: string | null;
    title: string | null;
}

interface DumpFile {
    dumped_at: number;
    source_host: string;
    source_db: string;
    regions: SourceRegion[];
    translations: SourceTranslation[];
}

function readEnvOrDie(key: string, fallback?: string): string {
    const v = process.env[key];
    if (v !== undefined) return v;
    if (fallback !== undefined) return fallback;
    console.error(`Missing required env var: ${key}`);
    process.exit(1);
}

async function main(): Promise<void> {
    const host = readEnvOrDie('GEONLINE_DB_HOST', '127.0.0.1');
    const port = Number(readEnvOrDie('GEONLINE_DB_PORT', '3306'));
    const user = readEnvOrDie('GEONLINE_DB_USER');
    const password = readEnvOrDie('GEONLINE_DB_PASSWORD', '');
    const database = readEnvOrDie('GEONLINE_DB_NAME', 'geonline_test');

    console.log(`Connecting to ${user}@${host}:${port}/${database} (read-only)...`);

    const conn = await mysql.createConnection({
        host,
        port,
        user,
        password,
        database,
        // Force consistent decoding — region_translations historically uses utf8mb3.
        charset: 'utf8mb4',
    });

    try {
        const [regionRows] = await conn.execute<mysql.RowDataPacket[]>(
            `SELECT id, country_id, province_id, city_id, district_id, type,
                    CAST(created_at AS UNSIGNED) AS created_at
             FROM regions
             ORDER BY id ASC`,
        );

        const [translationRows] = await conn.execute<mysql.RowDataPacket[]>(
            `SELECT id, region_id, locale, title
             FROM region_translations
             ORDER BY id ASC`,
        );

        const regions: SourceRegion[] = regionRows.map((r) => ({
            id: Number(r.id),
            country_id: r.country_id === null ? null : Number(r.country_id),
            province_id: r.province_id === null ? null : Number(r.province_id),
            city_id: r.city_id === null ? null : Number(r.city_id),
            district_id: r.district_id === null ? null : Number(r.district_id),
            type: r.type,
            created_at: Number(r.created_at),
        }));

        const translations: SourceTranslation[] = translationRows.map((t) => ({
            id: Number(t.id),
            region_id: Number(t.region_id),
            locale: t.locale,
            title: t.title,
        }));

        const out: DumpFile = {
            dumped_at: Math.floor(Date.now() / 1000),
            source_host: `${host}:${port}`,
            source_db: database,
            regions,
            translations,
        };

        const outDir = path.resolve(__dirname, '..', 'prisma', 'seeds', 'data');
        fs.mkdirSync(outDir, { recursive: true });
        const outPath = path.join(outDir, 'regions.json');
        fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n', 'utf8');

        console.log(`Wrote ${regions.length} regions + ${translations.length} translations → ${outPath}`);
    } finally {
        await conn.end();
    }
}

main().catch((err) => {
    console.error('Dump failed:', err);
    process.exit(1);
});
