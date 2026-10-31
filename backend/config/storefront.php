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

];
