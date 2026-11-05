<?php

namespace App\Modules\Shared\Application\Export;

use Carbon\CarbonImmutable;
use Closure;

/**
 * Everything a writer needs: the letterhead, title, filter summary, columns and a row
 * stream (a generator over presented rows — never the whole list in memory).
 */
final readonly class ExportDocument
{
    /**
     * @param  list<ExportColumn>  $columns
     * @param  Closure(): iterable<array<string, mixed>>  $rows
     * @param  list<string>  $filters  e.g. ["Status: Completed", "Date: 01 Nov–05 Nov 2026"]
     * @param  array{name: string, legal_name: ?string, address: ?string, phone: ?string, email: ?string, tax_number: ?string, slug: string, timezone: string, logo: ?string}  $letterhead
     */
    public function __construct(
        public string $title,
        public array $columns,
        public Closure $rows,
        public int $total,
        public array $filters,
        public array $letterhead,
        public string $timezone,
        public CarbonImmutable $generatedAt,
        public ?string $generatedBy,
    ) {}

    public function filterSummary(): string
    {
        return $this->filters === [] ? 'All records' : implode(' · ', $this->filters);
    }

    /**
     * @return iterable<array<string, mixed>>
     */
    public function rows(): iterable
    {
        return ($this->rows)();
    }
}
