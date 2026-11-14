<?php

namespace App\Modules\Storefront\Presentation\Http\Requests;

use App\Modules\OnlineCatalog\Application\Contracts\StorefrontCatalog;
use App\Modules\Storefront\Application\Builder\Templates\BuilderTemplateLibrary;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

/**
 * A new store builder document. `kind` and `key`:
 *
 * - `page`: `home`, `landing:<slug>` (2–60 lower-case letters, digits and dashes;
 *   `landing:home` is reserved) or (B4) `cms:<cms page uuid>`;
 * - `header`: `header`; `footer`: `footer` (B4);
 * - `zone`: `zone:listing.top`, `zone:listing.bottom`, `zone:product.after` (B4); P1b:
 *   `zone:product.below_price`, `zone:product.bottom`, and a product zone's version for a
 *   category or a product, `zone:<product zone>@category:<uuid>` / `@product:<uuid>` (lower-case);
 * - `popup` (B8b): no key (the server makes `popup:<uuid>`; `key` and `from` are ignored), an
 *   optional `template` (a built-in popup template id).
 * - `global` (B9): no key (the server makes `global:<uuid>`), `context` (page | header | footer),
 *   `from` blank (default) | section with `section` (a section from a draft).
 *
 * `from`: `blank` (default), `homepage` (home only: convert the homepage sections), `cms`
 * (cms keys only: import the CMS page) or `current` (header / footer only: today's layout);
 * P2a: `template` (landing pages only) with `template` (a built-in page template id) and an
 * optional `product_id` (one of the store's products) the campaign page is made for.
 */
class CreateBuilderDocumentRequest extends FormRequest
{
    private const PAGE_KEY = '/^(home|landing:[a-z0-9-]{2,60}|cms:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/';

    protected function prepareForValidation(): void
    {
        // P1b: the target id of a zone version is stored lower-case, whatever the client sent.
        $key = $this->input('key');
        if ($this->input('kind') === BuilderDocument::KIND_ZONE && is_string($key) && str_contains($key, '@')) {
            [$zone, $target] = explode('@', $key, 2);
            $this->merge(['key' => $zone.'@'.strtolower($target)]);
        }
    }

    public function rules(): array
    {
        if ($this->input('kind') === BuilderDocument::KIND_GLOBAL) {
            // B9: the key is made by the server; `section` is a section from a draft.
            return [
                'kind' => ['required', Rule::in(BuilderDocument::BUILDER_KINDS)],
                'title' => ['required', 'string', 'max:160'],
                'context' => ['required', Rule::in(BuilderDocument::GLOBAL_CONTEXTS)],
                'from' => ['sometimes', 'nullable', Rule::in(['blank', 'section'])],
                'section' => ['required_if:from,section', 'nullable', 'array'],
            ];
        }
        if ($this->input('kind') === BuilderDocument::KIND_POPUP) {
            // B8b: the key is made by the server; `template` is a built-in popup template.
            return [
                'kind' => ['required', Rule::in(BuilderDocument::BUILDER_KINDS)],
                'title' => ['required', 'string', 'max:160'],
                'template' => ['sometimes', 'nullable', 'string', Rule::in($this->popupTemplates())],
            ];
        }

        return [
            'kind' => ['required', Rule::in(BuilderDocument::BUILDER_KINDS)],
            'key' => ['required', 'string', 'max:120', Rule::notIn(['landing:home'])],
            'title' => ['required', 'string', 'max:160'],
            'from' => ['sometimes', 'nullable', Rule::in(['blank', 'homepage', 'cms', 'current', 'template'])],
            // P2a: a new campaign page from a built-in page template, for a product.
            'template' => ['required_if:from,template', 'nullable', 'string', Rule::in($this->pageTemplates())],
            'product_id' => ['sometimes', 'nullable', 'uuid'],
        ];
    }

    /**
     * P2a: built-in page templates usable on pages.
     *
     * @return list<string>
     */
    private function pageTemplates(): array
    {
        return array_column(array_filter(app(BuilderTemplateLibrary::class)->all(), fn (array $t) => $t['scope'] === 'page' && in_array('page', $t['allowed_in'], true)), 'id');
    }

    /**
     * @return list<string>
     */
    private function popupTemplates(): array
    {
        return array_column(array_filter(app(BuilderTemplateLibrary::class)->all(), fn (array $t) => $t['scope'] === 'popup'), 'id');
    }

    public function messages(): array
    {
        return [
            'key.not_in' => 'The address "home" is reserved for the home page.',
        ];
    }

    public function after(): array
    {
        return [function (Validator $validator) {
            if ($validator->errors()->isNotEmpty() || in_array($this->input('kind'), [BuilderDocument::KIND_POPUP, BuilderDocument::KIND_GLOBAL], true)) {
                return;
            }
            $kind = $this->input('kind');
            $key = (string) $this->input('key');
            $valid = match ($kind) {
                BuilderDocument::KIND_PAGE => preg_match(self::PAGE_KEY, $key) === 1,
                BuilderDocument::KIND_HEADER => $key === BuilderDocument::HEADER,
                BuilderDocument::KIND_FOOTER => $key === BuilderDocument::FOOTER,
                BuilderDocument::KIND_ZONE => in_array($key, array_map(fn (string $z) => BuilderDocument::ZONE_PREFIX.$z, BuilderDocument::ZONES), true)
                    || BuilderDocument::parseTargetedZone($key) !== null,
                default => false,
            };
            if (! $valid) {
                $validator->errors()->add('key', match ($kind) {
                    BuilderDocument::KIND_HEADER => 'The key of the header is "header".',
                    BuilderDocument::KIND_FOOTER => 'The key of the footer is "footer".',
                    BuilderDocument::KIND_ZONE => 'The key of an area is zone:listing.top, zone:listing.bottom, zone:product.below_price, zone:product.after or zone:product.bottom; a product area\'s version for a category or a product adds @category:<id> or @product:<id>.',
                    default => 'The key is "home", "landing:" followed by 2–60 lower-case letters, digits and dashes, or "cms:" followed by a content page id.',
                });

                return;
            }

            $from = $this->input('from') ?? 'blank';
            $allowed = match ($from) {
                'homepage' => $key === BuilderDocument::HOME,
                'cms' => str_starts_with($key, BuilderDocument::CMS_PREFIX),
                'current' => in_array($kind, [BuilderDocument::KIND_HEADER, BuilderDocument::KIND_FOOTER], true),
                'template' => str_starts_with($key, BuilderDocument::LANDING_PREFIX),
                default => true,
            };
            if (! $allowed) {
                $validator->errors()->add('from', match ($from) {
                    'homepage' => 'Only the home page can start from the current homepage.',
                    'cms' => 'Only a content page design can start from the content page.',
                    'template' => 'Only a campaign page (landing:<address>) can start from a page template.',
                    default => 'Only the header and the footer can start from the current design.',
                });

                return;
            }
            // P2a: the campaign page's product must be one of the store's products.
            $productId = $this->input('product_id');
            if ($from === 'template' && is_string($productId)
                && app(StorefrontCatalog::class)->existing('product', [strtolower($productId)]) === []) {
                $validator->errors()->add('product_id', 'This product does not exist. Choose one of your products.');
            }
        }];
    }
}
