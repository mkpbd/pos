<?php

namespace Database\Seeders;

use App\Modules\Catalog\Infrastructure\Models\Brand;
use App\Modules\Catalog\Infrastructure\Models\Category;
use App\Modules\Cms\Infrastructure\Models\BlogCategory;
use App\Modules\Cms\Infrastructure\Models\BlogPost;
use App\Modules\Cms\Infrastructure\Models\CmsPage;
use App\Modules\Cms\Infrastructure\Models\FaqItem;
use App\Modules\OnlineCatalog\Infrastructure\Models\BrandListing;
use App\Modules\OnlineCatalog\Infrastructure\Models\CategoryListing;
use App\Modules\OnlineCatalog\Infrastructure\Models\ProductListing;
use App\Modules\OnlinePayments\Infrastructure\Models\PaymentGatewaySetting;
use App\Modules\Products\Infrastructure\Models\Product;
use App\Modules\Shared\Application\Contracts\HtmlSanitizer;
use App\Modules\Shared\Application\Support\TranslationInput;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shipping\Infrastructure\Models\ShippingMethod;
use App\Modules\Storefront\Infrastructure\Models\Banner;
use App\Modules\Storefront\Infrastructure\Models\HomepageSection;
use App\Modules\Storefront\Infrastructure\Models\MenuItem;
use App\Modules\Storefront\Infrastructure\Models\StorefrontSettings;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Seeder;

/**
 * Bangla content for the demo storefront (E12b): Bangla on, English default, Latin digits;
 * translations of every category and brand, the five listed products (names and short
 * descriptions), the main and footer menu labels, the hero and promo banners (and the
 * popup), the homepage section titles (plus the text block and newsletter texts), the About
 * us / FAQ / Contact page titles with the FAQ entries, both blog categories and two posts
 * (title and excerpt), the delivery methods and cash on delivery.
 *
 * Only `translations` columns are written: every seeded record, number and stock level stays
 * as the other demo seeders left it (the full-stack tests rely on them).
 */
