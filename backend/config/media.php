<?php

return [

    /*
    | Disk for the media library. "public" serves files same-origin under /storage;
    | in production point this at an S3-compatible disk whose URL is the CDN.
    */
    'disk' => env('MEDIA_DISK', 'public'),

    /*
    | B22a: AVIF uploads are accepted when PHP's GD reads AVIF; false refuses them anyway.
    */
    'avif' => true,

];
