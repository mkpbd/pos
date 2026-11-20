<?php

namespace App\Modules\Storefront\Application\Builder\Collaboration;

use App\Modules\Shared\Application\Support\StaffActor;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;
use App\Modules\Storefront\Infrastructure\Models\BuilderEditSession;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * B16: draft saves (PUT …/draft) are not audited one by one; each staff member's saves of a
 * document are counted in a rolling session that a save more than GAP_MINUTES after the last one
 * closes ("Rima edited the draft (12 saves, 3:10–3:40 PM)").
 */
class BuilderEditSessions
{
    public function recordSave(BuilderDocument $document): void
    {
        $userId = StaffActor::id();
        if ($userId === null) {
            return;
        }
        $now = CarbonImmutable::now();

        DB::transaction(function () use ($document, $userId, $now) {
            $session = BuilderEditSession::query()
                ->where('document_id', $document->id)
                ->where('user_id', $userId)
                ->where('ended_at', '>=', $now->subMinutes(BuilderEditSession::GAP_MINUTES))
                ->orderByDesc('ended_at')
                ->lockForUpdate()
                ->first();
            if ($session !== null) {
                $session->forceFill([
                    'ended_at' => $now,
                    'saves' => $session->saves + 1,
                    'last_revision' => $document->draft_revision,
                ])->save();

                return;
            }
            BuilderEditSession::query()->create([
                'document_id' => $document->id,
                'user_id' => $userId,
                'started_at' => $now,
                'ended_at' => $now,
                'saves' => 1,
                'first_revision' => $document->draft_revision,
                'last_revision' => $document->draft_revision,
            ]);
        });
    }
}
