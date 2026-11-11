<?php

namespace App\Modules\Storefront\Application\Builder;

use App\Modules\Shared\Application\Contracts\HtmlSanitizer;
use App\Modules\Storefront\Domain\Builder\BuilderDocumentSchema;
use App\Modules\Storefront\Domain\Builder\ElementRegistry;
use App\Modules\Storefront\Domain\Builder\InvalidBuilderDocument;

/**
 * A builder document as it is stored (B1): normalized by the schema, rich text sanitized
 * with the HtmlSanitizer (text elements' `html`, text blocks' `body_html` and their
 * translations), then checked for references the organization owns.
 */
class PrepareBuilderContent
{
    public function __construct(
        private readonly HtmlSanitizer $sanitizer,
        private readonly BuilderReferences $references,
    ) {}

    /**
     * @param  array<string, mixed>  $content
     * @return array<string, mixed>
     *
     * @throws InvalidBuilderDocument
     */
    public function __invoke(array $content): array
    {
        $document = $this->sanitized($content);
        $this->references->check($document);

        return $document;
    }

    /**
     * Normalized and sanitized, without the reference check (B2: the canvas resolver checks
     * the references of many elements at once).
     *
     * @param  array<string, mixed>  $content
     * @return array<string, mixed>
     *
     * @throws InvalidBuilderDocument
     */
    public function sanitized(array $content): array
    {
        $document = BuilderDocumentSchema::normalize($content);

        $errors = [];
        foreach ($document['sections'] as $i => $section) {
            $document['sections'][$i] = $this->sanitizeNode($section, "sections.{$i}", $errors);
        }
        if ($errors !== []) {
            throw new InvalidBuilderDocument($errors);
        }

        return $document;
    }

    /**
     * @param  array<string, mixed>  $node  a section or element
     * @param  list<array{path: string, node_id: ?string, message: string}>  $errors
     * @return array<string, mixed>
     */
    private function sanitizeNode(array $node, string $path, array &$errors): array
    {
        $type = $node['type'];
        $fields = ElementRegistry::HTML_PROPS[$type] ?? [];
        foreach ($fields as $field) {
            if ($type === 'rich_text') {
                $html = $this->sanitizer->clean((string) $node['props']['config'][$field]);
                if (trim(strip_tags($html, '<img>')) === '') {
                    $errors[] = ['path' => "{$path}.props.config.{$field}", 'node_id' => $node['id'], 'message' => 'The text block has no content left after removing unsupported formatting.'];
                }
                $node['props']['config'][$field] = $html;
            } else {
                $node['props'][$field] = $this->sanitizer->clean((string) $node['props'][$field]);
            }
            foreach ($node['translations'] as $locale => $texts) {
                if (! isset($texts[$field])) {
                    continue;
                }
                $html = $this->sanitizer->clean($texts[$field]);
                if (trim(strip_tags($html, '<img>')) === '') {
                    unset($node['translations'][$locale][$field]);
                } else {
                    $node['translations'][$locale][$field] = $html;
                }
            }
            $node['translations'] = array_filter($node['translations'], fn (array $texts) => $texts !== []);
        }

        foreach ($node['columns'] ?? [] as $c => $column) {
            foreach ($column['elements'] as $e => $element) {
                $node['columns'][$c]['elements'][$e] = $this->sanitizeNode($element, "{$path}.columns.{$c}.elements.{$e}", $errors);
            }
        }

        return $node;
    }
}
