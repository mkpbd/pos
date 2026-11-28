<?php

namespace App\Modules\Storefront\Tests\Feature;

use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Storefront\Domain\Builder\StyleSchema;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * B22a: deleting a CMS page deletes its builder design (all or nothing, audited, said in the
 * response); the one-off cleanup of designs whose page was deleted earlier; `size.width: auto`
 * as a smaller device's explicit "do not fill the column width".
 */
class StoreBuilderB22aTest extends TestCase
{
    use BuildsOnlineCatalog, InteractsWithTenancy, RefreshDatabase;

    private const DOCS = '/api/v1/storefront/builder/documents';

    private const CLEANUP = 'app/Modules/Storefront/Infrastructure/Database/Migrations/2026_12_18_100000_remove_orphaned_cms_page_designs.php';

    /** @var array<string, mixed> */
    private array $t;

    protected function setUp(): void
    {
        parent::setUp();
        Date::setTestNow('2026-11-28T10:00:00+06:00');
        $this->t = $this->openStore('Berry Kids', 'berry.test');
    }

    private function page(string $slug): string
    {
        return $this->postJson('/api/v1/cms/pages', ['slug' => $slug, 'title' => ucfirst($slug), 'status' => 'published'])->assertCreated()->json('data.id');
    }

    /** A published design of the page with a comment: what the builder stores per document. */
    private function design(string $pageId): string
    {
        $id = $this->postJson(self::DOCS, ['kind' => 'page', 'key' => "cms:{$pageId}", 'title' => 'Design', 'from' => 'cms'])->assertCreated()->json('data.id');
        $this->postJson(self::DOCS."/{$id}/publish")->assertOk();
        $this->postJson(self::DOCS."/{$id}/comments", ['body' => 'Looks good'])->assertCreated();

        return $id;
    }

    private function assertDesignGone(string $id): void
    {
        $this->assertDatabaseMissing('builder_documents', ['id' => $id]);
        foreach (['builder_versions', 'builder_comments', 'builder_reviews', 'builder_schedules', 'builder_edit_sessions'] as $table) {
            $this->assertSame(0, DB::table($table)->where('document_id', $id)->count(), $table);
        }
    }

    public function test_deleting_a_cms_page_deletes_its_design_and_says_so(): void
    {
        $about = $this->page('about');
        $design = $this->design($about);
        $plain = $this->page('plain');
        $this->assertSame(1, DB::table('builder_versions')->where('document_id', $design)->count());

        $this->deleteJson("/api/v1/cms/pages/{$about}")->assertOk()->assertJsonPath('data.design_removed', true);

        $this->assertSoftDeleted('cms_pages', ['id' => $about]);
        $this->assertDesignGone($design);
        $this->assertDatabaseHas('audit_logs', ['action' => 'storefront.builder_deleted', 'subject_id' => $design]);
        $audit = DB::table('audit_logs')->where('action', 'cms_page.deleted')->where('subject_id', $about)->first();
        $this->assertSame(['design_removed' => true], json_decode((string) $audit->context, true));
        $this->getJson(self::DOCS."/{$design}")->assertNotFound();

        // A page without a design: nothing else to remove.
        $this->deleteJson("/api/v1/cms/pages/{$plain}")->assertOk()->assertJsonPath('data.design_removed', false);
    }

    public function test_the_page_stays_when_its_design_cannot_be_deleted(): void
    {
        $about = $this->page('about');
        $design = $this->design($about);
        // Someone else is editing the design: 423, and neither the page nor the design goes.
        $other = $this->createUserWithRole($this->t['organization'], SystemRole::OrganizationAdmin);
        $this->actingAsUser($other);
        $this->postJson(self::DOCS."/{$design}/presence", ['editing' => true])->assertOk();

        $this->actingAsUser($this->t['admin']);
        $this->deleteJson("/api/v1/cms/pages/{$about}")->assertStatus(423)->assertJsonPath('error.code', 'DOCUMENT_LOCKED');

        $this->assertDatabaseHas('cms_pages', ['id' => $about, 'deleted_at' => null]);
        $this->assertDatabaseHas('builder_documents', ['id' => $design]);
        $this->assertSame(1, DB::table('builder_versions')->where('document_id', $design)->count());
    }

    public function test_the_cleanup_removes_only_designs_whose_page_is_gone(): void
    {
        $gone = $this->page('gone');
        $orphan = $this->design($gone);
        $kept = $this->design($this->page('kept'));
        // Deleted the old way: the page only.
        DB::table('cms_pages')->where('id', $gone)->update(['deleted_at' => now()]);

        $other = $this->openStore('Mango Mart', 'mango.test');
        $otherPage = $this->page('gone');
        $otherDesign = $this->design($otherPage);

        (require base_path(self::CLEANUP))->up();

        $this->assertDesignGone($orphan);
        $this->assertDatabaseHas('builder_documents', ['id' => $kept]);
        $this->assertDatabaseHas('builder_documents', ['id' => $otherDesign]);
        $this->assertDatabaseHas('audit_logs', [
            'action' => 'storefront.builder_deleted', 'subject_id' => $orphan, 'organization_id' => $this->t['organization']->id,
        ]);
        $this->assertSame(0, DB::table('audit_logs')->where('action', 'storefront.builder_deleted')->where('organization_id', $other['organization']->id)->count());

        // Running it again finds nothing.
        (require base_path(self::CLEANUP))->up();
        $this->assertSame(1, DB::table('audit_logs')->where('action', 'storefront.builder_deleted')->count());
    }

    public function test_a_smaller_device_can_turn_an_inherited_full_width_off(): void
    {
        $style = StyleSchema::normalize([
            'base' => ['size' => ['width' => '100%']],
            'mobile' => ['size' => ['width' => 'auto', 'max_width' => 'auto', 'height' => 'auto']],
        ]);

        $this->assertSame(['base' => ['size' => ['width' => '100%']], 'mobile' => ['size' => ['width' => 'auto']]], $style);
    }
}
