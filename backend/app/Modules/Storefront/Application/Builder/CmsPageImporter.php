<?php

namespace App\Modules\Storefront\Application\Builder;

use App\Modules\Storefront\Domain\Builder\BuilderDocumentSchema;
use App\Modules\Storefront\Domain\Builder\ElementRegistry;
use DOMDocument;
use DOMNode;
use Illuminate\Support\Str;

/**
 * "Design with the builder" for a CMS page (B4, `from: cms`): one boxed section with the page
 * title as a heading (h1, Bangla title kept as its translation), the body as text (Bangla body
 * kept; a body longer than a text element holds is split at its top-level blocks into several
 * text elements), then the FAQ list (template `faq`) or the contact form (template `contact`).
 * The result is a raw document; the caller prepares (validates) it like any other content.
 */
class CmsPageImporter
{
    /**
     * @param  array{title: string, template: string, body_html: ?string, translations: array<string, array<string, string>>}  $page
     * @return array{schema_version: int, sections: list<array<string, mixed>>}
     */
    public function document(array $page): array
    {
        $bn = $page['translations']['bn'] ?? [];
        $elements = [$this->element('heading', ['text' => mb_substr($page['title'], 0, ElementRegistry::TEXT_LIMITS['heading.text']), 'level' => 1, 'link' => null], [
            'bn' => array_filter(['text' => isset($bn['title']) ? mb_substr($bn['title'], 0, ElementRegistry::TEXT_LIMITS['heading.text']) : null]),
        ])];

        $max = ElementRegistry::TEXT_LIMITS['text.html'];
        $english = $this->chunks((string) $page['body_html'], $max);
        $bangla = $this->chunks((string) ($bn['body_html'] ?? ''), $max);
        $count = max(count($english), count($bangla));
        for ($i = 0; $i < $count; $i++) {
            $elements[] = $this->element('text', ['html' => $english[$i] ?? ''], ['bn' => array_filter(['html' => $bangla[$i] ?? null])]);
        }

        if ($page['template'] === 'faq') {
            $elements[] = $this->element('faq_list', ElementRegistry::defaults('faq_list'));
        } elseif ($page['template'] === 'contact') {
            $elements[] = $this->element('contact_form', ElementRegistry::defaults('contact_form'));
        }

        $document = BuilderDocumentSchema::blank();
        $document['sections'][] = [
            'id' => $this->id('s'),
            'type' => 'section',
            'props' => ['layout' => 'boxed', 'anchor' => null],
            'columns' => [['id' => $this->id('c'), 'type' => 'column', 'width' => ['base' => 100], 'style' => [], 'elements' => $elements]],
        ];

        return $document;
    }

    /**
     * @param  array<string, mixed>  $props
     * @param  array<string, array<string, string>>  $translations
     * @return array<string, mixed>
     */
    private function element(string $type, array $props, array $translations = []): array
    {
        return ['id' => $this->id('e'), 'type' => $type, 'props' => $props, 'translations' => array_filter($translations)];
    }

    /**
     * The HTML in pieces of at most `$max` characters, cut between top-level nodes; one empty
     * list for no content. A single top-level node longer than `$max` stays whole (the
     * document is then refused with the text element's limit).
     *
     * @return list<string>
     */
    private function chunks(string $html, int $max): array
    {
        $html = trim($html);
        if ($html === '') {
            return [];
        }
        if (mb_strlen($html) <= $max) {
            return [$html];
        }

        $dom = new DOMDocument;
        $previous = libxml_use_internal_errors(true);
        $dom->loadHTML('<?xml encoding="UTF-8"><div id="root">'.$html.'</div>', LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD);
        libxml_clear_errors();
        libxml_use_internal_errors($previous);
        $root = $dom->getElementById('root');
        if ($root === null) {
            return [$html];
        }

        $chunks = [];
        $current = '';
        /** @var DOMNode $node */
        foreach (iterator_to_array($root->childNodes) as $node) {
            $part = (string) $dom->saveHTML($node);
            if ($current !== '' && mb_strlen($current) + mb_strlen($part) > $max) {
                $chunks[] = $current;
                $current = '';
            }
            $current .= $part;
        }
        if (trim($current) !== '') {
            $chunks[] = $current;
        }

        return array_values(array_filter(array_map('trim', $chunks), fn (string $c) => $c !== ''));
    }

    private function id(string $prefix): string
    {
        return $prefix.'_'.Str::lower(Str::random(10));
    }
}
