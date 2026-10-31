<?php

namespace App\Modules\Media;

use App\Modules\Media\Application\Contracts\MediaLibrary;
use App\Modules\Media\Infrastructure\EloquentMediaLibrary;
use App\Modules\Shared\Infrastructure\Providers\ModuleServiceProvider;

/**
 * The organization's image library for storefront content: uploads, alt text,
 * WebP renditions, and in-use protection on delete.
 */
class MediaServiceProvider extends ModuleServiceProvider
{
    public function register(): void
    {
        $this->app->bind(MediaLibrary::class, EloquentMediaLibrary::class);
    }

    protected function permissions(): array
    {
        return [
            'media.manage' => 'Upload images, edit their alt text and delete unused ones',
        ];
    }
}
