<?php

namespace App\Modules\Storefront\Domain\Builder\Wizard;

/**
 * B21: the wizard's recipes — for a page type and a goal, the ordered sections of the page, each
 * a section of a built-in template that already ships (`resources/builder-templates`). A recipe
 * is the page type's sections with the goal's sections at the goal's place; a slot appears once
 * (the first place wins). Slots that depend on the store are dropped when it lacks what they
 * show: `categories` without categories, `flash_sale` without a running flash sale, `coupon`
 * without a running coupon promotion, `reviews` without published reviews (the review wall shows
 * the store's real reviews; the wizard never adds sample testimonials). Pure: the caller says what the store has.
 *
 * @phpstan-type Slot array{template: string, section: int, label: string, label_bn: string, products: bool, needs: ?string}
 */
final class WizardRecipes
{
    /** Marks where the goal's sections go in a page type's list. */
    private const GOAL = '@goal';

    /**
     * slot => the template and section index it is taken from, the plain label shown while the
     * page is built (English and Bangla), whether it shows products and what it needs.
     *
     * @var array<string, Slot>
     */
    public const SLOTS = [
        'hero' => ['template' => 'page-new-collection', 'section' => 0, 'label' => 'A big picture with your headline', 'label_bn' => 'শিরোনামসহ বড় ছবি', 'products' => false, 'needs' => null],
        'hero_sale' => ['template' => 'page-sale-landing', 'section' => 0, 'label' => 'A bold sale banner', 'label_bn' => 'সেলের বড় ব্যানার', 'products' => false, 'needs' => null],
        'hero_festival' => ['template' => 'festival-{festival}-hero', 'section' => 0, 'label' => 'A festival banner with a countdown', 'label_bn' => 'কাউন্টডাউনসহ উৎসবের ব্যানার', 'products' => false, 'needs' => null],
        'hero_plain' => ['template' => 'page-about', 'section' => 0, 'label' => 'A headline with a short welcome', 'label_bn' => 'শিরোনাম ও ছোট্ট স্বাগত বার্তা', 'products' => false, 'needs' => null],
        'flash_sale' => ['template' => 'classic-flash-sale', 'section' => 0, 'label' => 'Your running flash sale', 'label_bn' => 'চলমান ফ্ল্যাশ সেল', 'products' => false, 'needs' => 'flash_sale'],
        'coupon' => ['template' => 'landing-eid-sale', 'section' => 2, 'label' => 'Your discount code', 'label_bn' => 'আপনার ছাড়ের কোড', 'products' => false, 'needs' => 'coupon'],
        'spotlight' => ['template' => 'landing-order', 'section' => 0, 'label' => 'Your product up close', 'label_bn' => 'আপনার পণ্য কাছ থেকে', 'products' => true, 'needs' => null],
        'categories' => ['template' => 'classic-categories', 'section' => 0, 'label' => 'Your categories', 'label_bn' => 'আপনার ক্যাটাগরি', 'products' => false, 'needs' => 'categories'],
        'products' => ['template' => 'classic-best-sellers', 'section' => 0, 'label' => 'Your products', 'label_bn' => 'আপনার পণ্য', 'products' => true, 'needs' => null],
        'products_carousel' => ['template' => 'vegan-best-sellers', 'section' => 0, 'label' => 'A sliding row of products', 'label_bn' => 'পণ্যের স্লাইডিং সারি', 'products' => true, 'needs' => null],
        'order_form' => ['template' => 'landing-order', 'section' => 5, 'label' => 'An order form (cash on delivery)', 'label_bn' => 'অর্ডার ফর্ম (ক্যাশ অন ডেলিভারি)', 'products' => true, 'needs' => null],
        'phone_form' => ['template' => 'landing-lead', 'section' => 1, 'label' => 'A "call me back" form for phone numbers', 'label_bn' => 'ফোন নম্বর নেওয়ার "কল করুন" ফর্ম', 'products' => false, 'needs' => null],
        'story' => ['template' => 'neutral-scroll-story', 'section' => 0, 'label' => 'Your story in steps', 'label_bn' => 'ধাপে ধাপে আপনার গল্প', 'products' => false, 'needs' => null],
        'about_story' => ['template' => 'page-about', 'section' => 1, 'label' => 'How it started', 'label_bn' => 'কীভাবে শুরু', 'products' => false, 'needs' => null],
        'values' => ['template' => 'page-about', 'section' => 2, 'label' => 'What you stand for', 'label_bn' => 'আপনার মূল্যবোধ', 'products' => false, 'needs' => null],
        'why_us' => ['template' => 'neutral-why-us-animated', 'section' => 0, 'label' => 'Why shop with you', 'label_bn' => 'কেন আপনার কাছ থেকে কিনবে', 'products' => false, 'needs' => null],
        'trust' => ['template' => 'neutral-trust-strip', 'section' => 0, 'label' => 'Trust badges', 'label_bn' => 'ভরসার ব্যাজ', 'products' => false, 'needs' => null],
        // The store's real published reviews — never sample testimonials with made-up names.
        'reviews' => ['template' => 'neutral-review-wall', 'section' => 0, 'label' => 'Real reviews from your customers', 'label_bn' => 'আপনার ক্রেতাদের আসল রিভিউ', 'products' => false, 'needs' => 'reviews'],
        'faq' => ['template' => 'neutral-faq-accordion', 'section' => 0, 'label' => 'Questions and answers', 'label_bn' => 'প্রশ্ন ও উত্তর', 'products' => false, 'needs' => null],
        'contact_form' => ['template' => 'neutral-contact-form', 'section' => 0, 'label' => 'A contact form', 'label_bn' => 'যোগাযোগের ফর্ম', 'products' => false, 'needs' => null],
        'visit' => ['template' => 'neutral-store-map', 'section' => 0, 'label' => 'Your contact details and map', 'label_bn' => 'যোগাযোগের তথ্য ও মানচিত্র', 'products' => false, 'needs' => null],
        'cta' => ['template' => 'neutral-cta-band', 'section' => 0, 'label' => 'A button to start shopping', 'label_bn' => 'কেনাকাটা শুরুর বোতাম', 'products' => false, 'needs' => null],
    ];

