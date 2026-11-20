<?php

namespace App\Modules\Storefront\Presentation\Http\Middleware;

use App\Modules\Storefront\Application\Builder\Collaboration\BuilderEditLock;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * B16 (`builder.edit-lock`): routes that write a builder document's draft (or publish / snapshot
 * it) answer 423 DOCUMENT_LOCKED while someone else holds the document's edit lease. Draft
 * saves, publish, discard, restore and delete check it in ManageBuilderDocuments itself.
 */
class EnsureBuilderEditLock
{
    public function __construct(private readonly BuilderEditLock $lock) {}

    public function handle(Request $request, Closure $next): Response
    {
        $document = $request->route('document');
        if (is_string($document)) {
            $document = BuilderDocument::query()->find(strtolower($document));
        }
        if ($document instanceof BuilderDocument) {
            $this->lock->assertCanWrite($document);
        }

        return $next($request);
    }
}
