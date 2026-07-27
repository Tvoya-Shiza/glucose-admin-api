import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { PublishersController } from './publishers.controller';
import { PublishersService } from './publishers.service';
import { QuizSubjectsController } from './quiz-subjects.controller';
import { QuizSubjectsService } from './quiz-subjects.service';
import { BooksController } from './books.controller';
import { BooksService } from './books.service';
import { BooksMutationsService } from './books-mutations.service';
import { BookPagesController } from './book-pages.controller';
import { BookPagesService } from './book-pages.service';
import { EbooksReindexController } from './search/ebooks-reindex.controller';
import { EbooksSearchIndexService } from './search/search-index.service';
import { EbooksCacheService } from './utils/ebooks-cache.service';

/**
 * EbooksModule — Phase 39/40 «Электронные книги» admin surface (ТЗ §6.0 + Модули 1–2).
 *
 * Publishers CRUD  → /admin-api/v1/admin/publishers
 * Subjects         → /admin-api/v1/admin/quiz-subjects (list/create/rename; ТЗ 3.2.2)
 * Books CRUD       → /admin-api/v1/admin/ebooks (list/detail/create/update/soft-delete/publish)
 * Page management  → /admin-api/v1/admin/ebooks/:bookId/pages (list/batch-upsert/delete)
 * Search reindex   → POST /admin-api/v1/admin/ebooks/:id/reindex
 *
 * MySQL (book / book_translations / book_pages) is the source of truth.
 * EbooksSearchIndexService maintains a best-effort Postgres read model (book_page_index);
 * it no-ops when SEARCH_DATABASE_URL is unset. PrismaModule + RedisModule + ConfigModule
 * are global in AppModule.
 */
@Module({
    imports: [AccessModule],
    controllers: [PublishersController, QuizSubjectsController, BooksController, BookPagesController, EbooksReindexController],
    providers: [
        PublishersService,
        QuizSubjectsService,
        BooksService,
        BooksMutationsService,
        BookPagesService,
        EbooksCacheService,
        EbooksSearchIndexService,
    ],
    exports: [],
})
export class EbooksModule {}
