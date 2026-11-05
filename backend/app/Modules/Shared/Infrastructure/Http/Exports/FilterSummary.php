<?php

namespace App\Modules\Shared\Infrastructure\Http\Exports;

use App\Modules\Shared\Infrastructure\Export\ExportValues;
use Carbon\CarbonImmutable;
use Closure;
use Illuminate\Http\Request;
use Throwable;

/**
 * Builds the human-readable filter line printed on exports:
 * "Status: Completed · Branch: Dhaka Main · Date: 01 Nov–05 Nov 2026".
 */
final class FilterSummary
{
    /** @var list<string> */
    private array $parts = [];

    private function __construct(private readonly Request $request) {}

    public static function of(Request $request): self
    {
        return new self($request);
    }

    public function search(string $label = 'Search'): self
    {
        $search = trim((string) $this->request->query('search', ''));

        return $search === '' ? $this : $this->add($label, '"'.$search.'"');
    }

    /**
     * A plain filter; enum-like values are humanized ("partially_received" → "Partially received").
     *
     * @param  (Closure(string): ?string)|null  $format
     */
    public function value(string $param, string $label, ?Closure $format = null): self
    {
        $value = $this->scalar($param);
        if ($value === null) {
            return $this;
        }

        return $this->add($label, $format !== null ? ($format($value) ?? $value) : (string) ExportValues::status($value));
    }

    /**
     * An id filter shown by name; `$resolve` returns the name (or null → "Unknown").
     *
     * @param  Closure(string): ?string  $resolve
     */
    public function lookup(string $param, string $label, Closure $resolve): self
    {
        $value = $this->scalar($param);
        if ($value === null) {
            return $this;
        }
        try {
            $name = $resolve($value);
        } catch (Throwable) {
            $name = null;
        }

        return $this->add($label, $name ?? 'Unknown');
    }

    public function boolean(string $param, string $label, string $yes = 'Yes', string $no = 'No'): self
    {
        if (! $this->request->query->has($param) || $this->scalar($param) === null) {
            return $this;
        }

        return $this->add($label, $this->request->boolean($param) ? $yes : $no);
    }

    /**
     * A switch that only matters when on (e.g. `archived=1` → "Archived only").
     */
    public function flag(string $param, string $text): self
    {
        if ($this->request->boolean($param)) {
            $this->parts[] = $text;
        }

        return $this;
    }

    /**
     * A calendar range: "Date: 01 Nov–05 Nov 2026", "Date: from 01 Nov 2026", "Date: until 05 Nov 2026".
     */
    public function dates(string $from = 'from', string $to = 'to', string $label = 'Date'): self
    {
        $start = $this->date($from);
        $end = $this->date($to);

        return match (true) {
            $start !== null && $end !== null => $this->add($label, $start->year === $end->year
                ? $start->format('d M').'–'.$end->format('d M Y')
                : $start->format('d M Y').'–'.$end->format('d M Y')),
            $start !== null => $this->add($label, 'from '.$start->format('d M Y')),
            $end !== null => $this->add($label, 'until '.$end->format('d M Y')),
            default => $this,
        };
    }

    public function add(string $label, string $value): self
    {
        $this->parts[] = "{$label}: {$value}";

        return $this;
    }

    /**
     * @return list<string>
     */
    public function all(): array
    {
        return $this->parts;
    }

    private function scalar(string $param): ?string
    {
        $value = $this->request->query($param);
        if (! is_scalar($value)) {
            return null;
        }
        $value = trim((string) $value);

        return $value === '' ? null : $value;
    }

    private function date(string $param): ?CarbonImmutable
    {
        $value = $this->scalar($param);
        if ($value === null) {
            return null;
        }
        try {
            return CarbonImmutable::parse($value);
        } catch (Throwable) {
            return null;
        }
    }
}
