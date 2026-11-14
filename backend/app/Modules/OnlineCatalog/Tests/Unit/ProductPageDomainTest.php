<?php

namespace App\Modules\OnlineCatalog\Tests\Unit;

use App\Modules\OnlineCatalog\Domain\CategoryTree;
use App\Modules\OnlineCatalog\Domain\CoPurchaseCounter;
use App\Modules\Shared\Domain\VideoUrl;
use App\Modules\Shipping\Domain\DeliveryOverview;
use PHPUnit\Framework\TestCase;

/**
 * P1b: the pure rules behind the product page — co-purchase scores, the category chain of
 * targeted zones, video links and the delivery note's zone lines.
 */
class ProductPageDomainTest extends TestCase
{
    public function test_pairs_bought_together_twice_or_more_are_kept_in_both_directions_best_first(): void
    {
        $counter = new CoPurchaseCounter;
        $counter->add(['shirt', 'rice', 'juice']);
        $counter->add(['shirt', 'rice']);
        $counter->add(['rice', 'shirt', 'rice']); // duplicates count once
        $counter->add(['shirt', 'juice']);
        $counter->add(['tea']); // one product: no pair
        $counter->add(['juice', 'rice']); // juice + rice: 2

        $rows = $counter->affinities();
        $scores = [];
        foreach ($rows as $row) {
            $scores[$row['product_id']][$row['related_product_id']] = $row['score'];
        }

        $this->assertSame(['rice' => 3, 'juice' => 2], $scores['shirt']);
        $this->assertSame(['shirt' => 3, 'juice' => 2], $scores['rice']);
        // Equal scores: by id, so the order never changes between runs.
        $this->assertSame(['rice' => 2, 'shirt' => 2], $scores['juice']);
        $this->assertArrayNotHasKey('tea', $scores);
        $this->assertCount(6, $rows);
    }

    public function test_bulk_baskets_and_single_pairs_are_left_out_and_each_product_keeps_its_best_twenty(): void
    {
        $counter = new CoPurchaseCounter;
        $bulk = array_map(fn (int $i) => "bulk-{$i}", range(1, CoPurchaseCounter::MAX_BASKET + 1));
        $counter->add($bulk);
        $counter->add($bulk);
        $this->assertSame([], $counter->affinities(), 'Baskets of more than 30 products say little about what goes together.');

        $counter = new CoPurchaseCounter;
        $counter->add(['a', 'b']);
        $this->assertSame([], $counter->affinities(), 'Bought together once is not enough.');

        $counter = new CoPurchaseCounter;
        foreach (range(1, 25) as $i) {
            $other = sprintf('p%02d', $i);
            foreach (range(1, $i % 5 + 2) as $_) {
                $counter->add(['hub', $other]);
            }
        }
        $hub = array_values(array_filter($counter->affinities(), fn (array $r) => $r['product_id'] === 'hub'));
        $this->assertCount(CoPurchaseCounter::MAX_PER_PRODUCT, $hub);
        $this->assertSame(6, $hub[0]['score']);
        $this->assertSame(['p04', 'p09', 'p14', 'p19', 'p24'], array_slice(array_column($hub, 'related_product_id'), 0, 5));
    }

    public function test_a_category_chain_runs_from_the_category_up_to_the_root(): void
    {
        $tree = new CategoryTree([
            ['id' => 'apparel', 'parent_id' => null, 'name' => 'Apparel', 'sort_order' => 0, 'is_active' => true],
            ['id' => 'shirts', 'parent_id' => 'apparel', 'name' => 'Shirts', 'sort_order' => 0, 'is_active' => false],
            ['id' => 'oxford', 'parent_id' => 'shirts', 'name' => 'Oxford', 'sort_order' => 0, 'is_active' => true],
        ], ['apparel']);

        $this->assertSame(['oxford', 'shirts', 'apparel'], $tree->selfAndAncestors('oxford'));
        $this->assertSame(['apparel'], $tree->selfAndAncestors('apparel'));
        $this->assertSame([], $tree->selfAndAncestors('unknown'));
    }

    public function test_video_links_of_youtube_and_vimeo(): void
    {
        $this->assertSame(['provider' => 'youtube', 'video_id' => 'dQw4w9WgXcQ'], VideoUrl::parse('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10'));
        $this->assertSame(['provider' => 'youtube', 'video_id' => 'dQw4w9WgXcQ'], VideoUrl::parse('https://youtu.be/dQw4w9WgXcQ'));
        $this->assertSame(['provider' => 'youtube', 'video_id' => 'abcDEF12345'], VideoUrl::parse('https://youtube.com/shorts/abcDEF12345'));
        $this->assertSame(['provider' => 'vimeo', 'video_id' => '76979871'], VideoUrl::parse('https://vimeo.com/76979871'));
        foreach (['https://example.com/video.mp4', 'javascript:alert(1)', 'https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ', null, 'https://youtu.be/'.str_repeat('a', 600)] as $bad) {
            $this->assertNull(VideoUrl::parse($bad), (string) $bad);
        }
    }

    public function test_a_zone_line_names_its_method_and_shares_only_what_its_methods_agree_on(): void
    {
        $standard = ['name' => 'Standard', 'fee' => '60', 'free_over' => '2000.00', 'cod_allowed' => true, 'eta_min_days' => 1, 'eta_max_days' => 2];

        $this->assertSame(
            ['zone' => 'Inside Dhaka', 'method' => 'Standard', 'min_days' => 1, 'max_days' => 2, 'fee' => '60.00', 'free_over' => '2000.00', 'cod_allowed' => true],
            DeliveryOverview::zone('Inside Dhaka', [$standard]),
        );

        $express = ['name' => 'Express', 'fee' => '150.00', 'free_over' => null, 'cod_allowed' => false, 'eta_min_days' => 0, 'eta_max_days' => 1];
        $this->assertSame(
            ['zone' => 'Inside Dhaka', 'method' => null, 'min_days' => 0, 'max_days' => 2, 'fee' => null, 'free_over' => null, 'cod_allowed' => true],
            DeliveryOverview::zone('Inside Dhaka', [$standard, $express]),
        );

        // Same fee and threshold on every method: still shown; no method allowing COD: false.
        $same = DeliveryOverview::zone('Outside Dhaka', [
            ['name' => 'Courier A', 'fee' => '120.00', 'free_over' => null, 'cod_allowed' => false, 'eta_min_days' => 3, 'eta_max_days' => 5],
            ['name' => 'Courier B', 'fee' => '120', 'free_over' => null, 'cod_allowed' => false, 'eta_min_days' => 2, 'eta_max_days' => 6],
        ]);
        $this->assertSame([null, 2, 6, '120.00', null, false], [$same['method'], $same['min_days'], $same['max_days'], $same['fee'], $same['free_over'], $same['cod_allowed']]);
    }
}
