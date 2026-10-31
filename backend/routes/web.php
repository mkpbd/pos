<?php

use Illuminate\Support\Facades\Route;

// The UI is the separate React SPA (frontend/). The backend root only identifies the API.
Route::get('/', fn () => response()->json([
    'name' => config('app.name'),
    'api' => url('/api/v1'),
    'health' => url('/api/v1/health'),
]));
