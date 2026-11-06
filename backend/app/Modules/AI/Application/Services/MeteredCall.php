<?php

namespace App\Modules\AI\Application\Services;

use App\Modules\AI\Domain\Llm\Usage;

/**
 * What an AI request reports for its usage row while it runs.
 */
final class MeteredCall
{
    public Usage $usage;

    /** @var list<array{name: string, params: array<string, mixed>, ok: bool}> */
    public array $tools = [];

    public ?string $summary = null;

    /** ok | refused */
    public string $status = 'ok';

    public function __construct(public ?string $model)
    {
        $this->usage = new Usage;
    }
}
