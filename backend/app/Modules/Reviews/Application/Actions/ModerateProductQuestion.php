<?php

namespace App\Modules\Reviews\Application\Actions;

use App\Modules\Reviews\Application\Events\ProductQuestionAnswered;
use App\Modules\Reviews\Domain\QuestionStatus;
use App\Modules\Reviews\Infrastructure\Models\ProductQuestion;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use Illuminate\Support\Facades\DB;

/**
 * P1b: staff answer, publish, reject and delete shopper questions. Every change runs with the
 * question row locked and is audited.
 *
 * - answer: saves the answer; `publish` true shows it on the product page (published), false
 *   keeps it hidden (pending). The first time a question is published, the asker gets one e-mail
 *   (claimed in the same transaction through `answer_notified_at`, sent after commit).
 * - reject: hidden (rejected); rejecting a rejected question changes nothing.
 * - delete: gone for good.
 */
class ModerateProductQuestion
{
    public function __construct(private readonly AuditTrail $audit) {}

    public function answer(ProductQuestion $question, string $answer, bool $publish, string $actorId): ProductQuestion
    {
        $answer = trim($answer);

        return DB::transaction(function () use ($question, $answer, $publish, $actorId) {
            $locked = $this->lock($question);
            $before = ['status' => $locked->status->value, 'answer' => $locked->answer];
            $status = $publish ? QuestionStatus::Published : QuestionStatus::Pending;
            if ($before['answer'] === $answer && $locked->status === $status) {
                return $locked;
            }

            $notify = $publish && $locked->answer_notified_at === null;
            $locked->fill([
                'answer' => $answer,
                'status' => $status,
                'answered_by' => $actorId,
                'answered_at' => now(),
            ]);
            if ($notify) {
                $locked->answer_notified_at = now();
            }
            $locked->save();
            $this->audit->record($publish ? 'product_question.published' : 'product_question.answered', $locked, $before, ['status' => $status->value, 'answer' => $answer]);
            if ($notify) {
                event(new ProductQuestionAnswered($locked->organization_id, $locked->id));
            }

            return $locked;
        });
    }

    public function reject(ProductQuestion $question): ProductQuestion
    {
        return DB::transaction(function () use ($question) {
            $locked = $this->lock($question);
            if ($locked->status === QuestionStatus::Rejected) {
                return $locked;
            }
            $from = $locked->status;
            $locked->update(['status' => QuestionStatus::Rejected]);
            $this->audit->record('product_question.rejected', $locked, ['status' => $from->value], ['status' => QuestionStatus::Rejected->value]);

            return $locked;
        });
    }

    public function delete(ProductQuestion $question): void
    {
        DB::transaction(function () use ($question) {
            $locked = $this->lock($question);
            $this->audit->record('product_question.deleted', $locked, [
                'status' => $locked->status->value,
                'product_id' => $locked->product_id,
                'question' => $locked->question,
            ]);
            $locked->delete();
        });
    }

    private function lock(ProductQuestion $question): ProductQuestion
    {
        /** @var ProductQuestion */
        return ProductQuestion::query()->whereKey($question->id)->lockForUpdate()->firstOrFail();
    }
}
