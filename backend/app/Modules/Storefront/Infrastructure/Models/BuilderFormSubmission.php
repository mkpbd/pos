<?php

namespace App\Modules\Storefront\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * B8b: what a visitor sent with a builder `form` element (FormAnswers): the form title and field
 * labels as snapshots, the answers, the reply-to address, the visitor's language, page, IP and
 * browser. Staff only change the status (new → read → archived) or delete it. `document_id` is
 * no foreign key: the messages outlive the page or popup they were sent from.
 *
 * @property string $id
 * @property string $organization_id
 * @property string $document_id
 * @property string $element_id
 * @property string $form_title
 * @property list<array{id: string, label: string, kind: string}> $fields
 * @property array<string, mixed> $values
 * @property ?string $reply_to
 * @property ?string $locale
 * @property ?string $page_path
 * @property ?string $ip
 * @property ?string $user_agent
 * @property string $status
 * @property ?CarbonImmutable $read_at
 * @property ?string $read_by
 * @property ?CarbonImmutable $created_at
 * @property ?CarbonImmutable $updated_at
 */
#[Fillable(['organization_id', 'document_id', 'element_id', 'form_title', 'fields', 'values', 'reply_to', 'locale', 'page_path', 'ip', 'user_agent', 'status', 'read_at', 'read_by'])]
class BuilderFormSubmission extends Model
{
    use BelongsToOrganization, HasUuids;

    public const STATUS_NEW = 'new';

    public const STATUS_READ = 'read';

    public const STATUS_ARCHIVED = 'archived';

    public const STATUSES = [self::STATUS_NEW, self::STATUS_READ, self::STATUS_ARCHIVED];

    protected $attributes = [
        'status' => self::STATUS_NEW,
    ];

    protected function casts(): array
    {
        return [
            'fields' => 'array',
            'values' => 'array',
            'read_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }
}
