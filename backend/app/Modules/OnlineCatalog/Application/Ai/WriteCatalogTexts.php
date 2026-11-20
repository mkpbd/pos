<?php

namespace App\Modules\OnlineCatalog\Application\Ai;

use App\Modules\OnlineCatalog\Domain\Ai\CatalogTextFields;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;

/**
 * AI2a §1 "Write with AI": suggested texts for one product, category or brand (fields ×
 * languages) with the current texts for a side-by-side view. Nothing is saved: the editor fills
 * its form and staff save the listing as usual. Usage feature `catalog_writer`; audited
 * (`online_catalog.ai_written`) with the subject and counts only, never the texts.
 */
class WriteCatalogTexts
{
    public const FEATURE = 'catalog_writer';

    public function __construct(
        private readonly CatalogTextWriter $writer,
        private readonly TenantContext $tenant,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  array{subject: string, id: string, fields: list<string>, languages: list<string>, tone?: ?string, length?: ?string, notes?: ?string}  $input  validated
     * @return array{subject: string, id: string, suggestions: array<string, array<string, string>|object>, missing_info: list<string>, current: array<string, array<string, ?string>|object>}
     */
    public function __invoke(array $input, ?string $userId): array
    {
        $subject = $input['subject'];
        $id = strtolower($input['id']);
        $fields = CatalogTextFields::applicable($subject, $input['fields']);
        $languages = array_values(array_intersect(CatalogTextFields::LANGUAGES, $input['languages']));
        if ($fields === [] || $languages === []) {
            throw new BusinessRuleViolation('NOTHING_TO_WRITE', 'There is nothing to write: choose at least one text this '.$subject.' has.');
        }

        $result = $this->writer->write(
            $this->tenant->requireOrganization(),
            $userId,
            self::FEATURE,
            $subject,
            $id,
            $fields,
            $languages,
            $input['tone'] ?? 'friendly',
            $input['length'] ?? 'medium',
            $input['notes'] ?? null,
        );
        if ($result['status'] !== 'ok') {
            throw self::unavailable($result['status']);
        }

        $this->audit->record('online_catalog.ai_written', null, [], [], [
            'subject' => $subject,
            'subject_id' => $id,
            'fields' => count($fields),
            'languages' => count($languages),
            'texts' => array_sum(array_map('count', $result['suggestions'])),
        ]);

        return [
            'subject' => $subject,
            'id' => $id,
            'suggestions' => array_map(fn (array $texts) => $texts === [] ? (object) [] : $texts, $result['suggestions']),
            'missing_info' => $result['missing_info'],
            'current' => array_map(fn (array $texts) => $texts === [] ? (object) [] : $texts, $result['current']),
        ];
    }

    /**
     * 422 AI_UNAVAILABLE with `details.reason` (disabled | budget_exceeded | unavailable |
     * refused | empty | invalid) and a message in plain words.
     */
    public static function unavailable(string $reason): BusinessRuleViolation
    {
        $message = match ($reason) {
            'disabled' => 'AI writing is turned off for your store.',
            'budget_exceeded' => 'Your store has used this month\'s AI budget.',
            'refused' => 'The AI writer could not write this. Try different notes.',
            'empty', 'invalid' => 'The AI writer did not return usable texts. Try again.',
            default => 'The AI writer is not available right now. Try again later.',
        };

        return new BusinessRuleViolation('AI_UNAVAILABLE', $message, ['reason' => $reason]);
    }
}
