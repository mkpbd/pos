<?php

/**
 * Blush & Bloom — the beauty preset demo store (DemoThemesSeeder, B11). Same shape as fashion.php:
 * Bangla on, banners reuse the product photos (three hero tiles), ten photos (the sunscreen and
 * the comb have none). Shades as variants with swatches; no brands. Photo credits in
 * images/manifest.json.
 */
return [
    'name' => 'Blush & Bloom',
    'host' => 'beauty.shop.localhost',
    'preset' => 'beauty',
    'bangla' => true,
    'owner' => ['name' => 'Tasnuva Haque', 'email' => 'owner@beauty.test'],
    'branch' => 'Blush & Bloom Dhanmondi',
    'sku' => 'BB',
    'meta_description' => 'Skincare, makeup, hair care and fragrance chosen for South Asian skin and weather, delivered across Bangladesh by Blush & Bloom.',
    'free_delivery_over' => '2000.00',
    'coupon' => ['code' => 'GLOW15', 'name' => 'Glow 15', 'description' => '15% off orders over ৳2,500 with code GLOW15', 'percent' => '15', 'min' => '2500'],
    'flash_sale' => [
        'name' => 'Glow week', 'description' => '15% off four favourites for five days',
        'percent' => '15', 'days' => 5, 'products' => ['nail-polish', 'makeup-brushes', 'clay-mask', 'gel-moisturiser'],
    ],
    'out_of_stock' => 'wooden-comb',
    // Sold at the shop counter (POS): the best sellers.
    'best_sellers' => ['vitamin-c-serum' => 6, 'matte-lipstick' => 5, 'gel-moisturiser' => 4, 'clay-mask' => 3, 'handmade-soap' => 3, 'argan-hair-oil' => 2],
    'swatches' => ['Shade' => [
        'Rosewood' => '#9e5a63', 'Brick red' => '#a23a2c', 'Nude pink' => '#d8a39d',
        'Coral' => '#f2735b', 'Berry' => '#7b2045', 'Nude' => '#e3bfa8',
    ]],

    // slug => [name, photo, description, Bangla name]
    'categories' => [
        'skincare' => ['Skincare', 'vitamin-c-serum', 'Serums, moisturisers and masks for humid days and air-conditioned nights.', 'ত্বকের যত্ন'],
        'makeup' => ['Makeup', 'matte-lipstick', 'Lipsticks, palettes and nail colours in shades that suit warm skin tones.', 'মেকআপ'],
        'haircare' => ['Hair care', 'argan-hair-oil', 'Oils and treatments for soft, strong hair.', 'চুলের যত্ন'],
        'fragrance' => ['Fragrance', 'eau-de-parfum', 'Light floral perfumes for every day and evenings out.', 'সুগন্ধি'],
        'bath-body' => ['Bath & body', 'handmade-soap', 'Handmade soaps and gentle body care.', 'স্নান ও শরীরের যত্ন'],
        'tools' => ['Tools', 'makeup-brushes', 'Brushes and combs that make the routine easier.', 'সরঞ্জাম'],
    ],

    // The two products without a photo come first (the oldest), so the newest arrivals all have one.
    'products' => [
        'sunscreen' => ['name' => 'Daily Sunscreen SPF 50', 'category' => 'skincare', 'price' => '1290',
            'bn' => ['ডেইলি সানস্ক্রিন এসপিএফ ৫০', 'হালকা, সাদা দাগ ছাড়া প্রতিদিনের সানস্ক্রিন।'],
            'text' => 'A light, non-greasy sunscreen with SPF 50 that leaves no white cast. Wear it every morning, even indoors.'],
        'wooden-comb' => ['name' => 'Neem-wood Comb', 'category' => 'tools', 'price' => '390',
            'bn' => ['নিম কাঠের চিরুনি', 'মসৃণ দাঁতের নিম কাঠের চিরুনি, চুল টানে না।'],
            'text' => 'A hand-cut neem-wood comb with smooth, wide teeth that glide through hair without pulling.'],
        'handmade-soap' => ['name' => 'Handmade Soap Trio', 'category' => 'bath-body', 'price' => '590',
            'bn' => ['হাতে তৈরি সাবান (তিনটি)', 'নারকেল তেল আর ভেষজে হাতে তৈরি তিনটি সাবান।'],
            'text' => 'Three cold-process soaps made with coconut oil: turmeric, rose clay and charcoal. Gentle and long-lasting.'],
        'argan-hair-oil' => ['name' => 'Argan Hair Oil 100 ml', 'category' => 'haircare', 'price' => '1190', 'sale' => '990',
            'bn' => ['আরগান হেয়ার অয়েল ১০০ মি.লি.', 'চুল নরম আর ঝলমলে করে, চিটচিটে নয়।'],
            'text' => 'A light blend of argan and coconut oils that softens dry ends and tames frizz without feeling greasy.'],
        'nail-polish' => ['name' => 'Gel-shine Nail Polish', 'category' => 'makeup', 'price' => '450',
            'variants' => ['Shade' => ['Coral', 'Berry', 'Nude']],
            'bn' => ['জেল-শাইন নেইল পলিশ', 'জেলের মতো ঝকঝকে, এক সপ্তাহ টেকে।'],
            'text' => 'A glossy nail colour with a gel-like shine that lasts up to a week. Quick-drying and easy to apply.'],
        'makeup-brushes' => ['name' => 'Makeup Brush Set (8)', 'category' => 'tools', 'price' => '1490', 'featured' => true,
            'bn' => ['মেকআপ ব্রাশ সেট (৮টি)', 'ফাউন্ডেশন থেকে আইশ্যাডো, সবকিছুর জন্য নরম ব্রাশ।'],
            'text' => 'Eight soft synthetic brushes for foundation, powder, blush and eyes, with a roll-up pouch.'],
        'eau-de-parfum' => ['name' => 'Floral Eau de Parfum', 'category' => 'fragrance', 'price' => '2990', 'featured' => true,
            'variants' => ['Size' => ['30 ml' => ['2990', null], '50 ml' => ['3990', null]]],
            'bn' => ['ফ্লোরাল ও দ্য পারফিউম', 'গোলাপ আর বেলির হালকা, দীর্ঘস্থায়ী সুবাস।'],
            'text' => 'A soft floral perfume of rose, jasmine and a touch of sandalwood. Lasts from morning to evening.'],
        'clay-mask' => ['name' => 'Green Clay Face Mask', 'category' => 'skincare', 'price' => '990',
            'bn' => ['গ্রিন ক্লে ফেস মাস্ক', 'লোমকূপ পরিষ্কার করে, ত্বক শুষ্ক করে না।'],
            'text' => 'A gentle green clay mask that clears pores and calms the skin in ten minutes, without drying it out.'],
        'eyeshadow-palette' => ['name' => '12-shade Eyeshadow Palette', 'category' => 'makeup', 'price' => '2290', 'sale' => '1890', 'featured' => true,
            'bn' => ['১২ রঙের আইশ্যাডো প্যালেট', 'দিনের হালকা থেকে রাতের গাঢ় সাজ, এক প্যালেটে।'],
            'text' => 'Twelve warm mattes and shimmers, from soft everyday browns to deep evening shades. Rich and easy to blend.'],
        'gel-moisturiser' => ['name' => 'Hydrating Gel Moisturiser', 'category' => 'skincare', 'price' => '1450', 'featured' => true,
            'bn' => ['হাইড্রেটিং জেল ময়েশ্চারাইজার', 'আর্দ্র আবহাওয়ার জন্য হালকা জেল ময়েশ্চারাইজার।'],
            'text' => 'A cooling gel moisturiser with hyaluronic acid and aloe. Light enough for humid days, made for every skin type.'],
        'matte-lipstick' => ['name' => 'Velvet Matte Lipstick', 'category' => 'makeup', 'price' => '890', 'sale' => '750', 'featured' => true,
            'variants' => ['Shade' => ['Rosewood', 'Brick red', 'Nude pink']],
            'bn' => ['ভেলভেট ম্যাট লিপস্টিক', 'নরম ম্যাট ফিনিশ, ঠোঁট শুকায় না।'],
            'text' => 'A creamy lipstick that dries to a soft velvet matte without drying the lips. Shades made for warm skin tones.'],
        'vitamin-c-serum' => ['name' => 'Vitamin C Brightening Serum', 'category' => 'skincare', 'price' => '1890', 'sale' => '1590', 'featured' => true,
            'bn' => ['ভিটামিন সি ব্রাইটেনিং সিরাম', 'ত্বক উজ্জ্বল করে, দাগ হালকা করে।'],
            'text' => 'A light serum with 10 % vitamin C that brightens dull skin and fades dark spots. Use in the morning under sunscreen.'],
    ],

    // Banners reuse the product photos (`image`); three hero tiles for the tiles hero.
    'banners' => [
        'banner-hero-1' => ['image' => 'vitamin-c-serum', 'placement' => 'hero_slider', 'name' => 'Glow routine', 'kicker' => 'Skincare',
            'title' => 'Your glow routine', 'subtitle' => 'Serums and moisturisers made for humid days.',
            'button_label' => 'Shop skincare', 'link_url' => '/category/skincare', 'text_color' => '#ffffff', 'text_position' => 'left',
            'bn' => ['kicker' => 'ত্বকের যত্ন', 'title' => 'আপনার উজ্জ্বল ত্বকের রুটিন', 'subtitle' => 'আর্দ্র দিনের জন্য সিরাম আর ময়েশ্চারাইজার।', 'button_label' => 'দেখুন']],
        'banner-hero-2' => ['image' => 'matte-lipstick', 'placement' => 'hero_slider', 'name' => 'Lip colour', 'kicker' => 'New shades',
            'title' => 'Velvet lips, all day', 'subtitle' => 'Matte shades that suit warm skin tones.',
            'button_label' => 'Shop makeup', 'link_url' => '/category/makeup', 'text_color' => '#ffffff', 'text_position' => 'left',
            'bn' => ['kicker' => 'নতুন রং', 'title' => 'সারা দিন ভেলভেট ঠোঁট', 'subtitle' => 'উষ্ণ ত্বকের রঙে মানানো ম্যাট শেড।', 'button_label' => 'দেখুন']],
        'banner-hero-3' => ['image' => 'eau-de-parfum', 'placement' => 'hero_slider', 'name' => 'Fragrance', 'kicker' => 'Fragrance',
            'title' => 'A scent for every day', 'subtitle' => 'Rose, jasmine and a touch of sandalwood.',
            'button_label' => 'Shop fragrance', 'link_url' => '/category/fragrance', 'text_color' => '#ffffff', 'text_position' => 'left',
            'bn' => ['kicker' => 'সুগন্ধি', 'title' => 'প্রতিদিনের সুবাস', 'subtitle' => 'গোলাপ, বেলি আর এক ফোঁটা চন্দন।', 'button_label' => 'দেখুন']],
        'banner-ritual' => ['image' => 'handmade-soap', 'placement' => 'home_promo', 'name' => 'Bath ritual', 'kicker' => 'Bath & body',
            'title' => 'A slower bath time', 'button_label' => 'Shop bath & body', 'link_url' => '/category/bath-body', 'text_color' => '#ffffff',
            'bn' => ['kicker' => 'স্নান ও শরীরের যত্ন', 'title' => 'ধীরে, আরামে স্নান', 'button_label' => 'দেখুন']],
        'banner-tools' => ['image' => 'makeup-brushes', 'placement' => 'home_promo', 'name' => 'Brushes', 'kicker' => 'Tools',
            'title' => 'The right brush makes it easy', 'button_label' => 'Shop tools', 'link_url' => '/category/tools', 'text_color' => '#ffffff',
            'bn' => ['kicker' => 'সরঞ্জাম', 'title' => 'সঠিক ব্রাশে সাজ সহজ', 'button_label' => 'দেখুন']],
    ],

    'theme' => [
        'announcement' => ['text' => 'Free delivery over ৳2,000 · 100 % original products · 15% off over ৳2,500 with GLOW15', 'background' => '#8e3b5f', 'foreground' => '#ffffff'],
        'footer' => [
            'about' => 'Blush & Bloom chooses skincare and makeup that work in Bangladeshi weather and suit warm skin tones.',
            'copyright' => '© Blush & Bloom (demo store). All rights reserved.',
            'contact' => ['email' => 'care@blushandbloom.test', 'phone' => '01700-000008', 'address' => 'House 31, Road 27, Dhanmondi, Dhaka 1209'],
            'social' => ['facebook' => 'https://facebook.example/blushandbloom', 'instagram' => 'https://instagram.example/blushandbloom', 'tiktok' => 'https://tiktok.example/blushandbloom'],
        ],
    ],

    'pages' => [
        'about' => ['title' => 'About us', 'bn' => 'আমাদের কথা', 'body' => '<h2>Beauty that suits our weather</h2><p>Blush & Bloom started in 2021 with a simple question: which products actually work in Dhaka humidity? We test everything ourselves before it goes on the shelf.</p><p>Small range, honest advice, original products.</p>'],
        'contact' => ['title' => 'Contact us', 'bn' => 'যোগাযোগ করুন', 'body' => '<p>Need help choosing a shade or a routine? Message us here or call 01700-000008, 11 am to 8 pm.</p>'],
        'faq' => ['title' => 'Frequently asked questions', 'bn' => 'সাধারণ জিজ্ঞাসা', 'body' => '<p>Can not find your answer? Our team is happy to help from the contact page.</p>'],
        'privacy' => ['title' => 'Privacy policy', 'body' => '<h2>What we keep</h2><p>Your name, contact details, address and orders, used to deliver and to answer your questions.</p><h2>Your choices</h2><p>We never sell your details. You can update them in your account at any time.</p>'],
        'terms' => ['title' => 'Terms of service', 'body' => '<h2>Returns</h2><p>For hygiene, opened cosmetics can not be returned. Unopened items can be returned within 7 days of delivery.</p><h2>Prices</h2><p>Sale prices are valid while stock lasts and until the end date shown.</p>'],
    ],
    'faq' => [
        ['Products', 'Are your products original?', '<p>Yes. We buy only from makers and their official distributors.</p>'],
        ['Shades', 'How do I choose my shade?', '<p>Send us a photo in daylight and we will suggest two shades.</p>'],
        ['Delivery', 'How much is delivery?', '<p>Delivery is free on orders over ৳2,000; otherwise the fee is shown at checkout.</p>'],
        [null, 'Can I return an opened product?', '<p>For hygiene, opened cosmetics can not be returned; unopened items within 7 days.</p>'],
    ],
    'blog' => [
        'category' => ['Beauty notes', 'beauty-notes', 'Routines, shade tips and skincare that works in our weather.'],
        'posts' => [
            ['humid-weather-routine', 'A simple routine for humid days', 'Cleanse, a light serum, gel moisturiser and sunscreen. That is it.', 'gel-moisturiser', 3,
                '<p>In humid weather, heavy creams sit on the skin. Switch to a gel moisturiser and a light serum.</p><p>Never skip sunscreen, even on cloudy days.</p>',
                ['title' => 'আর্দ্র দিনের সহজ রুটিন', 'excerpt' => 'ক্লিনজার, হালকা সিরাম, জেল ময়েশ্চারাইজার আর সানস্ক্রিন। ব্যস।']],
            ['finding-your-lip-shade', 'Finding your lip shade', 'Warm, cool or neutral: three quick checks.', 'matte-lipstick', 10,
                '<p>Look at the veins on your wrist: greenish means warm, bluish means cool.</p><p>Warm skin glows in brick and rosewood shades.</p>',
                ['title' => 'আপনার ঠোঁটের রং খুঁজে নিন', 'excerpt' => 'উষ্ণ, শীতল নাকি নিরপেক্ষ: তিনটি সহজ পরীক্ষা।']],
            ['clean-your-brushes', 'Clean your brushes in five minutes', 'Clean brushes mean smoother makeup and happier skin.', 'makeup-brushes', 17,
                '<p>Swirl brushes in warm water with a little gentle soap, rinse until clear and dry them flat.</p><p>Do it once a week.</p>',
                ['title' => 'পাঁচ মিনিটে ব্রাশ পরিষ্কার', 'excerpt' => 'পরিষ্কার ব্রাশে মেকআপ মসৃণ হয়, ত্বকও ভালো থাকে।']],
        ],
    ],
    'testimonials' => [
        ['quote' => 'The vitamin C serum really brightened my skin in a month. Packed beautifully too.', 'name' => 'Raisa M.', 'role' => 'Dhanmondi', 'rating' => 5],
        ['quote' => 'They helped me choose a lipstick shade over chat and it was perfect.', 'name' => 'Anika T.', 'role' => 'Uttara', 'rating' => 5],
        ['quote' => 'Original products and quick delivery to Khulna. The brush set is soft and good value.', 'name' => 'Mehjabin S.', 'role' => 'Khulna', 'rating' => 4],
    ],
    'reviewers' => [
        ['name' => 'Raisa Mahmud', 'email' => 'raisa@blushandbloom.test', 'phone' => '01700000081', 'area' => 'Dhanmondi', 'reviews' => [
            ['vitamin-c-serum', 5, 'Visible glow', 'Light texture and my dark spots are fading. No irritation.'],
            ['gel-moisturiser', 5, 'Perfect for summer', 'Feels cool, sinks in quickly and is not sticky at all.'],
            ['clay-mask', 4, 'Gentle mask', 'Skin feels clean and soft. The jar could be bigger.'],
        ]],
        ['name' => 'Anika Tabassum', 'email' => 'anika@blushandbloom.test', 'phone' => '01700000082', 'area' => 'Uttara', 'reviews' => [
            ['matte-lipstick', 5, 'Beautiful shade', 'Rosewood is perfect on me and it lasts through lunch.'],
            ['eyeshadow-palette', 4, 'Pretty colours', 'Blends easily. The shimmers are lovely; the darkest matte is a little dry.'],
        ]],
        ['name' => 'Mehjabin Sultana', 'email' => 'mehjabin@blushandbloom.test', 'phone' => '01700000083', 'area' => 'Mohammadpur', 'reviews' => [
            ['makeup-brushes', 4, 'Soft brushes', 'Good for the price and no shedding after washing.'],
            ['argan-hair-oil', 5, 'Soft hair', 'A few drops and my ends are smooth. Not greasy.'],
        ]],
    ],

    // P1b: answered shopper questions (DemoProductPageSeeder): [product, name, e-mail, language, question, answer].
    'questions' => [
        ['vitamin-c-serum', 'Sumaiya Akter', 'sumaiya@blushandbloom.test', 'en', 'Can I use it with sensitive skin?', 'Yes. Start every other morning and patch-test on your jaw first.'],
        ['matte-lipstick', 'ফারহানা ইসলাম', 'farhana@blushandbloom.test', 'bn', 'শ্যামলা ত্বকে কোন শেড মানাবে?', 'রোজউড আর ব্রিক রেড শ্যামলা ত্বকে সবচেয়ে সুন্দর লাগে।'],
    ],

    'features' => [
        ['icon' => 'shield-check', 'title' => '100 % original', 'text' => 'From makers and official distributors'],
        ['icon' => 'truck', 'title' => 'Free delivery', 'text' => 'On orders over ৳2,000'],
        ['icon' => 'credit-card', 'title' => 'Cash on delivery', 'text' => 'Or bank transfer'],
        ['icon' => 'headset', 'title' => 'Shade help', 'text' => 'Chat with us, 11 am to 8 pm'],
    ],
    'rich_text' => [
        'title' => 'Chosen for our weather',
        'body' => '<p>Every product is tested in Dhaka humidity before it reaches our shelf. Read <a href="/pages/about-us">our story</a> or see the <a href="/pages/faq">FAQ</a>.</p>',
        'bn' => ['title' => 'আমাদের আবহাওয়ার জন্য বাছাই', 'body_html' => '<p>প্রতিটি পণ্য তাকে ওঠার আগে ঢাকার আর্দ্রতায় পরীক্ষা করা হয়। পড়ুন <a href="/pages/about-us">আমাদের গল্প</a> অথবা দেখুন <a href="/pages/faq">প্রশ্নোত্তর</a>।</p>'],
    ],
    'newsletter' => ['background' => '#8e3b5f', 'foreground' => '#ffffff', 'image' => 'clay-mask'],
    'sections' => [
        ['type' => 'hero_slider', 'banners' => ['banner-hero-1', 'banner-hero-2', 'banner-hero-3']],
        ['type' => 'features_strip', 'features' => true],
        ['type' => 'category_strip', 'title' => 'Shop by category', 'categories' => ['skincare', 'makeup', 'haircare', 'fragrance', 'bath-body', 'tools'],
            'bn' => ['title' => 'ক্যাটাগরি অনুযায়ী কিনুন']],
        ['type' => 'product_carousel', 'title' => 'Bestsellers', 'subtitle' => 'Loved by our customers', 'config' => ['source' => 'best_sellers', 'limit' => 8, 'view_all_url' => '/shop'],
            'bn' => ['title' => 'সবচেয়ে জনপ্রিয়', 'subtitle' => 'ক্রেতাদের প্রিয়']],
        ['type' => 'rich_text'],
        ['type' => 'product_grid', 'title' => 'New launches', 'subtitle' => 'Just on the shelf', 'config' => ['source' => 'new_arrivals', 'limit' => 8, 'columns' => 4, 'view_all_url' => '/shop'],
            'bn' => ['title' => 'নতুন এসেছে', 'subtitle' => 'সদ্য তাকে উঠেছে']],
        ['type' => 'banner_grid', 'banners' => ['banner-ritual', 'banner-tools'], 'config' => ['layout' => '2-col']],
        ['type' => 'hot_deals', 'title' => 'Glow week', 'subtitle' => '15 % off four favourites', 'config' => ['limit' => 4, 'view_all_url' => '/shop'],
            'bn' => ['title' => 'গ্লো সপ্তাহ', 'subtitle' => 'চারটি প্রিয় পণ্যে ১৫ % ছাড়']],
        ['type' => 'testimonials', 'title' => 'Real reviews', 'bn' => ['title' => 'সত্যিকারের মতামত']],
        ['type' => 'blog_posts', 'title' => 'Beauty notes', 'config' => ['limit' => 3, 'view_all_url' => '/blog'], 'bn' => ['title' => 'বিউটি নোট']],
        ['type' => 'newsletter', 'title' => 'Join the glow club', 'config' => ['text' => 'Routines, new shades and members-only offers, twice a month. Unsubscribe any time.', 'button_label' => 'Join'],
            'bn' => ['title' => 'গ্লো ক্লাবে যোগ দিন', 'text' => 'রুটিন, নতুন শেড আর সদস্যদের অফার, মাসে দুবার। যেকোনো সময় বন্ধ করা যায়।', 'button_label' => 'যোগ দিন']],
    ],
];
