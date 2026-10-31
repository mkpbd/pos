<?php

namespace App\Modules\Shared\Infrastructure\Validation;

use App\Modules\Shared\Application\Tenancy\TenantContext;
use Closure;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Case-insensitive uniqueness inside the current organization, ignoring
 * soft-deleted rows when the table has deleted_at.
 *
 *   new TenantUnique('brands', 'name', ignoreId: $brand?->id)
 *   (new TenantUnique('categories', 'name'))->where('parent_id', $parentId)
 */
class TenantUnique implements ValidationRule
{
    /** @var list<array{string, mixed}> */
    private array $wheres = [];

    public function __construct(
        private readonly string $table,
        private readonly string $column,
        private readonly ?string $ignoreId = null,
        private readonly bool $softDeletes = false,
    ) {}

    private string $message = 'The :attribute has already been taken.';

    public function where(string $column, mixed $value): static
    {
        $this->wheres[] = [$column, $value];

        return $this;
    }

    public function withMessage(string $message): static
    {
        $this->message = $message;

        return $this;
    }

    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (! is_string($value) || trim($value) === '') {
            return;
        }

        $exists = DB::table($this->table)
            ->where('organization_id', app(TenantContext::class)->requireOrganization())
            ->whereRaw('lower('.$this->column.') = ?', [mb_strtolower(trim($value))])
            ->when($this->ignoreId, fn (Builder $q) => $q->where('id', '!=', $this->ignoreId))
            ->when($this->softDeletes, fn (Builder $q) => $q->whereNull('deleted_at'))
            ->tap(function (Builder $q) {
                foreach ($this->wheres as [$column, $value]) {
                    $value === null ? $q->whereNull($column) : $q->where($column, $value);
                }
            })
            ->exists();

        if ($exists) {
            $fail($this->message);
        }
    }
}
