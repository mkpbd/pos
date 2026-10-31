<?php

namespace Database\Seeders;

use App\Modules\Cms\Application\Actions\ManageFaq;
use App\Modules\Cms\Application\Actions\SavePage;
use App\Modules\Cms\Infrastructure\Models\CmsPage;
use App\Modules\Cms\Infrastructure\Models\FaqItem;
use App\Modules\Media\Application\Actions\UploadMedia;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Storefront\Application\Actions\ManageBanners;
use App\Modules\Storefront\Application\Actions\ManageHomepageSections;
use App\Modules\Storefront\Application\Actions\ReplaceMenuItems;
use App\Modules\Storefront\Application\Actions\SaveMenu;
use App\Modules\Storefront\Application\Actions\SaveStorefrontDomain;
use App\Modules\Storefront\Application\Actions\SaveStorefrontSettings;
use App\Modules\Storefront\Infrastructure\Models\Banner;
use App\Modules\Storefront\Infrastructure\Models\HomepageSection;
use App\Modules\Storefront\Infrastructure\Models\Menu;
use App\Modules\Storefront\Infrastructure\Models\StorefrontDomain;
use Illuminate\Database\Seeder;
use Illuminate\Http\UploadedFile;

/**
 * An open demo storefront on the local development host (STOREFRONT_DEFAULT_HOST,
 * default shop.localhost), created through the real use cases: content pages, FAQ,
 * banners (plain generated artwork, no third-party images) and a homepage. Menus only
 * link to pages that exist in this phase.
 */
