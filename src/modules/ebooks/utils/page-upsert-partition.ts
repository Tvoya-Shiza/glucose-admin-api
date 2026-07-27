/**
 * Phase 39/40 — per-field merge partitioning for the batch page upsert.
 *
 * `PUT /admin-api/v1/admin/ebooks/:bookId/pages` documents per-field merge: a field
 * that is ABSENT from an entry must be left untouched on an existing row, while an
 * explicit `null` clears it. MySQL cannot express "skip this column for some rows"
 * inside a single `INSERT ... ON DUPLICATE KEY UPDATE`, so rows are partitioned by
 * which fields are present and each partition is written with its own SET clause.
 *
 * Without this, an image-only edit would NULL the page's OCR text — and because the
 * list endpoint returns only `has_text` (never the text itself), the client cannot
 * round-trip the value back, so the loss is silent and unrecoverable.
 */

export interface PageUpsertInput {
    page_number: number;
    image_url?: string | null;
    text_content?: string | null;
}

export interface PageUpsertPartition<T extends PageUpsertInput = PageUpsertInput> {
    rows: T[];
    /** Write `image_url` in the ON DUPLICATE KEY UPDATE clause. */
    setImage: boolean;
    /** Write `text_content` in the ON DUPLICATE KEY UPDATE clause. */
    setText: boolean;
}

/**
 * Groups entries into the (at most four) update shapes. Empty partitions are dropped,
 * so callers can iterate the result directly.
 */
export function partitionPagesForUpsert<T extends PageUpsertInput>(pages: readonly T[]): Array<PageUpsertPartition<T>> {
    const buckets: Array<PageUpsertPartition<T>> = [
        { rows: [], setImage: true, setText: true },
        { rows: [], setImage: true, setText: false },
        { rows: [], setImage: false, setText: true },
        { rows: [], setImage: false, setText: false },
    ];

    for (const page of pages) {
        const setImage = page.image_url !== undefined;
        const setText = page.text_content !== undefined;
        buckets.find((bucket) => bucket.setImage === setImage && bucket.setText === setText)!.rows.push(page);
    }

    return buckets.filter((bucket) => bucket.rows.length > 0);
}
