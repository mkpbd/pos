<?php

namespace App\Modules\Storefront\Application\Forms;

use App\Modules\Cms\Application\Contracts\PageContent;
use App\Modules\Shared\Application\Localization\LocaleContext;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Storefront\Application\Builder\BuilderPageRenderer;
use App\Modules\Storefront\Application\Builder\BuilderPopups;
use App\Modules\Storefront\Application\Events\FormSubmitted;
use App\Modules\Storefront\Domain\Builder\BuilderDocumentSchema;
use App\Modules\Storefront\Domain\Forms\FormAnswers;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;
use App\Modules\Storefront\Infrastructure\Models\BuilderFormSubmission;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * B8b: a visitor sends a builder `form` element. The form is looked up in the **published**
 * version of its document (a page, CMS page design, zone or popup of the store's organization)
 * and must be live: the document published (a CMS page design: its page published too; a popup:
 * switched on and inside its schedule), the element and every node above it shown and inside
 * their schedules — otherwise 404 FORM_NOT_FOUND. The answers are checked against the published
 * fields (FormAnswers; 422 VALIDATION_ERROR keyed `values.<field id>` / `consent`) and stored;
 * staff are told after commit (FormSubmitted). A filled honeypot (`website`) is accepted
 * silently and nothing is stored, like the contact form.
 */
class SubmitBuilderForm
{
    public function __construct(
        private readonly PageContent $pages,
        private readonly LocaleContext $locale,
    ) {}

    /**
     * @param  array{values?: mixed, consent?: mixed, website?: ?string, page_path?: ?string}  $input
     * @param  array{ip: ?string, user_agent: ?string}  $client
     * @return array{submission: ?BuilderFormSubmission, message: string}
     */
    public function __invoke(string $documentId, string $elementId, array $input, array $client): array
    {
        $document = BuilderDocument::query()->builder()->with('publishedVersion')->whereKey(strtolower($documentId))->first();
        $version = $document?->publishedVersion;
        $element = $version === null || ! $this->documentLive($document) ? null : self::liveElement($version->content, $elementId);
        if ($element === null) {
            throw new BusinessRuleViolation('FORM_NOT_FOUND', 'This form is not available.', [], 404);
        }

        $localized = BuilderPageRenderer::localizedProps('form', $element['props'], $element['translations'] ?? [], $this->locale->current());
        $message = $localized['success_message'];
        if (trim((string) ($input['website'] ?? '')) !== '') {
            return ['submission' => null, 'message' => $message];
        }

        $props = $element['props'];
        $checked = FormAnswers::check($props, $input['values'] ?? [], $input['consent'] ?? null);
        if ($checked['errors'] !== []) {
            throw ValidationException::withMessages(array_map(fn (string $m) => [$m], $checked['errors']));
        }

        $title = trim($props['title']) !== '' ? $props['title'] : 'Form on '.$document->title;
        $pagePath = isset($input['page_path']) && is_string($input['page_path']) && trim($input['page_path']) !== '' ? mb_substr(trim($input['page_path']), 0, 255) : null;
        $userAgent = $client['user_agent'] === null ? null : mb_substr($client['user_agent'], 0, 255);

        $submission = DB::transaction(function () use ($document, $elementId, $title, $checked, $pagePath, $client, $userAgent, $props) {
            $submission = BuilderFormSubmission::query()->create([
                'document_id' => $document->id,
                'element_id' => $elementId,
                'form_title' => mb_substr($title, 0, 160),
                'fields' => $checked['fields'],
                'values' => $checked['values'],
                'reply_to' => $checked['reply_to'],
                'locale' => $this->locale->current(),
                'page_path' => $pagePath,
                'ip' => $client['ip'],
                'user_agent' => $userAgent,
                'status' => BuilderFormSubmission::STATUS_NEW,
            ]);
            event(new FormSubmitted($submission->organization_id, $submission->id, $props['notify_email']));

            return $submission;
        });

        return ['submission' => $submission, 'message' => $message];
    }

    /**
     * Whether a document with a published version is on the store now (P2a: also used for order forms).
     */
    public function documentLive(BuilderDocument $document): bool
    {
        if ($document->isPopup()) {
            return $document->active && BuilderPopups::inSchedule($document->publishedVersion->content['popup'] ?? [], CarbonImmutable::now());
        }
        $pageId = $document->cmsPageId();
        if ($pageId !== null) {
            return ($this->pages->find($pageId)['status'] ?? null) === 'published';
        }

        return true;
    }

    /**
     * The form element with this id when it and every node above it are shown now (P2a: or an
     * element of another `$type`, e.g. `order_form`).
     *
     * @param  array<string, mixed>  $content  a published version's content
     * @return array<string, mixed>|null
     */
    public static function liveElement(array $content, string $elementId, string $type = 'form'): ?array
    {
        $now = CarbonImmutable::now();
        $live = function (array $node) use ($now): bool {
            if (($node['hidden'] ?? false) === true) {
                return false;
            }
            $starts = $node['schedule']['starts_at'] ?? null;
            $ends = $node['schedule']['ends_at'] ?? null;

            return ! (is_string($starts) && CarbonImmutable::parse($starts)->gt($now))
                && ! (is_string($ends) && CarbonImmutable::parse($ends)->lte($now));
        };
        $search = function (array $columns) use (&$search, $live, $elementId, $type): ?array {
            foreach ($columns as $column) {
                foreach ($column['elements'] ?? [] as $element) {
                    if (($element['id'] ?? null) === $elementId) {
                        return ($element['type'] ?? null) === $type && $live($element) ? $element : null;
                    }
                    if (isset($element['columns']) && $live($element) && ($found = $search($element['columns'])) !== null) {
                        return $found;
                    }
                }
            }

            return null;
        };
        foreach ($content['sections'] ?? [] as $section) {
            if ($live($section) && ($found = $search($section['columns'] ?? [])) !== null) {
                return $found;
            }
        }

        return null;
    }

    /**
     * Every form element of a document's content (any state): `[{id, title}]`.
     *
     * @param  array<string, mixed>  $content
     * @return list<array{id: string, title: string}>
     */
    public static function forms(array $content): array
    {
        $forms = [];
        BuilderDocumentSchema::walk($content, function (array $node, string $path, string $kind) use (&$forms) {
            if ($kind === 'element' && ($node['type'] ?? null) === 'form') {
                $forms[] = ['id' => $node['id'], 'title' => (string) ($node['props']['title'] ?? '')];
            }
        });

        return $forms;
    }
}
