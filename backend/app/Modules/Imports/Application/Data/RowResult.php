<?php

namespace App\Modules\Imports\Application\Data;

use App\Modules\Imports\Domain\RowAction;

/**
 * What a row will do (dry run) or did (run), with its errors per column (null column = the row).
 */
final readonly class RowResult
{
    /**
     * @param  list<array{column: ?string, message: string}>  $errors
     */
    private function __construct(public RowAction $action, public array $errors = []) {}

    public static function create(): self
    {
        return new self(RowAction::Create);
    }

    public static function update(): self
    {
        return new self(RowAction::Update);
    }

    public static function skip(): self
    {
        return new self(RowAction::Skip);
    }

    public static function error(?string $column, string $message): self
    {
        return new self(RowAction::Error, [['column' => $column, 'message' => $message]]);
    }

    /**
     * @param  list<array{column: ?string, message: string}>  $errors
     */
    public static function errors(array $errors): self
    {
        return new self(RowAction::Error, array_values($errors));
    }

    public function isError(): bool
    {
        return $this->action === RowAction::Error;
    }
}
