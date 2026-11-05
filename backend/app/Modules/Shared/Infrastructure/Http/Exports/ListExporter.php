<?php

namespace App\Modules\Shared\Infrastructure\Http\Exports;

use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\DocumentLetterhead;
use App\Modules\Shared\Application\Export\ExportDocument;
use App\Modules\Shared\Application\Export\ExportFormat;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Infrastructure\Export\PdfExportWriter;
use App\Modules\Shared\Infrastructure\Export\XlsxExportWriter;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Container\Container;
use Illuminate\Http\Exceptions\ThrottleRequestsException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

/**
 * Answers `?export=xlsx|pdf` on admin list endpoints: the list's own filtered, sorted and
 * tenant-scoped query (every page), within the format's row limit (422 EXPORT_TOO_LARGE),
 * throttled per user (`exports` limiter), audited (`export.created`) and returned as a
 * download (`<list>-<org-slug>-<YYYYMMDD-HHmm>.<ext>`, no-store).
 *
 * In a controller, after the list's filters and ListQuery::apply():
 *   if ($format = ListExporter::requested($request)) {
 *       return $exports->download($request, $format, SalesExport::class, RowSource::fromQuery($query, $present));
 *   }
 */
final class ListExporter
{
    public const PARAM = 'export';

    public function __construct(
        private readonly Container $container,
        private readonly XlsxExportWriter $xlsx,
        private readonly PdfExportWriter $pdf,
        private readonly AuditTrail $audit,
        private readonly DocumentLetterhead $letterhead,
        private readonly TenantContext $tenant,
    ) {}

    /**
     * The requested export format, or null for the normal JSON page. An unknown value is a
     * validation error.
     */
    public static function requested(Request $request): ?ExportFormat
    {
        if (! $request->query->has(self::PARAM)) {
            return null;
        }
        Validator::make($request->query(), [self::PARAM => ['required', 'string', 'in:xlsx,pdf']])->validate();

        return ExportFormat::from((string) $request->query(self::PARAM));
    }

    /**
     * @param  class-string<ListExport>|ListExport  $list
     */
    public function download(Request $request, ExportFormat $format, string|ListExport $list, RowSource $source): Response
    {
        $list = is_string($list) ? $this->container->make($list) : $list;
        $this->throttle($request);

        $limit = (int) config("exports.max_rows.{$format->value}");
        if ($source->total > $limit) {
            throw new BusinessRuleViolation(
                'EXPORT_TOO_LARGE',
                sprintf('This list has %s rows; %s exports are limited to %s. Narrow the filters and try again.', number_format($source->total), $format === ExportFormat::Pdf ? 'PDF' : 'Excel', number_format($limit)),
                ['limit' => $limit, 'rows' => $source->total, 'format' => $format->value],
            );
        }

        $letterhead = $this->letterhead->forOrganization($this->tenant->requireOrganization());
        $timezone = $letterhead['timezone'] !== '' ? $letterhead['timezone'] : (string) config('app.timezone');
        $now = CarbonImmutable::now($timezone);
        $user = $request->user();
        $document = new ExportDocument(
            title: $list->title(),
            columns: $list->columns(),
            rows: $source->stream(),
            total: $source->total,
            filters: $list->filters($request),
            letterhead: $letterhead,
            timezone: $timezone,
            generatedAt: $now,
            generatedBy: $user?->getAttribute('name'),
        );
        $slug = Str::slug($letterhead['slug'] !== '' ? $letterhead['slug'] : $letterhead['name']) ?: 'organization';
        $filename = sprintf('%s-%s-%s.%s', $list->name(), $slug, $now->format('Ymd-Hi'), $format->value);

        if ($format === ExportFormat::Xlsx) {
            $path = $this->temporaryFile();
            try {
                $count = $this->xlsx->write($document, $path);
            } catch (Throwable $e) {
                @unlink($path);

                throw $e;
            }
            $response = (new BinaryFileResponse($path, 200, [], false))->deleteFileAfterSend();
        } else {
            [$bytes, $count] = $this->pdf->render($document);
            $response = new Response($bytes);
        }

        $this->audit->record('export.created', context: [
            'list' => $list->name(),
            'format' => $format->value,
            'filters' => $this->filterParams($request),
            'rows' => $count,
        ]);

        $response->headers->set('Content-Type', $format->contentType());
        $response->headers->set('Content-Disposition', $response->headers->makeDisposition('attachment', $filename, Str::ascii($filename)));
        $response->headers->set('Cache-Control', 'no-store, private');
        $response->headers->set('X-Export-Rows', (string) $count);

        return $response;
    }

    /**
     * The `exports` limiter (config exports.rate_limit per minute per user), applied here
     * because the same routes also serve the JSON list.
     */
    private function throttle(Request $request): void
    {
        $max = max(1, (int) config('exports.rate_limit', 10));
        $key = 'exports|'.($request->user()?->getAuthIdentifier() ?? $request->ip());
        if (RateLimiter::tooManyAttempts($key, $max)) {
            $retryAfter = RateLimiter::availableIn($key);

            throw new ThrottleRequestsException('Too many exports. Please wait a minute.', null, [
                'Retry-After' => $retryAfter,
                'X-RateLimit-Limit' => $max,
                'X-RateLimit-Remaining' => 0,
            ]);
        }
        RateLimiter::hit($key, 60);
    }

    /**
     * @return array<string, mixed>
     */
    private function filterParams(Request $request): array
    {
        return collect($request->query())
            ->except([self::PARAM, 'page', 'per_page'])
            ->filter(fn ($v) => $v !== null && $v !== '')
            ->all();
    }

    private function temporaryFile(): string
    {
        $directory = storage_path('app/private/exports');
        if (! is_dir($directory)) {
            mkdir($directory, 0700, true);
        }

        return $directory.DIRECTORY_SEPARATOR.Str::uuid()->toString().'.xlsx';
    }
}
