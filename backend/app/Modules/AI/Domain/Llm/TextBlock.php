<?php

namespace App\Modules\AI\Domain\Llm;

final readonly class TextBlock
{
    public function __construct(public string $text) {}
}
