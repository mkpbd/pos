<?php

namespace App\Modules\Imports\Application\Data;

/**
 * Collects a row's errors while a handler checks it.
 */
final class RowErrors
{
    /** @var list<array{column: ?string, message: string}> */
    private array $errors = [];

    public function add(?string $column, string $message): self
    {
        $this->errors[] = ['column' => $column, 'message' => $message];

        return $this;
    }

    public function any(): bool
    {
        return $this->errors !== [];
    }

    public function result(): RowResult
    {
        return RowResult::errors($this->errors);
    }
}
