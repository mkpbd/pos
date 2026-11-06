<?php

return [

    /*
    | List exports (X1): every admin list answers `?export=xlsx|pdf|csv` with its normal filters.
    | Larger result sets are refused with 422 EXPORT_TOO_LARGE so the user narrows the filters.
    */
    'max_rows' => [
        'xlsx' => (int) env('EXPORT_MAX_ROWS_XLSX', 50000),
        'pdf' => (int) env('EXPORT_MAX_ROWS_PDF', 2000),
        // Phase 7: CSV (streamed to a file like xlsx).
        'csv' => (int) env('EXPORT_MAX_ROWS_CSV', 100000),
    ],

    // Exports per minute per user (the `exports` rate limiter).
    'rate_limit' => (int) env('EXPORT_RATE_LIMIT', 10),

    // Rows read from the database per query while streaming an export.
    'chunk_size' => (int) env('EXPORT_CHUNK_SIZE', 500),

];
