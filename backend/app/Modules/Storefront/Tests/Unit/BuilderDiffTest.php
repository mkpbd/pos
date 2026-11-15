<?php

namespace App\Modules\Storefront\Tests\Unit;

use App\Modules\Storefront\Domain\Builder\BuilderDiff;
use PHPUnit\Framework\TestCase;

/**
 * B11: the change list between two builder documents.
 */
class BuilderDiffTest extends TestCase
{
    /**
     * @param  list<array<string, mixed>>  $elements
     * @return array<string, mixed>
     */
    private static function section(string $id, array $elements, array $extra = []): array
    {
        return $extra + ['id' => $id, 'type' => 'section', 'props' => [], 'columns' => [['id' => 'c'.$id, 'type' => 'column', 'width' => ['base' => 100], 'elements' => $elements]]];
    }

    private static function el(string $id, string $type, array $props, array $extra = []): array
    {
        return $extra + ['id' => $id, 'type' => $type, 'props' => $props, 'translations' => []];
    }

    public function test_added_removed_changed_and_moved(): void
    {
        $from = ['schema_version' => 1, 'seo' => ['title' => 'Old'], 'sections' => [
            self::section('s_a', [
                self::el('e_h', 'heading', ['text' => 'Hello']),
                self::el('e_t', 'text', ['html' => '<p>Gone <b>soon</b></p>']),
                self::el('e_b', 'button', ['label' => 'Go', 'link' => ['url' => '/shop']]),
            ]),
            self::section('s_b', [self::el('e_i', 'image', ['media_id' => 'm1', 'alt' => 'Cat'])]),
        ]];
        $to = ['schema_version' => 1, 'seo' => ['title' => 'New'], 'sections' => [
            self::section('s_b', [
                self::el('e_i', 'image', ['media_id' => 'm2', 'alt' => 'Cat'], ['style' => ['base' => ['padding' => '4px']]]),
                self::el('e_b', 'button', ['label' => 'Go', 'link' => ['url' => '/sale']]),
            ]),
            self::section('s_a', [
                self::el('e_h', 'heading', ['text' => 'Hello'], ['translations' => ['bn' => ['text' => 'হ্যালো']]]),
                self::el('e_new', 'gallery', ['items' => [['id' => 'i1', 'media_id' => 'm3']]]),
            ], ['hidden' => true]),
        ]];

        $diff = BuilderDiff::compare($from, $to);

        $this->assertSame([['id' => 'e_new', 'type' => 'gallery', 'kind' => 'element', 'parent_id' => 'cs_a', 'label' => null]], $diff['added']);
        $this->assertSame([['id' => 'e_t', 'type' => 'text', 'kind' => 'element', 'parent_id' => 'cs_a', 'label' => 'Gone soon']], $diff['removed']);
        $changed = [];
        foreach ($diff['changed'] as $entry) {
            $changed[$entry['node_id'] ?? 'document'] = $entry['fields'];
        }
        $this->assertSame([['field' => 'seo.title', 'before' => 'Old', 'after' => 'New']], $changed['document']);
        $this->assertSame([['field' => 'style', 'before' => null, 'after' => null], ['field' => 'props.media_id', 'before' => 'm1', 'after' => 'm2']], $changed['e_i']);
        $this->assertSame([['field' => 'props.link.url', 'before' => '/shop', 'after' => '/sale']], $changed['e_b']);
        $this->assertSame([['field' => 'translations.bn.text', 'before' => null, 'after' => 'হ্যালো']], $changed['e_h']);
        $this->assertSame([['field' => 'hidden', 'before' => null, 'after' => true]], $changed['s_a']);
        // e_b changed column; s_b and s_a swapped (one of them counts as moved).
        $this->assertSame(['e_b', 's_a'], $diff['moved']);
    }

    public function test_identical_documents_have_no_changes(): void
    {
        $doc = ['sections' => [self::section('s_a', [self::el('e_h', 'heading', ['text' => 'Same'])])]];
        $reordered = ['sections' => [['columns' => $doc['sections'][0]['columns'], 'props' => [], 'type' => 'section', 'id' => 's_a']]];

        $this->assertSame(['added' => [], 'removed' => [], 'changed' => [], 'moved' => []], BuilderDiff::compare($doc, $reordered));
        $this->assertSame(3, count(BuilderDiff::compare(['sections' => []], $doc)['added']));
    }

    public function test_long_texts_are_cut_and_plain(): void
    {
        $from = ['sections' => [self::section('s_a', [self::el('e_t', 'text', ['html' => '<p>short</p>'])])]];
        $to = ['sections' => [self::section('s_a', [self::el('e_t', 'text', ['html' => '<p>'.str_repeat('a', 400).'</p>'])])]];

        $after = BuilderDiff::compare($from, $to)['changed'][0]['fields'][0]['after'];
        $this->assertSame(BuilderDiff::MAX_TEXT, mb_strlen($after));
        $this->assertStringEndsWith('…', $after);
        $this->assertSame('short', BuilderDiff::compare($from, $to)['changed'][0]['fields'][0]['before']);
    }
}
