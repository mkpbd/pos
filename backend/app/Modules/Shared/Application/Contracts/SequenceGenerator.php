<?php

namespace App\Modules\Shared\Application\Contracts;

interface SequenceGenerator
{
    /**
     * Next number of the organization's sequence, formatted as prefix + zero-padded number
     * (e.g. "CUS-000042"). Must be called inside the transaction that uses the number, so a
     * rollback also returns the number and sequences stay gap-free.
     */
    public function next(string $organizationId, string $key, string $prefix = '', int $padding = 6): string;
}
