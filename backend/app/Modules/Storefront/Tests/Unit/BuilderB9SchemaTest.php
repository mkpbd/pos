<?php

namespace App\Modules\Storefront\Tests\Unit;

use App\Modules\Storefront\Domain\Builder\BuilderDocumentSchema;
use App\Modules\Storefront\Domain\Builder\BuilderJson;
use App\Modules\Storefront\Domain\Builder\InvalidBuilderDocument;
use App\Modules\Storefront\Domain\Builder\StyleSchema;
use Tests\TestCase;

/**
 * B9: the `global_section` reference node, global section content (one section, no references,
 * no seo, no sticky), page `seo`, the motion additions (entrances, repeat, stagger, loops), the
 * `hover` group and section background parallax — and the cross-side fixture sample-b9.v1.json,
 * which the storefront validates with the same expectations.
 */
class BuilderB9SchemaTest extends TestCase
{
    private const FIXTURE = '../frontend/src/storefront/builder/__fixtures__/sample-b9.v1.json';

    private const REF = '0199a5c1-0000-7000-8000-00000000dd01';

    private const MEDIA = '0199a5c1-0000-7000-8000-00000000aa01';

    /**
     * @return array<string, mixed>
     */
    private function section(string $id = 's_x', array $extra = []): array
    {
        return $extra + ['id' => $id, 'type' => 'section', 'columns' => [['id' => 'c_'.substr($id, 2), 'width' => ['base' => 100], 'elements' => []]]];
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function errors(array $document, string $context = 'page', bool $global = false): array
    {
        try {
            BuilderDocumentSchema::normalize($document, $context, $global);
        } catch (InvalidBuilderDocument $e) {
            return $e->errors;
        }
        $this->fail('The document was accepted.');
    }

    public function test_the_shared_fixture_round_trips_unchanged(): void
    {
        $json = (string) file_get_contents(base_path(self::FIXTURE));
        $fixture = json_decode($json, true, 512, JSON_THROW_ON_ERROR);
        $normalized = BuilderDocumentSchema::normalize($fixture, 'page');

        $this->assertSame(
            json_encode(json_decode($json), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            json_encode(BuilderJson::present($normalized), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        );
        $this->assertSame($normalized, BuilderDocumentSchema::normalize($normalized, 'page'));
        $this->assertSame([self::REF, '0199a5c1-0000-7000-8000-00000000dd02'], BuilderDocumentSchema::globalRefs($normalized));
    }

    public function test_global_section_references(): void
    {
        $ref = ['id' => 'g_one', 'type' => 'global_section', 'ref' => strtoupper(self::REF), 'extra' => 1];
        foreach (['page', 'cms', 'zone', 'header', 'footer'] as $context) {
            $doc = BuilderDocumentSchema::normalize(['sections' => [$ref, $this->section()]], $context);
            $this->assertSame(['id' => 'g_one', 'type' => 'global_section', 'ref' => self::REF, 'hidden' => false, 'schedule' => null], $doc['sections'][0], $context);
        }

        $popup = $this->errors(['schema_version' => 1, 'popup' => [], 'sections' => [$ref]], 'popup');
        $this->assertSame(['sections.0.type', 'GLOBAL_NOT_ALLOWED'], [$popup[0]['path'], $popup[0]['code']]);
        // Inside a global section, and with a bad ref, hidden or schedule.
        $nested = $this->errors(['sections' => [$ref]], 'page', true);
        $this->assertSame('A global section cannot contain another global section.', $nested[0]['message']);
        $bad = $this->errors(['sections' => [['id' => 'g_bad', 'type' => 'global_section', 'ref' => 'nope', 'hidden' => 'yes', 'schedule' => ['starts_at' => 'tomorrow']]]]);
        $this->assertSame(['sections.0.ref', 'sections.0.hidden', 'sections.0.schedule.starts_at'], array_column($bad, 'path'));
        // Ids stay unique across references and sections.
        $duplicate = $this->errors(['sections' => [$ref, $this->section('g_one')]]);
        $this->assertSame('The id "g_one" is used more than once.', $duplicate[0]['message']);
    }

    public function test_global_section_content_is_one_section_without_sticky_or_seo(): void
    {
        $one = BuilderDocumentSchema::normalize(['sections' => [$this->section()]], 'header', true);
        $this->assertCount(1, $one['sections']);
        $this->assertSame([['path' => 'sections', 'node_id' => null, 'message' => 'A global section holds exactly one section.']], $this->errors(['sections' => [$this->section(), $this->section('s_y')]], 'page', true));
        $this->assertSame('A global section holds exactly one section.', $this->errors(['sections' => []], 'page', true)[0]['message']);
        $this->assertSame('A global section cannot stick to the top.', $this->errors(['sections' => [$this->section('s_x', ['props' => ['sticky' => true]])]], 'page', true)[0]['message']);
        $this->assertSame('seo', $this->errors(['seo' => ['title' => 'x'], 'sections' => [$this->section()]], 'page', true)[0]['path']);
        // Elements follow the global's context.
        $logo = ['id' => 's_x', 'type' => 'section', 'columns' => [['id' => 'c_x', 'width' => ['base' => 100], 'elements' => [['id' => 'e_logo', 'type' => 'logo']]]]];
        $this->assertSame('ELEMENT_NOT_ALLOWED', $this->errors(['sections' => [$logo]], 'page', true)[0]['code']);
        $this->assertCount(1, BuilderDocumentSchema::normalize(['sections' => [$logo]], 'header', true)['sections']);
    }

    public function test_page_seo(): void
    {
        $doc = BuilderDocumentSchema::normalize(['seo' => [
            'description' => '  ', 'title' => 'Eid sale', 'noindex' => true, 'image' => ['media_id' => strtoupper(self::MEDIA)],
            'translations' => ['bn' => ['title' => 'ঈদ সেল', 'description' => ''], 'fr' => ['title' => 'Soldes']], 'extra' => 1,
        ], 'sections' => []], 'cms');
        $this->assertSame(['schema_version', 'seo', 'sections'], array_keys($doc));
        $this->assertSame(['title' => 'Eid sale', 'description' => null, 'image' => ['media_id' => self::MEDIA], 'noindex' => true, 'translations' => ['bn' => ['title' => 'ঈদ সেল']]], $doc['seo']);
        // Null or absent: no key (older documents unchanged).
        $this->assertSame(['schema_version' => 1, 'sections' => []], BuilderDocumentSchema::normalize(['seo' => null, 'sections' => []]));
        $this->assertSame(['title' => null, 'description' => null, 'image' => null, 'noindex' => false, 'translations' => []], BuilderDocumentSchema::normalize(['seo' => [], 'sections' => []])['seo']);
        $this->assertEquals(new \stdClass, BuilderJson::present(BuilderDocumentSchema::normalize(['seo' => [], 'sections' => []]))['seo']['translations']);

        $limits = $this->errors(['seo' => ['title' => str_repeat('a', 71), 'description' => str_repeat('b', 161), 'image' => ['media_id' => 'x'], 'noindex' => 'no', 'translations' => ['bn' => ['title' => str_repeat('ক', 71)]]], 'sections' => []]);
        $this->assertSame(['seo.title', 'seo.description', 'seo.image', 'seo.noindex', 'seo.translations.bn.title'], array_column($limits, 'path'));
        $longest = BuilderDocumentSchema::normalize(['seo' => ['title' => str_repeat('a', 70), 'description' => str_repeat('b', 160)], 'sections' => []])['seo'];
        $this->assertSame([70, 160], [mb_strlen($longest['title']), mb_strlen($longest['description'])]);
        foreach (['header', 'footer', 'zone'] as $context) {
            $this->assertSame('Only pages and content pages have search and sharing settings.', $this->errors(['seo' => ['title' => 'x'], 'sections' => []], $context)[0]['message'], $context);
        }
        $this->assertSame('seo', $this->errors(['seo' => 'x', 'sections' => []])[0]['path']);
    }

    public function test_motion_hover_and_parallax(): void
    {
        $style = [
            'base' => [
                'background' => ['type' => 'image', 'image' => ['media_id' => self::MEDIA], 'parallax' => 'medium'],
                'motion' => ['entrance' => 'flip-left', 'duration' => 300, 'repeat' => 'every_time', 'stagger_children' => 500, 'loop' => 'shake', 'loop_forever' => true, 'x' => 1],
                'hover' => ['effect' => 'shrink', 'duration' => 600, 'x' => 1],
            ],
            'tablet' => ['background' => ['type' => 'color', 'color' => '#ffffff', 'parallax' => 'slow'], 'motion' => ['entrance' => 'fade'], 'hover' => ['effect' => 'grow']],
        ];
        // A section keeps everything (parallax at base only).
        $this->assertSame([
            'base' => [
                'background' => ['type' => 'image', 'image' => ['media_id' => self::MEDIA], 'parallax' => 'medium'],
                'motion' => ['entrance' => 'flip-left', 'duration' => 300, 'repeat' => 'every_time', 'stagger_children' => 500, 'loop' => 'shake', 'loop_forever' => true],
                'hover' => ['effect' => 'shrink', 'duration' => 600],
            ],
            'tablet' => ['background' => ['type' => 'color', 'color' => '#ffffff']],
        ], StyleSchema::normalize($style, true, true));
        // An inner row: no parallax; an element: no stagger either.
        $this->assertArrayNotHasKey('parallax', StyleSchema::normalize($style, true)['base']['background']);
        $element = StyleSchema::normalize($style);
        $this->assertSame(['entrance' => 'flip-left', 'duration' => 300, 'repeat' => 'every_time', 'loop' => 'shake', 'loop_forever' => true], $element['base']['motion']);

        // Out-of-range or unknown values are dropped; a group without its required key is gone.
        $this->assertSame(['base' => ['motion' => ['entrance' => 'none']]], StyleSchema::normalize(['base' => [
            'motion' => ['entrance' => 'none', 'repeat' => 'always', 'stagger_children' => 501, 'loop' => 'spin', 'loop_forever' => 'yes'],
            'hover' => ['effect' => 'spin', 'duration' => 200],
        ]], true));
        $this->assertSame(['base' => ['hover' => ['effect' => 'glow']]], StyleSchema::normalize(['base' => ['hover' => ['effect' => 'glow', 'duration' => 99]]]));
        $this->assertSame([], StyleSchema::normalize(['base' => ['hover' => ['effect' => 'lift', 'duration' => 601]], 'mobile' => ['hover' => ['effect' => 'lift']]])['mobile'] ?? []);
        foreach (StyleSchema::MOTION_ENTRANCES as $entrance) {
            $this->assertSame($entrance, StyleSchema::normalize(['base' => ['motion' => ['entrance' => $entrance]]])['base']['motion']['entrance']);
        }

        // Through the document: sections get parallax, inner rows stagger, elements neither.
        $doc = BuilderDocumentSchema::normalize(['sections' => [[
            'id' => 's_x', 'type' => 'section', 'style' => ['base' => ['background' => ['type' => 'none', 'parallax' => 'slow'], 'motion' => ['entrance' => 'fade', 'stagger_children' => 100]]],
            'columns' => [['id' => 'c_x', 'width' => ['base' => 100], 'style' => ['base' => ['motion' => ['entrance' => 'fade', 'stagger_children' => 100]]], 'elements' => [[
                'id' => 'e_row', 'type' => 'inner_row', 'style' => ['base' => ['background' => ['type' => 'none', 'parallax' => 'slow'], 'motion' => ['entrance' => 'zoom', 'stagger_children' => 50]]],
                'columns' => [['id' => 'c_in', 'width' => ['base' => 100], 'elements' => [
                    ['id' => 'e_btn', 'type' => 'button', 'style' => ['base' => ['motion' => ['entrance' => 'none', 'stagger_children' => 50, 'loop' => 'pulse'], 'hover' => ['effect' => 'lift']]]],
                ]]],
            ]]]],
        ]]]);
        $section = $doc['sections'][0];
        $this->assertSame(['type' => 'none', 'parallax' => 'slow'], $section['style']['base']['background']);
        $this->assertSame(['entrance' => 'fade', 'stagger_children' => 100], $section['style']['base']['motion']);
        $this->assertSame(['entrance' => 'fade'], $section['columns'][0]['style']['base']['motion']);
        $row = $section['columns'][0]['elements'][0];
        $this->assertSame(['background' => ['type' => 'none'], 'motion' => ['entrance' => 'zoom', 'stagger_children' => 50]], $row['style']['base']);
        $this->assertSame(['motion' => ['entrance' => 'none', 'loop' => 'pulse'], 'hover' => ['effect' => 'lift']], $row['columns'][0]['elements'][0]['style']['base']);
    }
}
