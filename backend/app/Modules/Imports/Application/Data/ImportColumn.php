<?php

namespace App\Modules\Imports\Application\Data;

use App\Modules\Imports\Domain\ColumnType;

/**
 * One column of an import type: header key, label (also accepted as header), whether the column
 * must be in the file and filled on every row, an example value for the template and help text.
 * `type` decides how cells are read before the handler sees them (CellValue).
 */
final readonly class ImportColumn
{
    public function __construct(
        public string $key,
        public string $label,
        public bool $required = false,
        public string $example = '',
        public string $help = '',
        public ColumnType $type = ColumnType::Text,
        public ?int $maxLength = null,
    ) {}

    /**
     * @return array{key: string, label: string, required: bool, example: string, help: string, type: string}
     */
    public function toArray(): array
    {
        return [
            'key' => $this->key,
            'label' => $this->label,
            'required' => $this->required,
            'example' => $this->example,
            'help' => $this->help,
            'type' => $this->type->value,
        ];
    }
}
