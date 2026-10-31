<?php

namespace App\Modules\Shared\Infrastructure\Sequences;

use App\Modules\Shared\Application\Contracts\SequenceGenerator;
use Illuminate\Support\Facades\DB;
use LogicException;

class DatabaseSequenceGenerator implements SequenceGenerator
{
    public function next(string $organizationId, string $key, string $prefix = '', int $padding = 6): string
    {
        if (DB::transactionLevel() === 0) {
            throw new LogicException('Sequence numbers must be taken inside a database transaction.');
        }

        $now = now();
        // Creates the counter on first use; concurrent first uses are absorbed by the primary key.
        DB::table('document_sequences')->insertOrIgnore([
            'organization_id' => $organizationId,
            'key' => $key,
            'next_number' => 1,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $row = DB::table('document_sequences')
            ->where('organization_id', $organizationId)
            ->where('key', $key)
            ->lockForUpdate()
            ->first(['next_number']);

        $number = (int) $row->next_number;

        DB::table('document_sequences')
            ->where('organization_id', $organizationId)
            ->where('key', $key)
            ->update(['next_number' => $number + 1, 'updated_at' => $now]);

        return $prefix.str_pad((string) $number, $padding, '0', STR_PAD_LEFT);
    }
}