class DemoTranslationsSeeder extends Seeder
{
    public function run(string $organizationId, TenantContext $tenant, HtmlSanitizer $sanitizer): void
    {
        $tenant->runAs($organizationId, function () use ($sanitizer) {
            StorefrontSettings::query()->firstOrFail()->forceFill(['bangla_enabled' => true, 'default_locale' => 'en', 'bangla_digits' => false])->save();

            $bn = function (?Model $record, array $fields) use ($sanitizer) {
                if ($record !== null) {
                    $record->forceFill(['translations' => TranslationInput::apply($record->getAttribute('translations'), ['bn' => $fields], array_keys($fields), ['body_html', 'answer_html'], $sanitizer)])->save();
                }
            };

            foreach (['Grocery' => 'মুদি পণ্য', 'Beverages' => 'পানীয়', 'Rice & Grains' => 'চাল ও শস্য', 'Apparel' => 'পোশাক'] as $name => $translated) {
                $category = Category::query()->where('name', $name)->first();
                $bn($category === null ? null : CategoryListing::query()->where('category_id', $category->id)->first(), ['name' => $translated]);
            }
            foreach ([
                'Pran' => ['name' => 'প্রাণ', 'description' => 'বাংলাদেশের জুস, পানীয় ও স্ন্যাকস।'],
                'Local Mills' => ['name' => 'লোকাল মিলস', 'description' => 'স্থানীয়ভাবে ভাঙানো চাল ও শস্য।'],
            ] as $name => $fields) {
                $brand = Brand::query()->where('name', $name)->first();
                $bn($brand === null ? null : BrandListing::query()->where('brand_id', $brand->id)->first(), $fields);
            }

            foreach ([
                'Pran Mango Juice 250ml' => ['name' => 'প্রাণ ম্যাঙ্গো জুস ২৫০ মি.লি.', 'short_description' => 'আসল আমের পাল্প, কোনো কৃত্রিম রং নেই।'],
                'Pran Litchi Drink 250ml' => ['name' => 'প্রাণ লিচু ড্রিংক ২৫০ মি.লি.', 'short_description' => 'মিষ্টি লিচুর পানীয়, ঠান্ডা পরিবেশন করুন।'],
                'Miniket Rice' => ['name' => 'মিনিকেট চাল', 'short_description' => 'সরু মিনিকেট চাল, কেজি দরে খোলা বিক্রি।'],
                'Chinigura Aromatic Rice' => ['name' => 'চিনিগুঁড়া সুগন্ধি চাল', 'short_description' => 'পোলাওয়ের জন্য ছোট দানার সুগন্ধি চাল।'],
                'Cotton Polo Shirt' => ['name' => 'সুতি পোলো শার্ট', 'short_description' => 'তিন সাইজে আরামদায়ক পিকে সুতি।'],
            ] as $name => $fields) {
                $product = Product::query()->where('name', $name)->first();
                $bn($product === null ? null : ProductListing::query()->where('product_id', $product->id)->first(), $fields);
            }

            $labels = [
                'Home' => 'হোম', 'Shop' => 'শপ', 'Grocery' => 'মুদি পণ্য', 'Beverages' => 'পানীয়', 'Rice & Grains' => 'চাল ও শস্য',
                'Apparel' => 'পোশাক', 'Blog' => 'ব্লগ', 'About us' => 'আমাদের কথা', 'FAQ' => 'প্রশ্নোত্তর', 'Contact' => 'যোগাযোগ',
                'Contact us' => 'যোগাযোগ করুন', 'Privacy policy' => 'গোপনীয়তা নীতি',
            ];
            foreach (MenuItem::query()->get() as $item) {
                if (isset($labels[$item->label])) {
                    $bn($item, ['label' => $labels[$item->label]]);
                }
            }

            foreach ([
                'Fresh week' => ['kicker' => 'এই সপ্তাহে', 'title' => 'প্রতিদিন সকালে তাজা সবজি', 'subtitle' => 'ভোরে কারওয়ান বাজার থেকে তোলা, দুপুরের মধ্যে আপনার দরজায়।', 'button_label' => 'আমাদের কথা'],
                'Same-day delivery' => ['kicker' => 'ঢাকা', 'title' => 'একই দিনে ডেলিভারি', 'subtitle' => 'বিকেল ৪টার আগে অর্ডার করুন।', 'button_label' => 'ডেলিভারি সংক্রান্ত প্রশ্ন'],
                'Household' => ['title' => 'গৃহস্থালি', 'subtitle' => 'দোকানে ও অনলাইনে'],
                'Snacks' => ['title' => 'স্ন্যাকস', 'subtitle' => 'দোকানে ও অনলাইনে'],
                'Personal care' => ['title' => 'ব্যক্তিগত যত্ন', 'subtitle' => 'দোকানে ও অনলাইনে'],
                'Free delivery popup' => ['title' => '৳৩০০০-এর বেশি অর্ডারে ফ্রি ডেলিভারি', 'subtitle' => 'ঢাকার ভেতরে, ৳৩০০০-এর বেশি প্রতিটি অর্ডারে।', 'button_label' => 'এখনই কিনুন'],
            ] as $name => $fields) {
                $bn(Banner::query()->where('name', $name)->first(), $fields);
            }

            $sections = [
                'Hot deals' => ['title' => 'হট ডিল', 'subtitle' => 'শিগগিরই শেষ — সময় থাকতেই নিয়ে নিন'],
                'Featured products' => ['title' => 'বাছাই করা পণ্য', 'subtitle' => 'আমাদের দলের বাছাই'],
                'Shop by category' => ['title' => 'ক্যাটাগরি অনুযায়ী কিনুন'],
                'Our products' => ['title' => 'আমাদের পণ্য'],
                'Shop by aisle' => ['title' => 'তাক অনুযায়ী কিনুন'],
                'Welcome to Demo Mart' => ['title' => 'ডেমো মার্টে স্বাগতম', 'body_html' => '<p>আমাদের দোকানের দামেই, চেনা মানুষের হাতে প্যাক করা। পড়ুন <a href="/pages/about-us">আমাদের গল্প</a> অথবা দেখুন <a href="/pages/faq">প্রশ্নোত্তর</a>।</p>'],
                'What neighbours say' => ['title' => 'প্রতিবেশীরা যা বলেন'],
                'From our blog' => ['title' => 'আমাদের ব্লগ থেকে', 'subtitle' => 'ডেমো মার্টের রেসিপি ও খবর'],
                'Weekly offers in your inbox' => ['title' => 'সাপ্তাহিক অফার আপনার ইনবক্সে', 'text' => 'সপ্তাহে একটি ই-মেইল। যেকোনো সময় আনসাবস্ক্রাইব করুন।', 'button_label' => 'সাবস্ক্রাইব'],
            ];
            foreach ($sections as $title => $fields) {
                $bn(HomepageSection::query()->where('title', $title)->first(), $fields);
            }

            foreach (['about-us' => 'আমাদের কথা', 'faq' => 'সাধারণ জিজ্ঞাসা', 'contact' => 'যোগাযোগ করুন'] as $slug => $title) {
                $bn(CmsPage::query()->where('slug', $slug)->first(), ['title' => $title]);
            }
            foreach ([
                'Where do you deliver?' => ['question' => 'আপনারা কোথায় ডেলিভারি দেন?', 'answer_html' => '<p>ঢাকা শহরের সব জায়গায়।</p>'],
                'How fast is delivery?' => ['question' => 'ডেলিভারি কত দ্রুত হয়?', 'answer_html' => '<p>বিকেল ৪টার আগে দেওয়া অর্ডার একই দিনে পৌঁছে যায়।</p>'],
                'Which payment methods do you accept?' => ['question' => 'কোন কোন পেমেন্ট পদ্ধতি গ্রহণ করেন?', 'answer_html' => '<p>ক্যাশ অন ডেলিভারি, কার্ড ও মোবাইল ব্যাংকিং।</p>'],
                'Can I return a product?' => ['question' => 'আমি কি পণ্য ফেরত দিতে পারি?', 'answer_html' => '<p>রসিদসহ ৭ দিনের মধ্যে না খোলা পণ্য ফেরত দেওয়া যায়।</p>'],
            ] as $question => $fields) {
                $bn(FaqItem::query()->where('question', $question)->first(), $fields);
            }

            $bn(BlogCategory::query()->where('slug', 'recipes')->first(), ['name' => 'রেসিপি', 'description' => 'আমাদের তাকের উপকরণে সহজ রান্না।']);
            $bn(BlogCategory::query()->where('slug', 'store-news')->first(), ['name' => 'দোকানের খবর', 'description' => 'খোলার সময়, নতুন পণ্য আর ডেমো মার্টের খবর।']);
            $bn(BlogPost::query()->where('slug', 'mango-lassi')->first(), ['title' => 'পাঁচ মিনিটে ঠান্ডা ম্যাঙ্গো লাচ্ছি', 'excerpt' => 'পাকা আম, দই আর এক চিমটি এলাচ: মৌসুমের পানীয়।']);
            $bn(BlogPost::query()->where('slug', 'weeknight-khichuri')->first(), ['title' => 'সন্ধ্যার সহজ খিচুড়ি', 'excerpt' => 'চাল, ডাল আর সবজি এক হাঁড়িতে: বৃষ্টির সন্ধ্যার আরামের খাবার।']);

            $bn(ShippingMethod::query()->where('name', 'Home delivery')->first(), ['name' => 'হোম ডেলিভারি', 'description' => 'ঢাকার ভেতরে আপনার দরজায় পৌঁছে দেওয়া হয়।']);
            $bn(ShippingMethod::query()->where('name', 'Courier delivery')->first(), ['name' => 'কুরিয়ার ডেলিভারি', 'description' => 'সারা দেশে কুরিয়ার।']);
            $bn(PaymentGatewaySetting::query()->where('code', 'cod')->first(), ['display_name' => 'ক্যাশ অন ডেলিভারি', 'instructions' => 'অর্ডার পৌঁছালে নগদে পরিশোধ করুন।']);
        });
    }
}
