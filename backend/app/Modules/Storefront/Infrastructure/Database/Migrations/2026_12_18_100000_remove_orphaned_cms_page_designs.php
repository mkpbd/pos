<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * B22a: one-off cleanup — builder designs (`cms:<page id>` documents) whose CMS page was deleted
 * before deleting a page also deleted its design. Nothing can show them any more. Each removal is
 * audited as `storefront.builder_deleted` (context `reason: cms_page_deleted`); the versions,
 * schedules, reviews, comments and edit sessions go with the document (ON DELETE CASCADE).
 * Re-running finds nothing; down() restores nothing.
 *
 * Manual SQL (PostgreSQL), after an audit insert per row of the SELECT:
 *   SELECT d.id FROM builder_documents d WHERE d.key LIKE 'cms:%' AND NOT EXISTS (
 *     SELECT 1 FROM cms_pages p WHERE p.organization_id = d.organization_id
 *       AND p.id::text = substr(d.key, 5) AND p.deleted_at IS NULL);
 *   UPDATE builder_documents SET published_version_id = NULL WHERE id IN (…);
 *   DELETE FROM builder_documents WHERE id IN (…);
 */
return new class extends Migration
{
    public function up(): void
    {
        $orphans = DB::table('builder_documents as d')
            ->where('d.key', 'like', 'cms:%')
            ->whereNotExists(fn ($q) => $q->selectRaw('1')->from('cms_pages as p')
                ->whereColumn('p.organization_id', 'd.organization_id')
                ->whereRaw('p.id::text = substr(d.key, 5)')
                ->whereNull('p.deleted_at'))
            ->get(['d.id', 'd.organization_id', 'd.key', 'd.title', 'd.published_version_id']);
        if ($orphans->isEmpty()) {
            return;
        }

        DB::table('audit_logs')->insert($orphans->map(fn ($d) => [
            'id' => (string) Str::uuid7(),
            'organization_id' => $d->organization_id,
            'action' => 'storefront.builder_deleted',
            'subject_type' => 'builder_documents',
            'subject_id' => $d->id,
            'old_values' => json_encode(['key' => $d->key, 'title' => $d->title, 'published_version_id' => $d->published_version_id]),
            'context' => json_encode(['reason' => 'cms_page_deleted']),
        ])->all());

        $ids = $orphans->pluck('id')->all();
        // The document points at a version and the versions at the document: unhook first.
        DB::table('builder_documents')->whereIn('id', $ids)->update(['published_version_id' => null]);
        DB::table('builder_documents')->whereIn('id', $ids)->delete();
    }

    public function down(): void
    {
        // Deleted designs are not restored.
    }
};
