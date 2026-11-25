<?php

namespace App\Modules\Sales\Application\Services;

/**
 * POS1b: credit notes issued while completing returns in this request, so the completed
 * return's response can show the full code exactly once (it is stored only as a hash).
 * Bound as a scoped instance (reset per request / job).
 */
class IssuedCreditNotes
{
    /** @var array<string, array{code: string, code_last4: string, amount: string, expires_at: ?string}> */
    private array $issued = [];

    /**
     * @param  array{code: string, code_last4: string, amount: string, expires_at: ?string}  $creditNote
     */
    public function put(string $returnId, array $creditNote): void
    {
        $this->issued[$returnId] = $creditNote;
    }

    /**
     * The credit note issued for the return, handed out once (later calls get null).
     *
     * @return array{code: string, code_last4: string, amount: string, expires_at: ?string}|null
     */
    public function take(string $returnId): ?array
    {
        $creditNote = $this->issued[$returnId] ?? null;
        unset($this->issued[$returnId]);

        return $creditNote;
    }
}
