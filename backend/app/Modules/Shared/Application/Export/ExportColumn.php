<?php

namespace App\Modules\Shared\Application\Export;

use Closure;

/**
 * One column of a list export. `key` is a dot path into the presented row (the same array
 * the list endpoint returns), or `value` computes the cell from that row.
 */
final readonly class ExportColumn
{
    /**
     * @param  (Closure(array<string, mixed>): mixed)|null  $value
     */
    public function __construct(
        public string $key,
        public string $label,
        public ColumnType $type = ColumnType::Text,
        public ?string $align = null,
        public ?Closure $value = null,
    ) {}

    /**
     * @param  (Closure(array<string, mixed>): mixed)|null  $value
     */
    public static function text(string $key, string $label, ?Closure $value = null): self
    {
        return new self($key, $label, ColumnType::Text, value: $value);
    }

    /**
     * @param  (Closure(array<string, mixed>): mixed)|null  $value
     */
    public static function number(string $key, string $label, ?Closure $value = null): self
    {
        return new self($key, $label, ColumnType::Number, value: $value);
    }

    /**
     * @param  (Closure(array<string, mixed>): mixed)|null  $value
     */
    public static function money(string $key, string $label, ?Closure $value = null): self
    {
        return new self($key, $label, ColumnType::Money, value: $value);
    }

    /**
     * @param  (Closure(array<string, mixed>): mixed)|null  $value
     */
    public static function quantity(string $key, string $label, ?Closure $value = null): self
    {
        return new self($key, $label, ColumnType::Quantity, value: $value);
    }

    /**
     * @param  (Closure(array<string, mixed>): mixed)|null  $value
     */
    public static function date(string $key, string $label, ?Closure $value = null): self
    {
        return new self($key, $label, ColumnType::Date, value: $value);
    }

    /**
     * @param  (Closure(array<string, mixed>): mixed)|null  $value
     */
    public static function dateTime(string $key, string $label, ?Closure $value = null): self
    {
        return new self($key, $label, ColumnType::DateTime, value: $value);
    }

    /**
     * @param  (Closure(array<string, mixed>): mixed)|null  $value
     */
    public static function status(string $key, string $label, ?Closure $value = null): self
    {
        return new self($key, $label, ColumnType::Status, value: $value);
    }

    /**
     * A yes/no column from a boolean field.
     */
    public static function yesNo(string $key, string $label): self
    {
        return new self($key, $label, ColumnType::Text, 'center', fn (array $row) => match (data_get($row, $key)) {
            true, 1, '1' => 'Yes',
            false, 0, '0' => 'No',
            default => null,
        });
    }

    public function alignment(): string
    {
        return $this->align ?? ($this->type->isNumeric() ? 'right' : 'left');
    }

    /**
     * @param  array<string, mixed>  $row
     */
    public function valueOf(array $row): mixed
    {
        $value = $this->value !== null ? ($this->value)($row) : data_get($row, $this->key);

        return $value instanceof \BackedEnum ? $value->value : $value;
    }
}
