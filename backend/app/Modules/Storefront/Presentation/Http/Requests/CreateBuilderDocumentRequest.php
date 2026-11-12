<?php

namespace App\Modules\Storefront\Presentation\Http\Requests;

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
 * - `zone`: `zone:listing.top`, `zone:listing.bottom`, `zone:product.after` (B4).
 *
 * `from`: `blank` (default), `homepage` (home only: convert the homepage sections), `cms`
 * (cms keys only: import the CMS page) or `current` (header / footer only: today's layout).
 */
class CreateBuilderDocumentRequest extends FormRequest
{
    private const PAGE_KEY = '/^(home|landing:[a-z0-9-]{2,60}|cms:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/';

    public function rules(): array
    {
        return [
            'kind' => ['required', Rule::in(BuilderDocument::BUILDER_KINDS)],
            'key' => ['required', 'string', 'max:120', Rule::notIn(['landing:home'])],
            'title' => ['required', 'string', 'max:160'],
            'from' => ['sometimes', 'nullable', Rule::in(['blank', 'homepage', 'cms', 'current'])],
        ];
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
            if ($validator->errors()->isNotEmpty()) {
                return;
            }
            $kind = $this->input('kind');
            $key = (string) $this->input('key');
            $valid = match ($kind) {
                BuilderDocument::KIND_PAGE => preg_match(self::PAGE_KEY, $key) === 1,
                BuilderDocument::KIND_HEADER => $key === BuilderDocument::HEADER,
                BuilderDocument::KIND_FOOTER => $key === BuilderDocument::FOOTER,
                BuilderDocument::KIND_ZONE => in_array($key, array_map(fn (string $z) => BuilderDocument::ZONE_PREFIX.$z, BuilderDocument::ZONES), true),
                default => false,
            };
            if (! $valid) {
                $validator->errors()->add('key', match ($kind) {
                    BuilderDocument::KIND_HEADER => 'The key of the header is "header".',
                    BuilderDocument::KIND_FOOTER => 'The key of the footer is "footer".',
                    BuilderDocument::KIND_ZONE => 'The key of an area is zone:listing.top, zone:listing.bottom or zone:product.after.',
                    default => 'The key is "home", "landing:" followed by 2–60 lower-case letters, digits and dashes, or "cms:" followed by a content page id.',
                });

                return;
            }

            $from = $this->input('from') ?? 'blank';
            $allowed = match ($from) {
                'homepage' => $key === BuilderDocument::HOME,
                'cms' => str_starts_with($key, BuilderDocument::CMS_PREFIX),
                'current' => in_array($kind, [BuilderDocument::KIND_HEADER, BuilderDocument::KIND_FOOTER], true),
                default => true,
            };
            if (! $allowed) {
                $validator->errors()->add('from', match ($from) {
                    'homepage' => 'Only the home page can start from the current homepage.',
                    'cms' => 'Only a content page design can start from the content page.',
                    default => 'Only the header and the footer can start from the current design.',
                });
            }
        }];
    }
}
