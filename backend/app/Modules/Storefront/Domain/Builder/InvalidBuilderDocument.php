<?php

namespace App\Modules\Storefront\Domain\Builder;

use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;

/**
 * A builder document that cannot be saved: 422 `DOCUMENT_INVALID` with every problem found,
 * each `{path, node_id, message}` (path relative to the document, e.g.
 * `sections.1.columns.0.elements.2.props.link.url`; node_id of the nearest node or null).
 * Reference problems also carry `code` (MEDIA_NOT_FOUND, BANNER_NOT_FOUND, …) and `ids`.
 */
class InvalidBuilderDocument extends BusinessRuleViolation
{
    /**
     * @param  list<array{path: string, node_id: ?string, message: string, code?: string, ids?: list<string>}>  $errors
     */
    public function __construct(public readonly array $errors, string $message = 'The page could not be saved: some content is invalid.')
    {
        parent::__construct('DOCUMENT_INVALID', $message, ['errors' => $errors]);
    }
}