class DemoStorefrontSeeder extends Seeder
{
    public function run(
        string $organizationId,
        TenantContext $tenant,
        SaveStorefrontDomain $saveDomain,
        SaveStorefrontSettings $saveSettings,
        SaveMenu $saveMenu,
        ReplaceMenuItems $replaceItems,
        SavePage $pages,
        ManageFaq $faq,
        UploadMedia $upload,
        ManageBanners $banners,
        ManageHomepageSections $sections,
    ): void {
        $host = (string) (config('storefront.default_host') ?: 'shop.localhost');

        $tenant->runAs($organizationId, function () use ($host, $saveDomain, $saveSettings, $saveMenu, $replaceItems, $pages, $faq, $upload, $banners, $sections) {
            $saveDomain(new StorefrontDomain, ['host' => $host]);
            $saveSettings([
                'is_enabled' => true,
                'site_name' => 'Demo Mart',
                'meta_description' => 'Groceries and household goods from Demo Mart, Dhaka.',
            ]);

            $about = $pages->save(new CmsPage, [
                'slug' => 'about-us',
                'title' => 'About us',
                'status' => 'published',
                'body_html' => '<h2>Your neighbourhood store, online</h2><p>Demo Mart has served Dhanmondi since 2012. Order the groceries and household goods you know from our shelves and we deliver them the same day.</p>',
            ]);
            $faqPage = $pages->save(new CmsPage, [
                'slug' => 'faq',
                'title' => 'Frequently asked questions',
                'template' => 'faq',
                'status' => 'published',
                'body_html' => '<p>Can\'t find your answer? Write to us from the contact page.</p>',
            ]);
            $contact = $pages->save(new CmsPage, [
                'slug' => 'contact',
                'title' => 'Contact us',
                'template' => 'contact',
                'status' => 'published',
                'body_html' => '<p>Questions about an order or a product? Send us a message and we reply within one working day.</p>',
            ]);
            $privacy = $pages->save(new CmsPage, [
                'slug' => 'privacy-policy',
                'title' => 'Privacy policy',
                'status' => 'published',
                'body_html' => '<h2>What we collect</h2><p>Your name, phone number, e-mail and delivery address, only to process your orders.</p><h2>Newsletter</h2><p>We send news only after you confirm your address, and every e-mail has an unsubscribe link.</p>',
            ]);

            foreach ([
                ['Delivery', 'Where do you deliver?', '<p>Everywhere inside Dhaka city.</p>'],
                ['Delivery', 'How fast is delivery?', '<p>Orders placed before 4 pm arrive the same day.</p>'],
                ['Payments', 'Which payment methods do you accept?', '<p>Cash on delivery, cards and mobile banking.</p>'],
                [null, 'Can I return a product?', '<p>Unopened products can be returned within 7 days with the receipt.</p>'],
            ] as [$group, $question, $answer]) {
                $faq->save(new FaqItem, ['group' => $group, 'question' => $question, 'answer_html' => $answer]);
            }

            $image = fn (string $name, array $from, array $to, int $width, int $height) => $upload($this->artwork($name, $from, $to, $width, $height), null)['media']->id;

            $hero1 = $banners->save(new Banner, [
                'placement' => 'hero_slider', 'name' => 'Fresh week', 'kicker' => 'This week',
                'title' => 'Fresh vegetables every morning', 'subtitle' => 'Picked up from Kawran Bazar at dawn, at your door by noon.',
                'button_label' => 'About us', 'link_url' => '/pages/about-us',
                'desktop_media_id' => $image('hero-fresh.jpg', [47, 133, 90], [16, 74, 50], 1600, 600),
                'text_color' => '#ffffff',
            ]);
            $hero2 = $banners->save(new Banner, [
                'placement' => 'hero_slider', 'name' => 'Same-day delivery', 'kicker' => 'Dhaka',
                'title' => 'Same-day delivery', 'subtitle' => 'Order before 4 pm.',
                'button_label' => 'Delivery questions', 'link_url' => '/pages/faq',
                'desktop_media_id' => $image('hero-delivery.jpg', [111, 85, 194], [52, 36, 110], 1600, 600),
                'text_color' => '#ffffff', 'text_position' => 'center',
            ]);
            $tiles = [];
            foreach ([['Household', [194, 65, 12], [120, 35, 5]], ['Snacks', [3, 105, 161], [8, 60, 100]], ['Personal care', [190, 24, 93], [110, 15, 55]]] as $i => [$title, $from, $to]) {
                $tiles[] = $banners->save(new Banner, [
                    'placement' => 'home_promo', 'name' => $title, 'title' => $title, 'subtitle' => 'In store and online',
                    'link_url' => '/pages/about-us',
                    'desktop_media_id' => $image("tile-{$i}.jpg", $from, $to, 800, 600),
                ])->id;
            }

            $sections->save(new HomepageSection, ['type' => 'hero_slider', 'banner_ids' => [$hero1->id, $hero2->id]]);
            $sections->save(new HomepageSection, ['type' => 'features_strip', 'config' => ['items' => [
                ['icon' => 'truck', 'title' => 'Same-day delivery', 'text' => 'Inside Dhaka, order before 4 pm'],
                ['icon' => 'credit-card', 'title' => 'Pay your way', 'text' => 'Cash on delivery, cards, mobile banking'],
                ['icon' => 'rotate-ccw', 'title' => '7-day returns', 'text' => 'Unopened products, with receipt'],
                ['icon' => 'headset', 'title' => 'Real people', 'text' => 'Call us 9 am to 9 pm'],
            ]]]);
            $sections->save(new HomepageSection, ['type' => 'banner_grid', 'title' => 'Shop by aisle', 'config' => ['layout' => '3-col'], 'banner_ids' => $tiles]);
            $sections->save(new HomepageSection, ['type' => 'rich_text', 'title' => 'Welcome to Demo Mart', 'config' => [
                'alignment' => 'center',
                'body_html' => '<p>The same prices as in our store, packed by the people you know. Read <a href="/pages/about-us">our story</a> or check the <a href="/pages/faq">FAQ</a>.</p>',
            ]]);
            $sections->save(new HomepageSection, ['type' => 'testimonials', 'title' => 'What neighbours say', 'config' => ['items' => [
                ['quote' => 'My weekly groceries arrive before lunch. I have not queued at a counter for months.', 'name' => 'Nusrat J.', 'role' => 'Dhanmondi', 'rating' => 5],
                ['quote' => 'Friendly staff and honest prices, online too.', 'name' => 'Arif H.', 'role' => 'Lalmatia', 'rating' => 5],
            ]]]);
            $sections->save(new HomepageSection, ['type' => 'newsletter', 'title' => 'Weekly offers in your inbox', 'config' => ['text' => 'One e-mail a week. Unsubscribe any time.']]);

            $main = $saveMenu->save(new Menu, ['name' => 'Main navigation', 'location' => 'main']);
            $replaceItems($main, [
                ['label' => 'Home', 'url' => '/'],
                ['type' => 'page', 'label' => 'About us', 'target_id' => $about->id],
                ['type' => 'page', 'label' => 'FAQ', 'target_id' => $faqPage->id],
                ['type' => 'page', 'label' => 'Contact', 'target_id' => $contact->id],
            ]);

            $footer = $saveMenu->save(new Menu, ['name' => 'Demo Mart', 'location' => 'footer_1']);
            $replaceItems($footer, [
                ['label' => 'Home', 'url' => '/'],
                ['type' => 'page', 'label' => 'About us', 'target_id' => $about->id],
            ]);
            $help = $saveMenu->save(new Menu, ['name' => 'Help', 'location' => 'footer_2']);
            $replaceItems($help, [
                ['type' => 'page', 'label' => 'FAQ', 'target_id' => $faqPage->id],
                ['type' => 'page', 'label' => 'Contact us', 'target_id' => $contact->id],
                ['type' => 'page', 'label' => 'Privacy policy', 'target_id' => $privacy->id],
            ]);
        });
    }

    /**
     * A plain diagonal gradient with soft circles, generated with GD: demo artwork without
     * licensing questions.
     *
     * @param  array{int, int, int}  $from
     * @param  array{int, int, int}  $to
     */
    private function artwork(string $name, array $from, array $to, int $width, int $height): UploadedFile
    {
        $img = imagecreatetruecolor($width, $height);
        for ($x = 0; $x < $width; $x += 4) {
            $t = $x / $width;
            $color = imagecolorallocate($img, ...array_map(fn (int $a, int $b) => (int) round($a + ($b - $a) * $t), $from, $to));
            imagefilledrectangle($img, $x, 0, $x + 3, $height, $color);
        }
        $soft = imagecolorallocatealpha($img, 255, 255, 255, 110);
        imagefilledellipse($img, (int) ($width * 0.82), (int) ($height * 0.3), (int) ($height * 0.9), (int) ($height * 0.9), $soft);
        imagefilledellipse($img, (int) ($width * 0.68), (int) ($height * 0.85), (int) ($height * 0.5), (int) ($height * 0.5), $soft);

        $path = tempnam(sys_get_temp_dir(), 'demo').'.jpg';
        imagejpeg($img, $path, 85);
        imagedestroy($img);

        return new UploadedFile($path, $name, 'image/jpeg', null, true);
    }
}
