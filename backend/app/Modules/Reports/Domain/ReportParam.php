<?php

namespace App\Modules\Reports\Domain;

/**
 * One typed parameter of a report — what the filter bar renders and what the AI's report
 * tools (Phase 8) may pass. Types:
 *   date     Y-m-d in the organization's timezone (date_from / date_to)
 *   entity   a uuid of `entity` (branch, store, product, category, brand, cashier, supplier,
 *            customer) that must belong to the organization (and, for branch and store, be
 *            accessible to the user)
 *   enum     one of `options`
 *   integer  between `min` and `max`
 *   boolean
 */
final readonly class ReportParam
{
    public const ENTITIES = ['branch', 'store', 'product', 'category', 'brand', 'cashier', 'supplier', 'customer'];

    /**
     * @param  list<array{value: string, label: string}>|null  $options
     */
    public function __construct(
        public string $name,
        public string $label,
        public string $type,
        public bool $required = false,
        public ?string $entity = null,
        public ?array $options = null,
        public mixed $default = null,
        public ?int $min = null,
        public ?int $max = null,
    ) {}

    public static function dateFrom(): self
    {
        return new self('date_from', 'From', 'date', required: true);
    }

    public static function dateTo(): self
    {
        return new self('date_to', 'To', 'date', required: true);
    }

    public static function entity(string $name, string $label, string $entity): self
    {
        return new self($name, $label, 'entity', entity: $entity);
    }

    public static function branch(): self
    {
        return self::entity('branch_id', 'Branch', 'branch');
    }

    public static function store(): self
    {
        return self::entity('store_id', 'Store', 'store');
    }

    public static function product(): self
    {
        return self::entity('product_id', 'Product', 'product');
    }

    public static function category(): self
    {
        return self::entity('category_id', 'Category', 'category');
    }

    public static function brand(): self
    {
        return self::entity('brand_id', 'Brand', 'brand');
    }

    public static function cashier(): self
    {
        return self::entity('cashier_id', 'Cashier', 'cashier');
    }

    public static function supplier(): self
    {
        return self::entity('supplier_id', 'Supplier', 'supplier');
    }

    public static function customer(): self
    {
        return self::entity('customer_id', 'Customer', 'customer');
    }

    /**
     * POS sales, web orders (on delivery), or both.
     */
    public static function channel(): self
    {
        return self::enum('channel', 'Channel', ['all' => 'All channels', 'pos' => 'POS', 'online' => 'Online'], 'all');
    }

    /**
     * @param  array<string, string>  $options  value => label
     */
    public static function enum(string $name, string $label, array $options, ?string $default = null): self
    {
        return new self($name, $label, 'enum', options: array_map(
            fn (string $value, string $text) => ['value' => $value, 'label' => $text],
            array_keys($options),
            array_values($options),
        ), default: $default);
    }

    /**
     * @param  array<string, string>  $options  value => label
     */
    public static function groupBy(array $options, string $default): self
    {
        return self::enum('group_by', 'Group by', $options, $default);
    }

    public static function integer(string $name, string $label, int $min, int $max, ?int $default = null): self
    {
        return new self($name, $label, 'integer', default: $default, min: $min, max: $max);
    }

    public static function boolean(string $name, string $label, bool $default): self
    {
        return new self($name, $label, 'boolean', default: $default);
    }

    /**
     * @return list<string>
     */
    public function optionValues(): array
    {
        return array_column($this->options ?? [], 'value');
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return array_filter([
            'name' => $this->name,
            'label' => $this->label,
            'type' => $this->type,
            'required' => $this->required,
            'entity' => $this->entity,
            'options' => $this->options,
            'default' => $this->default,
            'min' => $this->min,
            'max' => $this->max,
        ], fn ($value, string $key) => $value !== null || in_array($key, ['name', 'label', 'type', 'required'], true), ARRAY_FILTER_USE_BOTH);
    }
}
