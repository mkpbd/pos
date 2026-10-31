<?php

namespace App\Modules\Inventory\Application\Contracts;

interface BatchDirectory
{
    /**
     * @param  list<string>  $batchIds
     * @return array<string, array{id: string, batch_number: string, expires_on: ?string}>
     */
    public function summaries(string $organizationId, array $batchIds): array;
}
