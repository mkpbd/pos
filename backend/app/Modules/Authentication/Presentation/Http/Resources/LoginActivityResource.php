<?php

namespace App\Modules\Authentication\Presentation\Http\Resources;

use App\Modules\Authentication\Infrastructure\Models\LoginActivity;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin LoginActivity
 */
class LoginActivityResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'user_id' => $this->user_id,
            'email' => $this->email,
            'channel' => $this->channel,
            'succeeded' => $this->succeeded,
            'failure_reason' => $this->failure_reason,
            'ip_address' => $this->ip_address,
            'user_agent' => $this->user_agent,
            'created_at' => $this->created_at->toIso8601String(),
        ];
    }
}
