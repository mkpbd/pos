<?php

namespace App\Modules\Reports\Application\Support;

use App\Modules\Reports\Application\ReportContext;
use App\Modules\Reports\Domain\ReportDefinition;
use Carbon\CarbonImmutable;

/**
 * "Label: value" lines describing a run's resolved parameters, printed on exports:
 * "Period: 01 Nov–30 Nov 2026 · Branch: Dhaka Main · Channel: Online · Group by: Category".
 */
final class FilterDescription
{
    private const KINDS = ['branch' => 'branch', 'store' => 'store', 'product' => 'product', 'category' => 'category', 'brand' => 'brand',
        'cashier' => 'user', 'supplier' => 'supplier', 'customer' => 'customer'];

    /**
     * @return list<string>
     */
    public static function of(ReportDefinition $definition, ReportContext $context): array
    {
        $lines = [];
        if ($definition->isTimeBased()) {
            $from = CarbonImmutable::parse($context->from());
            $to = CarbonImmutable::parse($context->to());
            $lines[] = 'Period: '.($from->year === $to->year ? $from->format('d M').'–'.$to->format('d M Y') : $from->format('d M Y').'–'.$to->format('d M Y'));
        } else {
            $lines[] = 'As of: '.$context->now->setTimezone($context->timezone)->format('d M Y, H:i');
        }

        foreach ($definition->params as $param) {
            $value = $context->param($param->name);
            if ($value === null || in_array($param->name, ['date_from', 'date_to'], true)) {
                continue;
            }
            $text = match ($param->type) {
                'entity' => Names::one(self::KINDS[$param->entity] ?? $param->entity, $context->organizationId, (string) $value) ?? 'Unknown',
                'enum' => collect($param->options ?? [])->firstWhere('value', $value)['label'] ?? (string) $value,
                'boolean' => $value ? 'Yes' : 'No',
                default => (string) $value,
            };
            if ($param->type === 'enum' && $value === $param->default && $param->name === 'channel') {
                continue;
            }
            $lines[] = $param->label.': '.$text;
        }
        if ($context->branchIds !== null && $context->param('branch_id') === null) {
            $lines[] = 'Branches: your branches';
        }

        return $lines;
    }
}
