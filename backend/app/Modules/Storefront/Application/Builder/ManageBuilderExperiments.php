<?php

namespace App\Modules\Storefront\Application\Builder;

use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Support\StaffActor;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Storefront\Domain\Builder\Experiments;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * B13: starting, stopping and ending A/B tests — each writes the **draft** (the change reaches
 * shoppers when the page is published), with the draft revision the editor has (409
 * DRAFT_CONFLICT for a newer one, like a draft save), re-validated like a save and audited.
 *
 * - start: draft | stopped → running (started_at now; ended_at and winner cleared); both versions
 *   need sections (422 EXPERIMENT_NEEDS_BOTH_ARMS).
 * - stop: running → stopped (ended_at now): shoppers see version A (or the winner) again.
 * - keep: any but ended → ended with that winner; the other version's sections are removed and
 *   the kept ones become plain sections.
 *
 * 404 EXPERIMENT_NOT_FOUND for a test the draft does not have; 422 EXPERIMENT_STATUS when the
 * test's status does not allow the change.
 */
class ManageBuilderExperiments
{
    public function __construct(
        private readonly PrepareBuilderContent $prepare,
        private readonly AuditTrail $audit,
    ) {}

    public function start(BuilderDocument $document, int $revision, string $experimentId): BuilderDocument
    {
        return $this->change($document, $revision, $experimentId, 'storefront.builder_experiment_started', function (array $content, array $experiment) use ($experimentId) {
            $this->assertStatus($experiment, ['draft', 'stopped'], 'Only a draft or stopped A/B test can be started.');
            $arms = Experiments::armSections($content, $experimentId);
            if ($arms['A'] === [] || $arms['B'] === []) {
                throw new BusinessRuleViolation('EXPERIMENT_NEEDS_BOTH_ARMS', 'An A/B test needs a version A and a version B before it can start.', ['arms' => ['A' => count($arms['A']), 'B' => count($arms['B'])]]);
            }

            return Experiments::update($content, $experimentId, ['status' => 'running', 'started_at' => self::now(), 'ended_at' => null, 'winner' => null]);
        });
    }

    public function stop(BuilderDocument $document, int $revision, string $experimentId): BuilderDocument
    {
        return $this->change($document, $revision, $experimentId, 'storefront.builder_experiment_stopped', function (array $content, array $experiment) use ($experimentId) {
            $this->assertStatus($experiment, ['running'], 'Only a running A/B test can be stopped.');

            return Experiments::update($content, $experimentId, ['status' => 'stopped', 'ended_at' => self::now()]);
        });
    }

    public function keep(BuilderDocument $document, int $revision, string $experimentId, string $arm): BuilderDocument
    {
        return $this->change($document, $revision, $experimentId, 'storefront.builder_experiment_kept', function (array $content, array $experiment) use ($experimentId, $arm) {
            $this->assertStatus($experiment, ['draft', 'running', 'stopped'], 'This A/B test has already ended.');

            return Experiments::keep($content, $experimentId, $arm, self::now());
        }, ['arm' => $arm]);
    }

    /**
     * @param  callable(array<string, mixed>, array<string, mixed>): array<string, mixed>  $apply
     * @param  array<string, mixed>  $extra  audit context
     */
    private function change(BuilderDocument $document, int $revision, string $experimentId, string $event, callable $apply, array $extra = []): BuilderDocument
    {
        return DB::transaction(function () use ($document, $revision, $experimentId, $event, $apply, $extra) {
            $locked = BuilderDocument::query()->whereKey($document->id)->lockForUpdate()->firstOrFail();
            if ($locked->draft_revision !== $revision) {
                throw new BusinessRuleViolation('DRAFT_CONFLICT', 'This page was changed elsewhere since you opened it. Reload it to continue.', ['revision' => $locked->draft_revision], 409);
            }
            $content = is_array($locked->draft) ? $locked->draft : [];
            $found = Experiments::find($content, $experimentId);
            if ($found === null) {
                throw new BusinessRuleViolation('EXPERIMENT_NOT_FOUND', 'This A/B test does not exist on this page.', [], 404);
            }
            $before = $found[1];
            $content = ($this->prepare)($apply($content, $before), $locked->contentContext(), $locked->isGlobal());
            $after = Experiments::find($content, $experimentId)[1] ?? null;

            $locked->draft = $content;
            $locked->draft_revision++;
            $locked->draft_updated_at = CarbonImmutable::now();
            $locked->draft_updated_by = StaffActor::id();
            $locked->save();
            $this->audit->record($event, $locked, self::audited($before), self::audited($after) + $extra + [
                'experiment_id' => $experimentId,
                'draft_revision' => $locked->draft_revision,
            ]);

            return $locked;
        });
    }

    /**
     * @param  array<string, mixed>  $experiment
     * @param  list<string>  $allowed
     */
    private function assertStatus(array $experiment, array $allowed, string $message): void
    {
        if (! in_array($experiment['status'] ?? null, $allowed, true)) {
            throw new BusinessRuleViolation('EXPERIMENT_STATUS', $message, ['status' => $experiment['status'] ?? null]);
        }
    }

    /**
     * @param  array<string, mixed>|null  $experiment
     * @return array<string, mixed>
     */
    private static function audited(?array $experiment): array
    {
        return $experiment === null ? [] : array_intersect_key($experiment, array_flip(['name', ...Experiments::MANAGED]));
    }

    private static function now(): string
    {
        return CarbonImmutable::now('UTC')->format('Y-m-d\TH:i:s\Z');
    }
}
