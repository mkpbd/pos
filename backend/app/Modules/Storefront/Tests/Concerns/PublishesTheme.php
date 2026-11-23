<?php

namespace App\Modules\Storefront\Tests\Concerns;

use Illuminate\Testing\TestResponse;

/**
 * Q1: the legacy `PUT /storefront/theme` (save + publish in one step) is gone; tests set the
 * live theme the way the editor does — save the whole document to the draft, then publish.
 * Returns the first failing response (draft errors are keyed `settings.*`), else the live theme.
 */
trait PublishesTheme
{
    /**
     * @param  array<string, mixed>  $settings  the whole theme document (omitted keys take their defaults)
     */
    protected function publishTheme(array $settings): TestResponse
    {
        $revision = $this->getJson('/api/v1/storefront/theme/draft')->assertOk()->json('data.draft_revision');
        $saved = $this->putJson('/api/v1/storefront/theme/draft', ['revision' => $revision, 'settings' => $settings]);
        if (! $saved->isOk()) {
            return $saved;
        }
        $published = $this->postJson('/api/v1/storefront/theme/publish');
        if (! $published->isOk()) {
            return $published;
        }

        return $this->getJson('/api/v1/storefront/theme');
    }
}
