<?php

/**
 * Circuit Bazar — the electronics preset demo store (DemoThemesSeeder, B11). Same shape as
 * fashion.php: Bangla on, banners reuse the product photos, ten photos (the charger and the power
 * bank have none). Generic product names, no brands; photo credits in images/manifest.json.
 */
return [
    'name' => 'Circuit Bazar',
    'host' => 'electronics.shop.localhost',
    'preset' => 'electronics',
    'bangla' => true,
    'owner' => ['name' => 'Tanvir Ahmed', 'email' => 'owner@electronics.test'],
    'branch' => 'Circuit Bazar Elephant Road',
    'sku' => 'CZ',
    'meta_description' => 'Phones, laptops, headphones, smart watches and smart home gadgets with warranty, delivered across Bangladesh by Circuit Bazar.',
    'free_delivery_over' => '5000.00',
    'coupon' => ['code' => 'TECH10', 'name' => 'Tech 10', 'description' => '10% off orders over ৳10,000 with code TECH10', 'percent' => '10', 'min' => '10000'],
    'flash_sale' => [
        'name' => 'Flash deals', 'description' => '12% off four gadgets for 48 hours',
        'percent' => '12', 'days' => 2, 'products' => ['bluetooth-speaker', 'over-ear-headphones', 'mechanical-keyboard', 'security-camera'],
    ],
    'out_of_stock' => 'usb-c-charger',
    // Sold at the shop counter (POS): the best sellers.
    'best_sellers' => ['wireless-earbuds' => 6, 'smartphone-pro' => 3, 'smart-watch' => 3, 'bluetooth-speaker' => 2, 'mechanical-keyboard' => 2, 'tablet-11' => 1],
    'swatches' => ['Colour' => ['White' => '#f5f5f5', 'Black' => '#111111', 'Midnight' => '#1f2937', 'Silver' => '#c0c4cc']],

    // slug => [name, photo, description, Bangla name]
    'categories' => [
        'phones' => ['Phones & tablets', 'smartphone-pro', 'Smartphones and tablets with official warranty and fast delivery.', 'ফোন ও ট্যাবলেট'],
        'laptops' => ['Laptops', 'ultrabook-14', 'Thin laptops for work and study, and gaming laptops for play.', 'ল্যাপটপ'],
        'audio' => ['Audio', 'over-ear-headphones', 'Earbuds, headphones and speakers for music, calls and films.', 'অডিও'],
        'wearables' => ['Smart watches', 'smart-watch', 'Smart watches that count steps, track sleep and show your messages.', 'স্মার্ট ঘড়ি'],
        'accessories' => ['Accessories', 'mechanical-keyboard', 'Keyboards, chargers and power banks for every device.', 'অ্যাকসেসরিজ'],
        'smart-home' => ['Smart home', 'security-camera', 'Cameras and gadgets that keep an eye on home while you are out.', 'স্মার্ট হোম'],
    ],

    // The two products without a photo come first (the oldest), so the newest arrivals all have one.
    'products' => [
        'usb-c-charger' => ['name' => '65 W USB-C Fast Charger', 'category' => 'accessories', 'price' => '2290',
            'bn' => ['৬৫ ওয়াট ইউএসবি-সি ফাস্ট চার্জার', 'ল্যাপটপ, ফোন আর ট্যাবলেট এক চার্জারেই।'],
            'text' => 'A compact 65 W USB-C charger that powers a laptop, a phone or a tablet. Foldable pins for travel.'],
        'power-bank' => ['name' => 'Slim Power Bank', 'category' => 'accessories', 'price' => '1690',
            'variants' => ['Capacity' => ['10,000 mAh' => ['1690', null], '20,000 mAh' => ['2490', null]]],
            'bn' => ['স্লিম পাওয়ার ব্যাংক', 'ব্যাগে সহজে ঢোকে, দুটি ডিভাইস একসঙ্গে চার্জ হয়।'],
            'text' => 'A slim power bank with USB-C fast charging in and out. Charges two devices at once.'],
        'security-camera' => ['name' => 'Wi-Fi Security Camera', 'category' => 'smart-home', 'price' => '3990',
            'bn' => ['ওয়াই-ফাই সিকিউরিটি ক্যামেরা', 'ফোনে সরাসরি দেখুন, নড়াচড়া হলে সতর্কবার্তা পান।'],
            'text' => 'A full-HD camera with night vision and two-way talk. Watch live on your phone and get an alert when it sees movement.'],
        'mechanical-keyboard' => ['name' => 'Retro Mechanical Keyboard', 'category' => 'accessories', 'price' => '6490',
            'variants' => ['Switches' => ['Linear', 'Tactile']],
            'bn' => ['রেট্রো মেকানিক্যাল কিবোর্ড', 'আরামদায়ক টাইপিংয়ের জন্য হট-সোয়াপ সুইচের কিবোর্ড।'],
            'text' => 'A compact mechanical keyboard with retro cream and coral keycaps. Hot-swap switches and a USB-C cable.'],
        'smart-watch' => ['name' => 'Fitness Smart Watch', 'category' => 'wearables', 'price' => '8990', 'sale' => '7490', 'featured' => true,
            'variants' => ['Colour' => ['Midnight', 'Silver']],
            'bn' => ['ফিটনেস স্মার্ট ঘড়ি', 'হার্ট রেট, ঘুম আর ধাপ গোনে, সাত দিন চার্জ থাকে।'],
            'text' => 'A smart watch with a bright display, heart rate and sleep tracking and call alerts. Up to seven days per charge.'],
        'bluetooth-speaker' => ['name' => 'Portable Bluetooth Speaker', 'category' => 'audio', 'price' => '5490',
            'bn' => ['পোর্টেবল ব্লুটুথ স্পিকার', 'জোরালো আওয়াজ, পানিরোধী, বারো ঘণ্টা চলে।'],
            'text' => 'A splash-proof speaker with full, clear sound and twelve hours of play. A strap to carry it anywhere.'],
        'over-ear-headphones' => ['name' => 'Noise-cancelling Headphones', 'category' => 'audio', 'price' => '12990', 'featured' => true,
            'bn' => ['নয়েজ-ক্যান্সেলিং হেডফোন', 'বাইরের শব্দ কমিয়ে দেয়, ত্রিশ ঘণ্টা ব্যাটারি।'],
            'text' => 'Over-ear headphones with active noise cancelling, soft memory-foam cushions and thirty hours of battery.'],
        'wireless-earbuds' => ['name' => 'True Wireless Earbuds', 'category' => 'audio', 'price' => '4990', 'sale' => '3990', 'featured' => true,
            'variants' => ['Colour' => ['White', 'Black']],
            'bn' => ['ট্রু ওয়্যারলেস ইয়ারবাড', 'ছোট কেস, পরিষ্কার কল আর টাচ কন্ট্রোল।'],
            'text' => 'Light earbuds with touch controls, clear calls and a pocket-size charging case. Water resistant for workouts.'],
        'gaming-laptop' => ['name' => '15.6-inch Gaming Laptop', 'category' => 'laptops', 'price' => '139990',
            'variants' => ['Memory' => ['16 GB' => ['139990', '129990'], '32 GB' => ['154990', null]]],
            'bn' => ['১৫.৬ ইঞ্চি গেমিং ল্যাপটপ', '১৪৪ হার্জ স্ক্রিন আর আরজিবি কিবোর্ডের গেমিং ল্যাপটপ।'],
            'text' => 'A gaming laptop with a 144 Hz screen, a dedicated graphics card and an RGB backlit keyboard. 1 TB SSD.'],
        'ultrabook-14' => ['name' => '14-inch Thin Laptop', 'category' => 'laptops', 'price' => '89990', 'featured' => true,
            'variants' => ['Storage' => ['512 GB' => ['89990', null], '1 TB' => ['104990', null]]],
            'bn' => ['১৪ ইঞ্চি পাতলা ল্যাপটপ', 'মাত্র ১.৩ কেজি ওজন, সারা দিনের ব্যাটারি।'],
            'text' => 'A thin aluminium laptop that weighs 1.3 kg, with a sharp 14-inch screen and battery for a full working day.'],
        'tablet-11' => ['name' => '11-inch Tablet', 'category' => 'phones', 'price' => '32990', 'featured' => true,
            'variants' => ['Storage' => ['128 GB' => ['32990', null], '256 GB' => ['39990', null]]],
            'bn' => ['১১ ইঞ্চি ট্যাবলেট', 'পড়া, ক্লাস আর সিনেমার জন্য বড় উজ্জ্বল স্ক্রিন।'],
            'text' => 'An 11-inch tablet with a bright screen and stereo speakers. Great for reading, online classes and films.'],
        'smartphone-pro' => ['name' => '6.7-inch Smartphone', 'category' => 'phones', 'price' => '38990', 'featured' => true,
            'variants' => ['Storage' => ['128 GB' => ['38990', '35990'], '256 GB' => ['44990', null]]],
            'bn' => ['৬.৭ ইঞ্চি স্মার্টফোন', 'বড় স্ক্রিন, তিন ক্যামেরা আর দুই দিনের ব্যাটারি।'],
            'text' => 'A large-screen smartphone with a triple camera, 5G and a battery that lasts two days. Two years of updates.'],
    ],

    // Banners reuse the product photos (`image`).
    'banners' => [
        'banner-hero-1' => ['image' => 'ultrabook-14', 'placement' => 'hero_slider', 'name' => 'Laptop week', 'kicker' => 'LAPTOP WEEK',
            'title' => 'Thin laptops from ৳89,990', 'subtitle' => 'Light enough to carry all day. Official warranty and free delivery.',
            'button_label' => 'Shop laptops', 'link_url' => '/category/laptops', 'secondary_button_label' => 'All deals', 'secondary_link_url' => '/shop',
            'text_color' => '#0f172a', 'text_position' => 'left',
            'bn' => ['kicker' => 'ল্যাপটপ সপ্তাহ', 'title' => '৳৮৯,৯৯০ থেকে পাতলা ল্যাপটপ', 'subtitle' => 'সারা দিন বহন করার মতো হালকা। অফিশিয়াল ওয়ারেন্টি আর ফ্রি ডেলিভারি।', 'button_label' => 'ল্যাপটপ দেখুন', 'secondary_button_label' => 'সব অফার']],
        'banner-hero-2' => ['image' => 'over-ear-headphones', 'placement' => 'hero_slider', 'name' => 'Sound sale', 'kicker' => 'UP TO 20 % OFF',
            'title' => 'Hear more, pay less', 'subtitle' => 'Headphones, earbuds and speakers at flash-deal prices.',
            'button_label' => 'Shop audio', 'link_url' => '/category/audio', 'text_color' => '#0f172a', 'text_position' => 'left',
            'bn' => ['kicker' => '২০ % পর্যন্ত ছাড়', 'title' => 'বেশি শুনুন, কম দিন', 'subtitle' => 'হেডফোন, ইয়ারবাড আর স্পিকার ফ্ল্যাশ ডিলের দামে।', 'button_label' => 'অডিও দেখুন']],
        'banner-phones' => ['image' => 'smartphone-pro', 'placement' => 'home_promo', 'name' => 'Phones', 'kicker' => 'PHONES',
            'title' => 'New phones, two-year warranty', 'button_label' => 'Shop phones', 'link_url' => '/category/phones', 'text_color' => '#0f172a',
            'bn' => ['kicker' => 'ফোন', 'title' => 'নতুন ফোন, দুই বছরের ওয়ারেন্টি', 'button_label' => 'দেখুন']],
        'banner-earbuds' => ['image' => 'wireless-earbuds', 'placement' => 'home_promo', 'name' => 'Earbuds', 'kicker' => 'AUDIO',
            'title' => 'Earbuds from ৳3,990', 'button_label' => 'Shop audio', 'link_url' => '/category/audio', 'text_color' => '#0f172a',
            'bn' => ['kicker' => 'অডিও', 'title' => '৳৩,৯৯০ থেকে ইয়ারবাড', 'button_label' => 'দেখুন']],
        'banner-gaming' => ['image' => 'gaming-laptop', 'placement' => 'home_promo', 'name' => 'Gaming', 'kicker' => 'GAMING',
            'title' => 'Level up your setup', 'button_label' => 'Shop gaming', 'link_url' => '/category/laptops', 'text_color' => '#ffffff',
            'bn' => ['kicker' => 'গেমিং', 'title' => 'আপনার সেটআপ আরও শক্তিশালী করুন', 'button_label' => 'দেখুন']],
    ],

    'theme' => [
        'announcement' => ['text' => 'Official warranty on every gadget · free delivery over ৳5,000 · call 01700-000006', 'background' => '#0f172a', 'foreground' => '#ffffff'],
        'footer' => [
            'about' => 'Circuit Bazar sells phones, laptops, audio and smart home gadgets with official warranty and honest advice.',
            'copyright' => '© Circuit Bazar (demo store). All rights reserved.',
            'contact' => ['email' => 'help@circuitbazar.test', 'phone' => '01700-000006', 'address' => 'Shop 12, Level 3, Elephant Road, Dhaka 1205'],
            'social' => ['facebook' => 'https://facebook.example/circuitbazar', 'youtube' => 'https://youtube.example/circuitbazar'],
        ],
    ],

    'pages' => [
        'about' => ['title' => 'About us', 'bn' => 'আমাদের কথা', 'body' => '<h2>Gadgets with honest advice</h2><p>Circuit Bazar began as a small phone repair counter on Elephant Road in 2014. Today we sell the gadgets we would buy ourselves, each with an official warranty.</p><p>Not sure what to choose? Call us and a real person will help.</p>'],
        'contact' => ['title' => 'Contact us', 'bn' => 'যোগাযোগ করুন', 'body' => '<p>Questions about a product, an order or a warranty claim? Send us a message or call 01700-000006, 10 am to 8 pm, Saturday to Thursday.</p>'],
        'faq' => ['title' => 'Frequently asked questions', 'bn' => 'সাধারণ জিজ্ঞাসা', 'body' => '<p>Can not find your answer? Our team is happy to help from the contact page.</p>'],
        'privacy' => ['title' => 'Privacy policy', 'body' => '<h2>Information we keep</h2><p>Your name, contact details, address, order history and warranty records.</p><h2>Your choices</h2><p>We never sell your details. You can update them in your account at any time.</p>'],
        'terms' => ['title' => 'Terms of service', 'body' => '<h2>Warranty</h2><p>Warranty periods are shown on each product and start on the delivery date.</p><h2>Returns</h2><p>Unopened products can be returned within 7 days of delivery; faulty products are repaired or replaced under warranty.</p>'],
    ],
    'faq' => [
        ['Warranty', 'Do your products have a warranty?', '<p>Yes. Every product has an official warranty; the period is shown on the product page.</p>'],
        ['Delivery', 'How much is delivery?', '<p>Inside Dhaka it is free on orders over ৳5,000; otherwise the fee is shown at checkout.</p>'],
        ['Payment', 'Can I pay cash on delivery?', '<p>Yes, or by bank transfer. Please check the parcel before you pay.</p>'],
        [null, 'Can I return an opened product?', '<p>Opened products are covered by the warranty; unopened ones can be returned within 7 days.</p>'],
    ],
    'blog' => [
        'category' => ['Tech guides', 'tech-guides', 'Buying guides and simple tips from the Circuit Bazar team.'],
        'posts' => [
            ['choosing-a-laptop', 'How to choose a laptop for study', 'Screen, weight and battery matter more than the fastest chip.', 'ultrabook-14', 4,
                '<p>For study and office work, choose 16 GB of memory, an SSD and a screen you like looking at.</p><p>Carry it to class? Keep it under 1.5 kg.</p>',
                ['title' => 'পড়াশোনার জন্য ল্যাপটপ বাছবেন যেভাবে', 'excerpt' => 'সবচেয়ে দ্রুত চিপের চেয়ে স্ক্রিন, ওজন আর ব্যাটারি বেশি জরুরি।']],
            ['earbuds-or-headphones', 'Earbuds or headphones?', 'Which one suits your day: the commute, the office or the gym.', 'wireless-earbuds', 11,
                '<p>Earbuds win for the gym and the pocket. Headphones win for long flights and quiet focus.</p><p>Many people own both.</p>',
                ['title' => 'ইয়ারবাড নাকি হেডফোন?', 'excerpt' => 'যাতায়াত, অফিস নাকি জিম: আপনার দিনের সঙ্গে কোনটি মানায়।']],
            ['battery-care', 'Make your phone battery last longer', 'Small habits that keep a battery healthy for years.', 'smartphone-pro', 18,
                '<p>Avoid leaving the phone at 100 % in the heat and use a good charger.</p><p>Charging between 20 and 80 % is kindest to the battery.</p>',
                ['title' => 'ফোনের ব্যাটারি দীর্ঘদিন ভালো রাখুন', 'excerpt' => 'ছোট কিছু অভ্যাস ব্যাটারিকে বছরের পর বছর ভালো রাখে।']],
        ],
    ],
    'testimonials' => [
        ['quote' => 'Got my laptop the next day with the warranty card and invoice. They even helped me set it up on the phone.', 'name' => 'Rakib H.', 'role' => 'Mirpur', 'rating' => 5],
        ['quote' => 'Honest advice: they told me the cheaper earbuds were enough for me. I will buy here again.', 'name' => 'Mitu S.', 'role' => 'Uttara', 'rating' => 5],
        ['quote' => 'Good prices on flash deals. Delivery to Sylhet took three days.', 'name' => 'Arif K.', 'role' => 'Sylhet', 'rating' => 4],
    ],
    'reviewers' => [
        ['name' => 'Rakib Hasan', 'email' => 'rakib@circuitbazar.test', 'phone' => '01700000061', 'area' => 'Mirpur', 'reviews' => [
            ['wireless-earbuds', 5, 'Great value', 'Clear sound, good bass and the case fits in any pocket.'],
            ['smartphone-pro', 4, 'Big and fast', 'Lovely screen and the battery lasts two days. A little heavy.'],
            ['mechanical-keyboard', 5, 'Fun to type on', 'The tactile switches feel great and the colours look lovely on my desk.'],
        ]],
        ['name' => 'Mitu Sultana', 'email' => 'mitu@circuitbazar.test', 'phone' => '01700000062', 'area' => 'Uttara', 'reviews' => [
            ['smart-watch', 4, 'Good fitness tracker', 'Accurate steps and sleep. The strap could be softer.'],
            ['tablet-11', 5, 'Perfect for classes', 'Bright screen and loud speakers. My daughter uses it every day.'],
        ]],
        ['name' => 'Arif Khan', 'email' => 'arif@circuitbazar.test', 'phone' => '01700000063', 'area' => 'Dhanmondi', 'reviews' => [
            ['bluetooth-speaker', 4, 'Loud and clear', 'Plenty of volume for a small room and the battery lasts.'],
            ['over-ear-headphones', 5, 'Peace and quiet', 'Noise cancelling works well on the bus. Very comfortable.'],
        ]],
    ],

    // P1b: answered shopper questions (DemoProductPageSeeder): [product, name, e-mail, language, question, answer].
    'questions' => [
        ['smartphone-pro', 'Shafiq Islam', 'shafiq@circuitbazar.test', 'en', 'Does it come with a charger?', 'Yes, a USB-C cable and a fast charger are in the box.'],
        ['ultrabook-14', 'নাসরিন আক্তার', 'nasrin@circuitbazar.test', 'bn', 'ওয়ারেন্টি কত দিনের?', 'দুই বছরের অফিশিয়াল ওয়ারেন্টি, ডেলিভারির দিন থেকে শুরু।'],
    ],

    'features' => [
        ['icon' => 'shield-check', 'title' => 'Official warranty', 'text' => 'On every product'],
        ['icon' => 'truck', 'title' => 'Free delivery', 'text' => 'Inside Dhaka over ৳5,000'],
        ['icon' => 'credit-card', 'title' => 'Cash on delivery', 'text' => 'Check before you pay'],
        ['icon' => 'headset', 'title' => 'Expert help', 'text' => '01700-000006, 10 am to 8 pm'],
    ],
    'newsletter' => ['background' => '#0f172a', 'foreground' => '#ffffff', 'image' => 'tablet-11'],
    'sections' => [
        ['type' => 'hero_slider', 'banners' => ['banner-hero-1', 'banner-hero-2']],
        ['type' => 'features_strip', 'features' => true],
        ['type' => 'category_strip', 'title' => 'Shop by category', 'categories' => ['phones', 'laptops', 'audio', 'wearables', 'accessories', 'smart-home'],
            'bn' => ['title' => 'ক্যাটাগরি অনুযায়ী কিনুন']],
        ['type' => 'hot_deals', 'title' => 'Flash deals', 'subtitle' => 'Ends in 48 hours', 'config' => ['limit' => 4, 'view_all_url' => '/shop'],
            'bn' => ['title' => 'ফ্ল্যাশ ডিল', 'subtitle' => '৪৮ ঘণ্টায় শেষ']],
        ['type' => 'banner_grid', 'banners' => ['banner-phones', 'banner-earbuds', 'banner-gaming'], 'config' => ['layout' => '3-col']],
        ['type' => 'product_tabs', 'title' => 'Top picks', 'config' => ['limit' => 8, 'tabs' => [
            ['label' => 'Featured', 'source' => 'featured'],
            ['label' => 'New arrivals', 'source' => 'new_arrivals'],
            ['label' => 'Best sellers', 'source' => 'best_sellers'],
        ]], 'bn' => ['title' => 'সেরা বাছাই']],
        ['type' => 'product_grid', 'title' => 'Price drops', 'subtitle' => 'Lower prices on popular gadgets', 'config' => ['source' => 'on_sale', 'limit' => 8, 'columns' => 4, 'view_all_url' => '/shop'],
            'bn' => ['title' => 'দাম কমেছে', 'subtitle' => 'জনপ্রিয় গ্যাজেটে কম দাম']],
        ['type' => 'testimonials', 'title' => 'Customer reviews', 'bn' => ['title' => 'ক্রেতাদের মতামত']],
        ['type' => 'blog_posts', 'title' => 'Tech guides', 'config' => ['limit' => 3, 'view_all_url' => '/blog'], 'bn' => ['title' => 'টেক গাইড']],
        ['type' => 'newsletter', 'title' => 'Get the deals first', 'config' => ['text' => 'Flash deals and new launches in your inbox, once a week. Unsubscribe any time.', 'button_label' => 'Subscribe'],
            'bn' => ['title' => 'সবার আগে অফার পান', 'text' => 'ফ্ল্যাশ ডিল আর নতুন পণ্যের খবর, সপ্তাহে একবার। যেকোনো সময় বন্ধ করা যায়।', 'button_label' => 'সাবস্ক্রাইব']],
    ],
];
