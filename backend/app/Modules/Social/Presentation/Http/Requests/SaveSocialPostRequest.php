<?php

namespace App\Modules\Social\Presentation\Http\Requests;

use App\Modules\Social\Domain\Caption;
use App\Modules\Social\Domain\PostTarget;
use App\Modules\Social\Infrastructure\Models\SocialPost;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

/**
 * P2b: the shape of a social post (create: caption and targets required; update: any subset).
 * Ownership of photos, product, campaign and the link path are checked by SaveSocialPost.
 */
class SaveSocialPostRequest extends FormRequest
{
    /**
     * @return array<string, list<mixed>>
     */
    public function rules(): array
    {
        $creating = $this->isMethod('post');

        return [
            'caption' => [$creating ? 'required' : 'sometimes', 'string', 'min:1', 'max:'.Caption::MAX],
            'targets' => [$creating ? 'required' : 'sometimes', 'array', 'min:1', 'max:2'],
            'targets.*' => ['string', 'distinct', Rule::in(PostTarget::values())],
            'image_ids' => ['sometimes', 'nullable', 'array', 'max:'.SocialPost::MAX_MEDIA],
            'image_ids.*' => ['uuid', 'distinct'],
            'media_ids' => ['sometimes', 'nullable', 'array', 'max:'.SocialPost::MAX_MEDIA],
            'media_ids.*' => ['uuid', 'distinct'],
            'link_url' => ['sometimes', 'nullable', 'string', 'max:255'],
            'product_id' => ['sometimes', 'nullable', 'uuid'],
            'campaign_id' => ['sometimes', 'nullable', 'uuid'],
            'scheduled_at' => ['sometimes', 'nullable', 'date'],
        ];
    }

    public function after(): array
    {
        return [function (Validator $validator) {
            $count = count((array) $this->input('image_ids', [])) + count((array) $this->input('media_ids', []));
            if ($count > SocialPost::MAX_MEDIA) {
                $validator->errors()->add('media_ids', 'A post can have at most '.SocialPost::MAX_MEDIA.' photos.');
            }
        }];
    }

    /**
     * @return array<string, mixed>
     */
    public function attributesForSave(): array
    {
        $data = $this->validated();
        foreach (['image_ids', 'media_ids'] as $key) {
            if (array_key_exists($key, $data) && $data[$key] === null) {
                $data[$key] = [];
            }
        }

        return $data;
    }
}
