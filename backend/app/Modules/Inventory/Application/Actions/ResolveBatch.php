<?php

namespace App\Modules\Inventory\Application\Actions;

use App\Modules\Inventory\Infrastructure\Models\Batch;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;

/**
 * Finds a variant's batch by number (case-insensitive) or registers it on first receipt.
 * A batch's expiry date is fixed once known; a receipt with a different date is refused.
 */
class ResolveBatch
{
    public function __construct(private readonly TenantContext $tenant) {}

    public function __invoke(string $variantId, string $batchNumber, ?string $expiresOn = null, ?string $manufacturedOn = null): Batch
    {
        $batchNumber = trim($batchNumber);
        $batch = Batch::query()
            ->where('variant_id', $variantId)
            ->whereRaw('lower(batch_number) = ?', [mb_strtolower($batchNumber)])
            ->first();

        if ($batch === null) {
            return Batch::query()->create([
                'organization_id' => $this->tenant->requireOrganization(),
                'variant_id' => $variantId,
                'batch_number' => $batchNumber,
                'expires_on' => $expiresOn,
                'manufactured_on' => $manufacturedOn,
            ]);
        }

        if ($expiresOn !== null && $batch->expires_on !== null && $batch->expires_on->toDateString() !== $expiresOn) {
            throw new BusinessRuleViolation('BATCH_EXPIRY_MISMATCH', "Batch {$batch->batch_number} is recorded with expiry {$batch->expires_on->toDateString()}.", ['batch_id' => $batch->id]);
        }
        if ($expiresOn !== null && $batch->expires_on === null) {
            $batch->forceFill(['expires_on' => $expiresOn])->save();
        }

        return $batch;
    }
}
