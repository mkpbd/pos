<?php

namespace App\Modules\Media;

use App\Modules\Media\Application\Contracts\MediaLibrary;
use App\Modules\Media\Infrastructure\Console\OptimizeMediaCommand;
use App\Modules\Media\Infrastructure\EloquentMediaLibrary;
use App\Modules\Shared\Infrastructure\Providers\ModuleServiceProvider;

/**
 * The organization's image library for storefront content: uploads, alt text,
 * WebP renditions, and in-use protection on delete. B11: picture editing (GD),
 * focal points, scaling down oversized uploads, `media:optimize`.
 */
class MediaServiceProvider extends ModuleServiceProvider
{
    public function register(): void
    {
        $this->app->bind(MediaLibrary::class, EloquentMediaLibrary::class);
    }

    public function boot(): void
    {
        parent::boot();

        if ($this->app->runningInConsole()) {
            $this->commands([OptimizeMediaCommand::class]);
        }
    }

    protected function permissions(): array
    {
        return [
            'media.manage' => 'Upload images, edit them, set their alt text and focal point, and delete unused ones',
        ];
    }
}
