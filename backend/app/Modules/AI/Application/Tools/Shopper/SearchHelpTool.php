<?php

namespace App\Modules\AI\Application\Tools\Shopper;

use App\Modules\AI\Application\Tools\AiTool;
use App\Modules\AI\Application\Tools\Arguments;
use App\Modules\AI\Application\Tools\ToolOutput;
use App\Modules\AI\Domain\Llm\ToolDefinition;
use App\Modules\Cms\Application\Contracts\PageContent;
use Illuminate\Support\Facades\Validator;

/**
 * AI2b: the store's own help content — active FAQ entries and published, visible content pages
 * matching the shopper's words, in the shopper's language where translated (at most five,
 * excerpts ≤ 400 characters). Drafts, scheduled and deleted pages and inactive FAQ entries are
 * never searched.
 */
final class SearchHelpTool implements AiTool
{
    public const NAME = 'search_help';

    public const MAX_RESULTS = 5;

    public function __construct(
        private readonly PageContent $pages,
        private readonly ShopperFindings $findings,
    ) {}

    public function definition(): ToolDefinition
    {
        return new ToolDefinition(
            self::NAME,
            'Search the store\'s FAQ and information pages (about us, terms, warranty, size help …). Returns at most 5 entries with title, '
            .'a short excerpt and the page address when there is one. Use a few keywords.',
            Arguments::schema([
                'query' => ['type' => 'string', 'description' => 'Keywords, e.g. "warranty" or "exchange size" (1–100 characters)'],
            ], ['query']),
        );
    }

    public function run(array $input): ToolOutput
    {
        $args = Validator::make(Arguments::only($input, ['query']), [
            'query' => ['required', 'string', 'max:100'],
        ])->validate();
        $query = trim((string) $args['query']);

        $results = $this->pages->searchHelp($query, self::MAX_RESULTS);
        $faqPage = null;
        foreach ($results as $result) {
            if ($result['path'] === null) {
                continue;
            }
            if ($result['type'] === 'faq') {
                $faqPage ??= $this->pages->templatePage('faq');
                $this->findings->link($faqPage['title'] ?? 'FAQ', $result['path']);
            } else {
                $this->findings->link($result['title'], $result['path']);
            }
        }

        return new ToolOutput(
            data: [
                'results' => array_map(fn (array $r) => [
                    'type' => $r['type'],
                    'title' => $r['title'],
                    'path' => $r['path'],
                    'excerpt' => $r['excerpt'],
                ], $results),
            ],
            params: ['query' => mb_substr($query, 0, 60)],
        );
    }
}
