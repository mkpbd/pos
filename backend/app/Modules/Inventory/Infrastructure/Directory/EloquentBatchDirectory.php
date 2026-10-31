<?php

namespace App\Modules\Inventory\Infrastructure\Directory;

use App\Modules\Inventory\Application\Contracts\BatchDirectory;
use App\Modules\Inventory\Infrastructure\Models\Batch;

class EloquentBatchDirectory implements BatchDirectory
{
    public function summaries(string $organizationId, array $batchIds): array
    {
        if ($batchIds === []) {
            return [];
        }

        return Batch::query()->withoutGlobalScope('organization')
            ->where('organization_id', $organizationId)
            ->whereKey(array_values(array_unique($batchIds)))
            ->get(['id', 'batch_number', 'expires_on'])
            ->mapWithKeys(fn (Batch $b) => [$b->id => ['id' => $b->id, 'batch_number' => $b->batch_number, 'expires_on' => $b->expires_on?->toDateString()]])
            ->all();
    }
}
