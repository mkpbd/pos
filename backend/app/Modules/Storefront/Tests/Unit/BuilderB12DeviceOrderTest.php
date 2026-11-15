<?php

namespace App\Modules\Storefront\Tests\Unit;

use App\Modules\Storefront\Domain\Builder\BuilderDiff;
use App\Modules\Storefront\Domain\Builder\BuilderDocumentSchema;
use App\Modules\Storefront\Domain\Builder\BuilderJson;
use App\Modules\Storefront\Domain\Builder\InvalidBuilderDocument;
use Tests\TestCase;

/**
 * B12: the order on tablets and phones (`device_order`) — validation, normalization and the
 * compare list's `device_moved`.
 */
class BuilderB12DeviceOrderTest extends TestCase
{
    /**
     * @param  list<array<string, mixed>>  $elements
     */
    private static function section(string $id, array $elements): array
    {
        return ['id' => $id, 'type' => 'section', 'columns' => [['id' => 'c'.$id, 'width' => ['base' => 100], 'elements' => $elements]]];
    }

    private static function heading(string $id): array
    {
        return ['id' => $id, 'type' => 'heading', 'props' => ['text' => 'Text '.$id, 'level' => 2]];
    }

    /**
     * Sections s_a (e_1, e_2, e_3), s_b (one inner row with two columns: e_4 e_5 | e_6), s_c (empty).
     *
     * @return array<string, mixed>
     */
    private static function document(?array $deviceOrder = null): array
    {
        $inner = ['id' => 'e_row', 'type' => 'inner_row', 'columns' => [
            ['id' => 'c_in1', 'width' => ['base' => 50], 'elements' => [self::heading('e_4'), self::heading('e_5')]],
            ['id' => 'c_in2', 'width' => ['base' => 50], 'elements' => [self::heading('e_6')]],
        ]];

        return ['schema_version' => 1, 'sections' => [
            self::section('s_a', [self::heading('e_1'), self::heading('e_2'), self::heading('e_3')]),
            self::section('s_b', [$inner]),
            self::section('s_c', []),
        ]] + ($deviceOrder === null ? [] : ['device_order' => $deviceOrder]);
    }

    public function test_documents_without_an_order_normalize_as_before(): void
    {
        $normalized = BuilderDocumentSchema::normalize(self::document());
        $this->assertArrayNotHasKey('device_order', $normalized);
        $this->assertArrayNotHasKey('device_order', BuilderDocumentSchema::normalize(self::document([])));
        $this->assertArrayNotHasKey('device_order', BuilderDocumentSchema::normalize(self::document(['tablet' => [], 'mobile' => null])));
    }

    public function test_orders_are_fitted_to_the_children_and_kept_canonical(): void
    {
        $normalized = BuilderDocumentSchema::normalize(self::document([
            'mobile' => [
                // Gone ids dropped, missing children appended in base order.
                'cs_a' => ['e_3', 'e_gone', 'e_1'],
                // Inner-row columns are containers too.
                'c_in1' => ['e_5', 'e_4'],
                // One child: nothing to order.
                'c_in2' => ['e_6'],
                // A column that no longer exists.
                'c_gone' => ['e_1', 'e_2'],
                // Same as the tablet order: inherited.
                'root' => ['s_c', 's_a', 's_b'],
            ],
            'tablet' => [
                'root' => ['s_c', 's_a'],
                // Same as desktop: inherited.
                'cs_a' => ['e_1', 'e_2', 'e_3'],
            ],
        ]));

        $this->assertSame([
            'tablet' => ['root' => ['s_c', 's_a', 's_b']],
            'mobile' => ['cs_a' => ['e_3', 'e_1', 'e_2'], 'c_in1' => ['e_5', 'e_4']],
        ], $normalized['device_order']);
        $this->assertSame(['schema_version', 'sections', 'device_order'], array_keys($normalized));
        $this->assertSame($normalized, BuilderDocumentSchema::normalize($normalized), 'normalize is idempotent');

        // A phone order equal to desktop while the tablet differs is the phone's own.
        $own = BuilderDocumentSchema::normalize(self::document(['tablet' => ['root' => ['s_b', 's_a', 's_c']], 'mobile' => ['root' => ['s_a', 's_b', 's_c']]]));
        $this->assertSame(['s_a', 's_b', 's_c'], $own['device_order']['mobile']['root']);
    }

    public function test_malformed_orders_are_refused(): void
    {
        $cases = [
            [['s_a'], 'device_order'],
            ['phones', 'device_order'],
            [['desktop' => ['root' => ['s_a']]], 'device_order.desktop'],
            [['tablet' => ['s_a', 's_b']], 'device_order.tablet'],
            [['tablet' => ['Bad Id!' => ['s_a']]], 'device_order.tablet.Bad Id!'],
            [['tablet' => ['root' => 's_a']], 'device_order.tablet.root'],
            [['tablet' => ['root' => ['s_a', 3]]], 'device_order.tablet.root'],
            [['mobile' => ['cs_a' => ['e_1', 'e_1']]], 'device_order.mobile.cs_a'],
        ];
        foreach ($cases as [$order, $path]) {
            try {
                BuilderDocumentSchema::normalize(self::document(is_array($order) ? $order : null) + (is_array($order) ? [] : ['device_order' => $order]));
                $this->fail('Expected an invalid document for '.json_encode($order));
            } catch (InvalidBuilderDocument $e) {
                $this->assertSame($path, $e->errors[0]['path'], json_encode($order));
                $this->assertSame('DEVICE_ORDER_INVALID', $e->errors[0]['code']);
            }
        }
    }

    public function test_presenting_restores_the_document_order_of_containers(): void
    {
        $normalized = BuilderDocumentSchema::normalize(self::document(['tablet' => ['cs_a' => ['e_2', 'e_1'], 'root' => ['s_b', 's_a', 's_c']]]));
        // jsonb sorts object keys; presenting puts root first again.
        $stored = $normalized;
        $stored['device_order']['tablet'] = ['cs_a' => ['e_2', 'e_1', 'e_3'], 'root' => ['s_b', 's_a', 's_c']];
        $this->assertSame(['root', 'cs_a'], array_keys(BuilderJson::present($stored)['device_order']['tablet']));
    }

    public function test_the_compare_list_reports_moves_per_device(): void
    {
        $from = BuilderDocumentSchema::normalize(self::document(['mobile' => ['cs_a' => ['e_3', 'e_1', 'e_2']]]));
        $to = BuilderDocumentSchema::normalize(self::document([
            'tablet' => ['root' => ['s_c', 's_a', 's_b']],
            'mobile' => ['cs_a' => ['e_1', 'e_3', 'e_2']],
        ]));

        $diff = BuilderDiff::compare($from, $to);
        $this->assertSame([], $diff['moved'], 'The desktop order did not change.');
        $this->assertSame([], $diff['changed'], 'The order is not a page-level change.');
        // In the new document's order; the fewest nodes (outside the longest common order).
        $this->assertSame([
            ['id' => 'e_3', 'device' => 'mobile'],
            ['id' => 's_c', 'device' => 'tablet'],
        ], $diff['device_moved']);
        // The phone follows the tablet's new root order without an order of its own: not listed twice.
        $this->assertNotContains(['id' => 's_c', 'device' => 'mobile'], $diff['device_moved']);

        $this->assertSame([], BuilderDiff::compare($to, $to)['device_moved']);
        $this->assertSame([], BuilderDiff::compare(self::document(), self::document())['device_moved']);
    }
}
