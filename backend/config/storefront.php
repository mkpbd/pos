<?php

return [

    /*
    | Storefront host used for requests to a local development host (localhost,
    | 127.0.0.1): lets one organization's store be browsed locally. Add the same host
    | as a domain of that organization in the admin. Leave empty in production.
    */
    'default_host' => env('STOREFRONT_DEFAULT_HOST'),

    'local_hosts' => ['localhost', '127.0.0.1'],

    /*
    | The built storefront page the shell serves (Vite output of frontend/storefront.html).
    */
    'shell_path' => env('STOREFRONT_SHELL_PATH', base_path('../frontend/dist/storefront.html')),

    /*
    | Product URLs per sitemap file (E12; the protocol allows 50 000, kept small for fast fetches).
    */
    'sitemap_products_per_file' => 5000,

    /*
    | T2: the public demo gallery (GET /api/v1/demo-stores and the /demos page) listing the
    | demo stores of DemoThemesSeeder, in this order. Off by default and always off in
    | production.
    */
    'demo_gallery' => env('APP_ENV') !== 'production' && filter_var(env('STOREFRONT_DEMO_GALLERY', false), FILTER_VALIDATE_BOOL),

    'demo_hosts' => ['vegan.shop.localhost', 'handmade.shop.localhost', 'classic.shop.localhost'],

];
