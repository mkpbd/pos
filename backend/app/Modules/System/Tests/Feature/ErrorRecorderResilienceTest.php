<?php

namespace App\Modules\System\Tests\Feature;

use App\Modules\System\Infrastructure\ErrorLog\ErrorRecorder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Route;
use RuntimeException;
use Tests\TestCase;

/**
 * G1b: recording an error never breaks the request — when the error log's database cannot be
 * reached, the failure is only logged and the normal 500 response goes out.
 */
class ErrorRecorderResilienceTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_failing_error_log_database_is_only_logged(): void
    {
        config([
            'pos.error_log.enabled' => true,
            'database.connections.'.ErrorRecorder::CONNECTION.'.database' => 'pos_g1b_database_that_does_not_exist',
        ]);
        DB::purge(ErrorRecorder::CONNECTION);
        Log::spy();
        Route::middleware('api')->get('api/v1/_g1b/boom', fn () => throw new RuntimeException('Boom'));

        $this->getJson('/api/v1/_g1b/boom')->assertStatus(500)->assertJsonPath('error.code', 'SERVER_ERROR');

        Log::shouldHaveReceived('warning')->withArgs(fn (string $message) => $message === 'The error could not be recorded in the error log.')->once();
        DB::purge(ErrorRecorder::CONNECTION);
    }

    public function test_report_never_throws(): void
    {
        config(['pos.error_log.enabled' => true, 'database.connections.'.ErrorRecorder::CONNECTION.'.database' => 'pos_g1b_database_that_does_not_exist']);
        DB::purge(ErrorRecorder::CONNECTION);

        ErrorRecorder::report(new RuntimeException('Boom'));

        $this->addToAssertionCount(1);
        DB::purge(ErrorRecorder::CONNECTION);
    }
}
