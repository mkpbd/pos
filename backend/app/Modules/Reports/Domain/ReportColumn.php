<?php

namespace App\Modules\Reports\Domain;

/**
 * One column of a report. `cost_sensitive` columns (cost, profit, margin, stock value) are only
 * returned to users holding `products.view_cost`; for others they are omitted from rows and
 * totals and listed in `meta.omitted_columns`.
 */
final readonly class ReportColumn
{
    public function __construct(
        public string $key,
        public string $label,
        public ColumnType $type,
        public bool $costSensitive = false,
        public bool $sortable = true,
    ) {}

    public static function text(string $key, string $label, bool $sortable = true): self
    {
        return new self($key, $label, ColumnType::Text, sortable: $sortable);
    }

    public static function date(string $key, string $label): self
    {
        return new self($key, $label, ColumnType::Date);
    }

    public static function dateTime(string $key, string $label): self
    {
        return new self($key, $label, ColumnType::DateTime);
    }

    public static function money(string $key, string $label, bool $costSensitive = false): self
    {
        return new self($key, $label, ColumnType::Money, $costSensitive);
    }

    public static function quantity(string $key, string $label, bool $costSensitive = false): self
    {
        return new self($key, $label, ColumnType::Quantity, $costSensitive);
    }

    public static function number(string $key, string $label): self
    {
        return new self($key, $label, ColumnType::Number);
    }

    public static function percent(string $key, string $label, bool $costSensitive = false): self
    {
        return new self($key, $label, ColumnType::Percent, $costSensitive);
    }

    /** The same column, but not offered as a sort key (the report has no SQL order for it). */
    public function notSortable(): self
    {
        return new self($this->key, $this->label, $this->type, $this->costSensitive, false);
    }

    public function withLabel(string $label): self
    {
        return new self($this->key, $label, $this->type, $this->costSensitive, $this->sortable);
    }

    /**
     * @return array{key: string, label: string, type: string, cost_sensitive: bool, sortable: bool}
     */
    public function toArray(): array
    {
        return [
            'key' => $this->key,
            'label' => $this->label,
            'type' => $this->type->value,
            'cost_sensitive' => $this->costSensitive,
            'sortable' => $this->sortable,
        ];
    }
}
