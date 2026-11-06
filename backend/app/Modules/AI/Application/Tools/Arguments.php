<?php

namespace App\Modules\AI\Application\Tools;

use Illuminate\Validation\ValidationException;

/**
 * Argument hygiene shared by the tools: only the parameters a tool declares are accepted — any
 * other key (organization_id, a product filter the tool does not offer, …) is rejected before
 * anything runs — and nulls / empty strings are dropped so defaults apply.
 */
final class Arguments
{
    /**
     * @param  array<string, mixed>  $input
     * @param  list<string>  $allowed
     * @return array<string, mixed>
     */
    public static function only(array $input, array $allowed): array
    {
        $unknown = array_values(array_diff(array_keys($input), $allowed));
        if ($unknown !== []) {
            throw ValidationException::withMessages(['arguments' => ['Unknown parameter(s): '.implode(', ', array_map('strval', $unknown)).'. Allowed: '.($allowed === [] ? 'none' : implode(', ', $allowed)).'.']]);
        }

        return array_filter($input, fn ($value) => $value !== null && $value !== '');
    }

    /**
     * @param  array<string, mixed>  $schemaProperties
     * @param  list<string>  $required
     * @return array<string, mixed>
     */
    public static function schema(array $schemaProperties, array $required = []): array
    {
        return [
            'type' => 'object',
            'properties' => $schemaProperties,
            'required' => $required,
            'additionalProperties' => false,
        ];
    }
}
