<?php

namespace App\Modules\Social\Domain\Meta;

/**
 * P2b: a Facebook Page the user manages, its Page access token and the Instagram business
 * account linked to it (null when none).
 */
final readonly class MetaPage
{
    /**
     * @param  array{id: string, username: string, picture_url: ?string}|null  $instagram
     */
    public function __construct(
        public string $id,
        public string $name,
        #[\SensitiveParameter] public string $accessToken,
        public ?string $pictureUrl = null,
        public ?array $instagram = null,
    ) {}

    /**
     * Stored form (encrypted at rest by the caller).
     *
     * @return array{id: string, name: string, access_token: string, picture_url: ?string, instagram: array{id: string, username: string, picture_url: ?string}|null}
     */
    public function toArray(): array
    {
        return ['id' => $this->id, 'name' => $this->name, 'access_token' => $this->accessToken, 'picture_url' => $this->pictureUrl, 'instagram' => $this->instagram];
    }

    /**
     * @param  array<string, mixed>  $data
     */
    public static function fromArray(array $data): self
    {
        $instagram = is_array($data['instagram'] ?? null) && is_string($data['instagram']['id'] ?? null)
            ? ['id' => (string) $data['instagram']['id'], 'username' => (string) ($data['instagram']['username'] ?? ''), 'picture_url' => is_string($data['instagram']['picture_url'] ?? null) ? $data['instagram']['picture_url'] : null]
            : null;

        return new self((string) $data['id'], (string) ($data['name'] ?? ''), (string) ($data['access_token'] ?? ''), is_string($data['picture_url'] ?? null) ? $data['picture_url'] : null, $instagram);
    }

    public function __debugInfo(): array
    {
        return ['id' => $this->id, 'name' => $this->name, 'accessToken' => '[redacted]', 'instagram' => $this->instagram];
    }
}
