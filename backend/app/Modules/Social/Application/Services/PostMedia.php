<?php

namespace App\Modules\Social\Application\Services;

use App\Modules\Media\Application\Contracts\MediaLibrary;
use App\Modules\Products\Application\Contracts\ProductDirectory;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Social\Infrastructure\Models\SocialPost;

/**
 * P2b: a post's photos — product photos (Products) and media library items (Media) — resolved
 * through the owning modules' contracts, in the post's order.
 */
class PostMedia
{
    public function __construct(
        private readonly ProductDirectory $products,
        private readonly MediaLibrary $media,
        private readonly TenantContext $tenant,
    ) {}

    /**
     * The organization's photos among these ids (unknown and others' left out), keyed by id.
     *
     * @param  list<string>  $ids
     * @return array<string, array{id: string, url: string, mime_type: string}>
     */
    public function productImages(array $ids): array
    {
        return $ids === [] ? [] : $this->products->images($this->tenant->requireOrganization(), $ids);
    }

    /**
     * @param  list<string>  $ids
     * @return array<string, array{id: string, url: string, mime_type: string}>
     */
    public function mediaItems(array $ids): array
    {
        return $ids === [] ? [] : $this->media->originals($ids);
    }

    /**
     * The post's photos that still exist, in order (deleted ones left out).
     *
     * @param  list<SocialPost>  $posts  resolved together (lists)
     * @return array<string, list<array{id: string, kind: string, url: string, mime_type: string}>> by post id
     */
    public function forPosts(array $posts): array
    {
        $imageIds = [];
        $mediaIds = [];
        foreach ($posts as $post) {
            array_push($imageIds, ...$post->mediaIds(SocialPost::KIND_PRODUCT_IMAGE));
            array_push($mediaIds, ...$post->mediaIds(SocialPost::KIND_MEDIA));
        }
        $found = [
            SocialPost::KIND_PRODUCT_IMAGE => $this->productImages(array_values(array_unique($imageIds))),
            SocialPost::KIND_MEDIA => $this->mediaItems(array_values(array_unique($mediaIds))),
        ];

        $result = [];
        foreach ($posts as $post) {
            $result[$post->id] = [];
            foreach ($post->media as $item) {
                $file = $found[$item['kind'] ?? ''][$item['id'] ?? ''] ?? null;
                if ($file !== null) {
                    $result[$post->id][] = ['id' => $file['id'], 'kind' => (string) $item['kind'], 'url' => $file['url'], 'mime_type' => $file['mime_type']];
                }
            }
        }

        return $result;
    }

    /**
     * @return list<array{id: string, kind: string, url: string, mime_type: string}>
     */
    public function forPost(SocialPost $post): array
    {
        return $this->forPosts([$post])[$post->id];
    }
}
