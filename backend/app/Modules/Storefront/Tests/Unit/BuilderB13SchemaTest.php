<?php

namespace App\Modules\Storefront\Tests\Unit;

use App\Modules\Storefront\Domain\Builder\AudienceRules;
use App\Modules\Storefront\Domain\Builder\BuilderDocumentSchema;
use App\Modules\Storefront\Domain\Builder\Experiments;
use App\Modules\Storefront\Domain\Builder\InvalidBuilderDocument;
use Tests\TestCase;

/**
 * B13: audiences and A/B tests in the document format — canonical, idempotent, kept only when
 * set; the pure helpers of the test actions.
 */
class BuilderB13SchemaTest extends TestCase
{
    /**
     * @return array<string, mixed>
     */
    private static function section(string $id, array $extra = []): array
    {
        return $extra + ['id' => $id, 'type' => 'section', 'columns' => [['id' => 'c'.$id, 'width' => ['base' => 100], 'elements' => [
            ['id' => 'e'.$id, 'type' => 'heading', 'props' => ['text' => 'Hi']],
        ]]]];
    }

    public function test_audience_and_experiments_normalize_idempotently(): void
    {
        $document = ['schema_version' => 1, 'sections' => [
            self::section('s_a', ['experiment' => ['id' => 'x_1', 'arm' => 'A'], 'audience' => ['rules' => [
                ['kind' => 'campaign', 'utm_campaign' => ['Eid-Sale', 'eid-sale']],
                ['kind' => 'time', 'days' => ['sun', 'mon']],
                ['kind' => 'cart', 'max' => '99.5'],
            ]]]),
            self::section('s_b', ['experiment' => ['id' => 'x_1', 'arm' => 'B']]),
        ], 'experiments' => [['id' => 'x_1', 'name' => 'Test']]];
        $once = BuilderDocumentSchema::normalize($document);
        $this->assertSame($once, BuilderDocumentSchema::normalize($once));
        $this->assertSame([
            ['kind' => 'campaign', 'in' => [], 'utm_source' => [], 'utm_campaign' => ['eid-sale']],
            ['kind' => 'time', 'days' => ['mon', 'sun'], 'from' => null, 'to' => null],
            ['kind' => 'cart', 'min' => null, 'max' => '99.50'],
        ], $once['sections'][0]['audience']['rules']);
        $this->assertSame([['id' => 'x_1', 'name' => 'Test', 'status' => 'draft', 'goal' => 'orders', 'split' => 50, 'started_at' => null, 'ended_at' => null, 'winner' => null]], $once['experiments']);

        // Older documents are unchanged; null audiences and empty test lists are dropped.
        $plain = BuilderDocumentSchema::normalize(['sections' => [self::section('s_a', ['audience' => null])], 'experiments' => []]);
        $this->assertArrayNotHasKey('audience', $plain['sections'][0]);
        $this->assertArrayNotHasKey('experiments', $plain);

        // Audiences are fine in global sections, A/B tests are not.
        $this->assertArrayHasKey('audience', BuilderDocumentSchema::normalize(['sections' => [self::section('s_a', ['audience' => ['rules' => [['kind' => 'language', 'in' => ['en']]]]])]], 'page', true)['sections'][0]);
        try {
            BuilderDocumentSchema::normalize(['sections' => [self::section('s_a', ['experiment' => ['id' => 'x_1', 'arm' => 'A']])], 'experiments' => [['id' => 'x_1', 'name' => 'T']]], 'page', true);
            $this->fail('A global section cannot be part of a test.');
        } catch (InvalidBuilderDocument $e) {
            $this->assertSame(['sections.0.experiment', 'experiments'], array_column($e->errors, 'path'));
        }
    }

    public function test_money_and_rules(): void
    {
        $this->assertSame('1500.00', AudienceRules::money('1500'));
        $this->assertSame('0.50', AudienceRules::money('0.5'));
        $this->assertSame('42.00', AudienceRules::money(42));
        $this->assertNull(AudienceRules::money(12.5));
        $this->assertNull(AudienceRules::money('-1'));
        $this->assertNull(AudienceRules::money('1.234'));
        $this->assertNull(AudienceRules::money('100000000'));

        $errors = [];
        $audience = AudienceRules::normalize(['match' => 'all', 'rules' => [['kind' => 'time', 'from' => '10:00', 'to' => '10:00'], ['kind' => 'district', 'in' => [1, 1]]]], function (string $path, string $message) use (&$errors) {
            $errors[] = $path;
        });
        $this->assertSame(['audience.rules.0.to', 'audience.rules.1.in'], $errors);
        $this->assertSame([], $audience['rules']);
    }

    public function test_managed_fields_and_keep(): void
    {
        $stored = ['experiments' => [['id' => 'x_1', 'status' => 'running', 'started_at' => '2026-11-01T00:00:00Z', 'ended_at' => null, 'winner' => null]]];
        $sent = ['experiments' => [
            ['id' => 'x_1', 'name' => 'A', 'status' => 'ended', 'winner' => 'B'],
            ['id' => 'x_2', 'name' => 'B', 'status' => 'running', 'started_at' => '2026-11-02T00:00:00Z'],
        ]];
        $merged = Experiments::withManagedFields($sent, $stored);
        $this->assertSame(['running', '2026-11-01T00:00:00Z', null], [$merged['experiments'][0]['status'], $merged['experiments'][0]['started_at'], $merged['experiments'][0]['winner']]);
        $this->assertSame(['draft', null], [$merged['experiments'][1]['status'], $merged['experiments'][1]['started_at']]);

        $content = BuilderDocumentSchema::normalize(['sections' => [
            self::section('s_top'),
            self::section('s_a', ['experiment' => ['id' => 'x_1', 'arm' => 'A']]),
            self::section('s_b', ['experiment' => ['id' => 'x_1', 'arm' => 'B']]),
            self::section('s_b2', ['experiment' => ['id' => 'x_1', 'arm' => 'B']]),
        ], 'experiments' => [['id' => 'x_1', 'name' => 'T']], 'device_order' => ['mobile' => ['root' => ['s_b2', 's_b', 's_a', 's_top']]]]);
        $this->assertSame(['A' => ['s_a'], 'B' => ['s_b', 's_b2']], Experiments::armSections($content, 'x_1'));
        $kept = BuilderDocumentSchema::normalize(Experiments::keep($content, 'x_1', 'A', '2026-11-19T00:00:00Z'));
        $this->assertSame(['s_top', 's_a'], array_column($kept['sections'], 'id'));
        $this->assertArrayNotHasKey('experiment', $kept['sections'][1]);
        $this->assertSame(['ended', 'A', '2026-11-19T00:00:00Z'], [$kept['experiments'][0]['status'], $kept['experiments'][0]['winner'], $kept['experiments'][0]['ended_at']]);
        $this->assertSame(['mobile' => ['root' => ['s_a', 's_top']]], $kept['device_order']);
        $this->assertSame([['id' => 'x_1', 'status' => 'ended', 'split' => 50, 'winner' => 'A']], Experiments::public($kept['experiments']));
    }
}
