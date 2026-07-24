import { partitionPagesForUpsert } from './page-upsert-partition';

describe('partitionPagesForUpsert', () => {
    it('writes both columns when both fields are supplied', () => {
        const parts = partitionPagesForUpsert([{ page_number: 1, image_url: '/a.png', text_content: 'text' }]);
        expect(parts).toHaveLength(1);
        expect(parts[0]).toMatchObject({ setImage: true, setText: true });
        expect(parts[0].rows).toHaveLength(1);
    });

    it('never writes text_content when the field is absent — the OCR-wipe regression', () => {
        const parts = partitionPagesForUpsert([{ page_number: 7, image_url: '/page-7.png' }]);
        expect(parts).toHaveLength(1);
        expect(parts[0].setImage).toBe(true);
        expect(parts[0].setText).toBe(false);
    });

    it('never writes image_url when only text is supplied', () => {
        const parts = partitionPagesForUpsert([{ page_number: 3, text_content: 'ocr' }]);
        expect(parts[0].setImage).toBe(false);
        expect(parts[0].setText).toBe(true);
    });

    it('treats an explicit null as a value that clears the column', () => {
        const parts = partitionPagesForUpsert([{ page_number: 2, text_content: null }]);
        expect(parts[0].setText).toBe(true);
        expect(parts[0].rows[0].text_content).toBeNull();
    });

    it('separates mixed entries so an image-only page cannot ride a text-writing statement', () => {
        const parts = partitionPagesForUpsert([
            { page_number: 1, image_url: '/1.png', text_content: 'a' },
            { page_number: 2, image_url: '/2.png' },
            { page_number: 3, text_content: 'c' },
            { page_number: 4 },
        ]);
        expect(parts).toHaveLength(4);
        const textWriting = parts.filter((p) => p.setText).flatMap((p) => p.rows.map((r) => r.page_number));
        expect(textWriting.sort()).toEqual([1, 3]);
    });

    it('drops empty partitions', () => {
        const parts = partitionPagesForUpsert([{ page_number: 1, image_url: '/1.png' }]);
        expect(parts.every((p) => p.rows.length > 0)).toBe(true);
    });

    it('returns nothing for an empty batch', () => {
        expect(partitionPagesForUpsert([])).toEqual([]);
    });
});
