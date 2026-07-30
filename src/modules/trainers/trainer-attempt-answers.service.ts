import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { buildTrainerResultsWhere } from './utils/trainer-results-where';

/** Один вариант ответа так, как он был показан ученику. */
export interface TrainerAnswerOptionDto {
    id: number;
    title: string;
    image: string | null;
    /** Верный ли вариант по эталону, зафиксированному в снапшоте попытки. */
    is_correct: boolean;
    /** Выбрал ли его ученик. */
    is_chosen: boolean;
}

export interface TrainerAttemptAnswerDto {
    question_id: number;
    position: number;
    type: string;
    title: string;
    image: string | null;
    outcome: string;
    points_awarded: number;
    points_possible: number;
    time_spent_sec: number | null;
    options: TrainerAnswerOptionDto[];
}

export interface TrainerAttemptAnswersDto {
    id: string;
    user: { id: number; full_name: string | null; email: string | null } | null;
    trainer: { id: number; title_kz: string | null } | null;
    status: string;
    attempt_number: number | null;
    score: number;
    max_score: number;
    correct_count: number;
    incorrect_count: number;
    skipped_count: number;
    rounds_played: number;
    elapsed_sec: number;
    finished_at: number | null;
    answers: TrainerAttemptAnswerDto[];
}

/** Форма снапшота вопроса, записанного glucose-api при старте попытки. */
interface QuestionSnapshot {
    question_id: number;
    type: string;
    title: string;
    image: string | null;
    points: number;
    answers: Array<{ id: number; title: string; image: string | null; correct: boolean }>;
}

/**
 * Разбор попытки тренажёра по каждому вопросу — чего в админке не было вовсе:
 * список результатов показывал только агрегаты (баллы и три счётчика), и
 * посмотреть, что именно ученик выбрал, было негде.
 *
 * Данные брать неоткуда, кроме самой попытки: `question_snapshot` хранит вопрос
 * с вариантами и флагами «верный» на момент прохождения, `answer_payload` — что
 * выбрал ученик. Банк вопросов для этого не годится — его могли отредактировать
 * после прохождения, и разбор показал бы не то, что видел ученик.
 *
 * Показываем только первый раунд: последующие — это циклы повторения ошибок,
 * они не влияют на счёт (ТЗ 5.4.5) и в разборе только запутали бы.
 *
 * Доступ сужается тем же предикатом, что список и экспорт, — куратор и
 * преподаватель видят разбор ровно тех попыток, которые видят в списке.
 */
@Injectable()
export class TrainerAttemptAnswersService {
    constructor(private readonly prisma: PrismaService) {}

    public async getAttemptAnswers(actor: ScopeActor, attemptId: number): Promise<TrainerAttemptAnswersDto> {
        const { where, shortCircuit } = await buildTrainerResultsWhere(actor, {}, this.prisma);
        if (shortCircuit) throw new NotFoundException('trainers.attempt_not_found');

        const attempt: any = await this.prisma.trainerAttempt.findFirst({
            where: { ...where, id: attemptId },
            select: {
                id: true,
                status: true,
                attempt_number: true,
                score: true,
                max_score: true,
                correct_count: true,
                incorrect_count: true,
                skipped_count: true,
                current_round: true,
                elapsed_sec: true,
                finished_at: true,
                user: { select: { id: true, full_name: true, email: true } },
                quiz: { select: { id: true, translations: { select: { locale: true, title: true } } } },
            },
        });

        if (!attempt) throw new NotFoundException('trainers.attempt_not_found');

        const rows = await this.prisma.trainerAttemptQuestion.findMany({
            where: { attempt_id: attemptId, round_number: 1 },
            orderBy: { position: 'asc' },
            select: {
                position: true,
                outcome: true,
                points_awarded: true,
                time_spent_sec: true,
                question_snapshot: true,
                answer_payload: true,
            },
        });

        const translations = (attempt.quiz?.translations ?? []) as Array<{ locale: string; title: string | null }>;
        const kz = translations.find((t) => t.locale === 'kz') ?? translations[0];

        return {
            id: String(attempt.id),
            user: attempt.user
                ? { id: Number(attempt.user.id), full_name: attempt.user.full_name ?? null, email: attempt.user.email ?? null }
                : null,
            trainer: attempt.quiz ? { id: Number(attempt.quiz.id), title_kz: kz?.title ?? null } : null,
            status: attempt.status,
            attempt_number: attempt.attempt_number ?? null,
            score: Number(attempt.score ?? 0),
            max_score: Number(attempt.max_score ?? 0),
            correct_count: Number(attempt.correct_count ?? 0),
            incorrect_count: Number(attempt.incorrect_count ?? 0),
            skipped_count: Number(attempt.skipped_count ?? 0),
            rounds_played: Number(attempt.current_round ?? 1),
            elapsed_sec: Number(attempt.elapsed_sec ?? 0),
            finished_at: attempt.finished_at ?? null,
            answers: rows.map((row) => this.toAnswerDto(row)),
        };
    }

    private toAnswerDto(row: any): TrainerAttemptAnswerDto {
        const snapshot = (row.question_snapshot ?? {}) as Partial<QuestionSnapshot>;
        const payload = (row.answer_payload ?? null) as { answer?: number | number[] | null } | null;

        const chosen = new Set<number>();
        const raw = payload?.answer;
        if (Array.isArray(raw)) raw.forEach((id) => chosen.add(Number(id)));
        else if (raw != null) chosen.add(Number(raw));

        return {
            question_id: Number(snapshot.question_id ?? 0),
            position: Number(row.position ?? 0),
            type: String(snapshot.type ?? 'single'),
            title: snapshot.title ?? '',
            image: snapshot.image ?? null,
            outcome: String(row.outcome),
            points_awarded: Number(row.points_awarded ?? 0),
            points_possible: Number(snapshot.points ?? 0),
            time_spent_sec: row.time_spent_sec ?? null,
            options: (snapshot.answers ?? []).map((a) => ({
                id: Number(a.id),
                title: a.title,
                image: a.image ?? null,
                is_correct: Boolean(a.correct),
                is_chosen: chosen.has(Number(a.id)),
            })),
        };
    }
}
