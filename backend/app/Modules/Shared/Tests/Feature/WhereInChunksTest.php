<?php

namespace App\Modules\Shared\Tests\Feature;

use App\Modules\Shared\Infrastructure\Persistence\WhereInChunks;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * G1c: lists longer than PostgreSQL's 65 535 bound parameters are queried in chunks, with the
 * same rows as one `whereIn`.
 */
class WhereInChunksTest extends TestCase
{
    use InteractsWithTenancy, RefreshDatabase;

    public function test_a_list_longer_than_the_parameter_limit_returns_every_matching_row(): void
    {
        ['organization' => $organization, 'admin' => $admin] = $this->provisionTenant();
        $other = User::query()->where('organization_id', $organization->id)->whereKeyNot($admin->id)->pluck('id')->all();
        $ids = [...array_map(fn () => (string) Str::uuid7(), range(1, 70_000)), $admin->id, ...$other, $admin->id];

        $queries = 0;
        DB::listen(function () use (&$queries) {
            $queries++;
        });
        $rows = WhereInChunks::get(DB::table('users')->where('organization_id', $organization->id), 'id', $ids, ['id', 'email']);

        $this->assertSame(8, $queries); // 70 001+ distinct values in chunks of 10 000
        $this->assertEqualsCanonicalizing([$admin->id, ...$other], $rows->pluck('id')->all());
        $this->assertSame(['id', 'email'], array_keys((array) $rows->first()));

        $models = WhereInChunks::get(User::query()->where('organization_id', $organization->id), 'users.id', $ids);
        $this->assertInstanceOf(Collection::class, $models);
        $this->assertTrue($models->contains('id', $admin->id));
        $this->assertCount(0, WhereInChunks::get(DB::table('users'), 'id', []));
    }
}