    /** @var array<string, list<string>> */
    private const PAGES = [
        'home' => ['hero', 'categories', 'products', self::GOAL, 'why_us', 'reviews'],
        'sale' => ['hero_sale', 'flash_sale', 'coupon', 'products', self::GOAL, 'trust', 'faq'],
        'product_launch' => ['hero', 'spotlight', self::GOAL, 'why_us', 'reviews', 'faq'],
        'about' => ['hero_plain', 'about_story', 'values', self::GOAL, 'reviews', 'cta'],
        'festival' => ['hero_festival', 'coupon', 'products', self::GOAL, 'trust'],
        'contact' => ['hero_plain', 'contact_form', 'visit', self::GOAL, 'faq'],
    ];

    /** @var array<string, list<string>> */
    private const GOALS = [
        'orders' => ['products', 'trust', 'cta'],
        'order_form' => ['spotlight', 'order_form', 'trust'],
        'phone_numbers' => ['phone_form', 'trust'],
        'show_collection' => ['categories', 'products_carousel', 'cta'],
        'tell_story' => ['story', 'cta'],
    ];

    /**
     * The recipe's slots in page order.
     *
     * @param  array{categories?: bool, flash_sale?: bool, coupon?: bool, reviews?: bool}  $store  what the store has
     * @return list<string>
     */
    public static function slots(string $pageType, string $goal, array $store = []): array
    {
        $slots = [];
        foreach (self::PAGES[$pageType] ?? [] as $slot) {
            foreach ($slot === self::GOAL ? (self::GOALS[$goal] ?? []) : [$slot] as $name) {
                $needs = self::SLOTS[$name]['needs'];
                if (! in_array($name, $slots, true) && ($needs === null || ($store[$needs] ?? false))) {
                    $slots[] = $name;
                }
            }
        }

        return $slots;
    }

    /**
     * Whether any of the slots shows products (the store needs live products for them).
     *
     * @param  list<string>  $slots
     */
    public static function needsProducts(array $slots): bool
    {
        foreach ($slots as $slot) {
            if (self::SLOTS[$slot]['products']) {
                return true;
            }
        }

        return false;
    }

    /**
     * The built-in template id of a slot (`{festival}` filled for the festival hero).
     */
    public static function template(string $slot, ?string $festival = null): string
    {
        return str_replace('{festival}', (string) $festival, self::SLOTS[$slot]['template']);
    }

    /**
     * Every template a recipe can use (for the shipped-templates test), festival heroes by key.
     *
     * @param  list<string>  $festivals
     * @return list<string>
     */
    public static function templates(array $festivals): array
    {
        $ids = [];
        foreach (array_keys(self::SLOTS) as $slot) {
            if ($slot === 'hero_festival') {
                foreach ($festivals as $festival) {
                    $ids[] = self::template($slot, $festival);
                }
            } else {
                $ids[] = self::template($slot);
            }
        }

        return array_values(array_unique($ids));
    }
}
