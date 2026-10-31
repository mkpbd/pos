<?php

use App\Modules\Storefront\Presentation\Http\Controllers\StorefrontShellController;
use Illuminate\Support\Facades\Route;

// Every storefront page is served by the shell. Paths owned by the API, auth, files,
// the admin SPA and tooling are excluded.
Route::middleware(['storefront:web', 'throttle:storefront'])
    ->get('{path?}', StorefrontShellController::class)
    ->where('path', '^(?!(api|sanctum|storage|admin|docs|up)(/|$)).*$')
    ->name('storefront.shell');
