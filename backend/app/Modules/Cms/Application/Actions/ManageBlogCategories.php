<?php

namespace App\Modules\Cms\Application\Actions;

use App\Modules\Cms\Application\Contracts\BlogReferences;
use App\Modules\Cms\Infrastructure\Models\BlogCategory;
use App\Modules\Cms\Infrastructure\Models\BlogPost;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Support\Changes;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use Illuminate\Contracts\Container\Container;
use Illuminate\Support\Facades\DB;

/**
 * Blog categories: save, reorder and delete. Deleting a category leaves its posts
 * uncategorised; a category a menu or homepage section links to cannot be deleted (IN_USE).
 * New categories go last.
 */
class ManageBlogCategories
{
    public const MAX_CATEGORIES = 100;

    public function __construct(
        private readonly AuditTrail $audit,
        private readonly Container $container,
    ) {}

    /**
     * @param  array<string, mixed>  $attributes  validated
     */
    public function save(BlogCategory $category, array $attributes): BlogCategory
    {
        if (isset($attributes['slug'])) {
            $attributes['slug'] = mb_strtolower($attributes['slug']);
        }
        if (array_key_exists('name', $attributes)) {
            $attributes['name'] = trim((string) $attributes['name']);
        }
        if (array_key_exists('description', $attributes) && is_string($attributes['description'])) {
            $attributes['description'] = trim($attributes['description']) === '' ? null : trim($attributes['description']);
        }

        return DB::transaction(function () use ($category, $attributes) {
            $creating = ! $category->exists;
            $before = $creating ? [] : $this->snapshot($category);

            if ($creating) {
                if (BlogCategory::query()->count() >= self::MAX_CATEGORIES) {
                    throw new BusinessRuleViolation('LIMIT_REACHED', 'The blog can have at most '.self::MAX_CATEGORIES.' categories.');
                }
                $attributes['sort_order'] ??= (int) BlogCategory::query()->max('sort_order') + 1;
            }
            $category->fill($attributes);
            $category->save();

            [$old, $new] = Changes::between($before, $this->snapshot($category));
            if ($creating || $new !== []) {
                $this->audit->record($creating ? 'blog_category.created' : 'blog_category.updated', $category, $old, $new);
            }

            return $category;
        });
    }

    /**
     * @param  list<string>  $ids  every category id, in the new order
     */
    public function reorder(array $ids): void
    {
        DB::transaction(function () use ($ids) {
            $existing = BlogCategory::query()->lockForUpdate()->pluck('id')->all();
            if (count($ids) !== count($existing) || array_diff($existing, $ids) !== []) {
                throw new BusinessRuleViolation('ORDER_MISMATCH', 'Send every blog category exactly once. Reload the list and try again.');
            }

            foreach (array_values($ids) as $position => $id) {
                BlogCategory::query()->whereKey($id)->update(['sort_order' => $position]);
            }
            $this->audit->record('blog_categories.reordered', null, [], ['ids' => array_values($ids)]);
        });
    }

    /**
     * @throws BusinessRuleViolation IN_USE
     */
    public function delete(BlogCategory $category): void
    {
        /** @var iterable<BlogReferences> $references */
        $references = $this->container->tagged(BlogReferences::TAG);
        foreach ($references as $reference) {
            if ($reference->uses(BlogReferences::CATEGORY, $category->id)) {
                throw new BusinessRuleViolation('IN_USE', ucfirst($reference->describe()).' still links to this category. Remove the link first.');
            }
        }

        DB::transaction(function () use ($category) {
            $posts = BlogPost::withTrashed()->where('category_id', $category->id)->update(['category_id' => null]);
            $category->delete();
            $this->audit->record('blog_category.deleted', $category, $this->snapshot($category) + ['uncategorised_posts' => $posts]);
        });
    }

    /**
     * @return array<string, mixed>
     */
    private function snapshot(BlogCategory $category): array
    {
        return [
            'name' => $category->name,
            'slug' => $category->slug,
            'description' => $category->description,
            'sort_order' => $category->sort_order,
        ];
    }
}
