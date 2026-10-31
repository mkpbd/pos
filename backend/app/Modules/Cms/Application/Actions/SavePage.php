<?php

namespace App\Modules\Cms\Application\Actions;

use App\Modules\Cms\Application\Contracts\PageReferences;
use App\Modules\Cms\Domain\PageStatus;
use App\Modules\Cms\Infrastructure\Models\CmsPage;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\HtmlSanitizer;
use App\Modules\Shared\Application\Support\Changes;
use App\Modules\Shared\Application\Support\Instants;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use Illuminate\Contracts\Container\Container;
use Illuminate\Support\Facades\DB;

/**
 * Creates, updates and deletes content pages. The body is sanitized on every save;
 * publishing without a date publishes now.
 */
class SavePage
{
    public function __construct(
        private readonly HtmlSanitizer $sanitizer,
        private readonly AuditTrail $audit,
        private readonly Container $container,
    ) {}

    /**
     * @param  array<string, mixed>  $attributes  validated
     */
    public function save(CmsPage $page, array $attributes): CmsPage
    {
        $attributes = Instants::normalize($attributes, ['published_at']);

        return DB::transaction(function () use ($page, $attributes) {
            $creating = ! $page->exists;
            $before = $creating ? [] : $this->snapshot($page);

            if (array_key_exists('body_html', $attributes)) {
                $body = $attributes['body_html'] === null ? '' : $this->sanitizer->clean((string) $attributes['body_html']);
                $attributes['body_html'] = $body === '' ? null : $body;
            }
            if (isset($attributes['slug'])) {
                $attributes['slug'] = mb_strtolower($attributes['slug']);
            }

            $page->fill($attributes);
            if ($page->status === PageStatus::Published && $page->published_at === null) {
                $page->published_at = now()->toImmutable();
            }
            $page->save();

            [$old, $new] = Changes::between($before, $this->snapshot($page));
            if ($creating || $new !== []) {
                $this->audit->record($creating ? 'cms_page.created' : 'cms_page.updated', $page, $old, $new);
            }

            return $page;
        });
    }

    public function delete(CmsPage $page): void
    {
        /** @var iterable<PageReferences> $references */
        $references = $this->container->tagged(PageReferences::TAG);
        foreach ($references as $reference) {
            if ($reference->uses($page->id)) {
                throw new BusinessRuleViolation('IN_USE', 'A menu still links to this page. Remove the link first.');
            }
        }

        DB::transaction(function () use ($page) {
            $page->delete();
            $this->audit->record('cms_page.deleted', $page, $this->snapshot($page));
        });
    }

    /**
     * @return array<string, mixed>
     */
    private function snapshot(CmsPage $page): array
    {
        return [
            'slug' => $page->slug,
            'title' => $page->title,
            'template' => $page->template->value,
            'status' => $page->status->value,
            'published_at' => $page->published_at?->toIso8601String(),
            'seo_title' => $page->seo_title,
            'seo_description' => $page->seo_description,
            // The body itself is too large for the audit log; record that it changed.
            'body_hash' => $page->body_html === null ? null : hash('xxh128', $page->body_html),
        ];
    }
}
