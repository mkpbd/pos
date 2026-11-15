<?php

/**
 * Bazar Fresh — the grocery preset demo store (DemoThemesSeeder, B11). Same shape as fashion.php:
 * Bangla on, banners reuse the product photos, ten photos (the turmeric and the milk have none).
 * Weights as variants; no brands. Photo credits in images/manifest.json.
 */
return [
    'name' => 'Bazar Fresh',
    'host' => 'grocery.shop.localhost',
    'preset' => 'grocery',
    'bangla' => true,
    'owner' => ['name' => 'Mizanur Rahman', 'email' => 'owner@grocery.test'],
    'branch' => 'Bazar Fresh Mohammadpur',
    'sku' => 'BF',
    'meta_description' => 'Fresh vegetables, fruit, fish, eggs, rice, dal, oil and spices delivered the same day in Dhaka by Bazar Fresh.',
    'free_delivery_over' => '1000.00',
    'coupon' => ['code' => 'FRESH10', 'name' => 'Fresh 10', 'description' => '10% off orders over ৳1,500 with code FRESH10', 'percent' => '10', 'min' => '1500'],
    'flash_sale' => [
        'name' => "Today's deals", 'description' => '10% off four kitchen basics until tomorrow night',
        'percent' => '10', 'days' => 1, 'products' => ['mustard-oil', 'farm-eggs', 'potatoes', 'mangoes'],
    ],
    'out_of_stock' => 'fresh-milk',
    // Sold at the shop counter (POS): the best sellers.
    'best_sellers' => ['potatoes' => 9, 'red-onions' => 8, 'farm-eggs' => 6, 'basmati-rice' => 5, 'mustard-oil' => 4, 'red-lentils' => 3],

    // slug => [name, photo, description, Bangla name]
    'categories' => [
        'fruits-vegetables' => ['Fruits & vegetables', 'mangoes', 'Seasonal fruit and vegetables, bought fresh every morning.', 'ফল ও সবজি'],
        'fish-meat' => ['Fish & meat', 'river-fish', 'River fish cleaned and cut the way you like it.', 'মাছ ও মাংস'],
        'dairy-eggs' => ['Dairy & eggs', 'farm-eggs', 'Farm eggs, milk and dairy for breakfast and baking.', 'দুধ ও ডিম'],
        'rice-dal-oil' => ['Rice, dal & oil', 'basmati-rice', 'Rice, lentils and cooking oil for every day.', 'চাল, ডাল ও তেল'],
        'spices' => ['Spices', 'whole-spices', 'Whole and ground spices, packed fresh in small batches.', 'মসলা'],
        'tea-drinks' => ['Tea & drinks', 'black-tea', 'Strong black tea and drinks for the whole family.', 'চা ও পানীয়'],
    ],

    // The two products without a photo come first (the oldest), so the newest arrivals all have one.
    'products' => [
        'turmeric-powder' => ['name' => 'Turmeric Powder', 'category' => 'spices', 'price' => '90',
            'variants' => ['Weight' => ['200 g' => ['90', null], '500 g' => ['210', null]]],
            'bn' => ['হলুদের গুঁড়া', 'রোদে শুকানো হলুদ, ঘন রং আর সুগন্ধ।'],
            'text' => 'Sun-dried turmeric ground in small batches for a deep colour and a warm smell. No added colour.'],
        'fresh-milk' => ['name' => 'Pasteurised Milk 1 L', 'category' => 'dairy-eggs', 'price' => '95',
            'bn' => ['পাস্তুরিত দুধ ১ লিটার', 'খামারের তাজা দুধ, প্রতিদিন সকালে।'],
            'text' => 'Fresh pasteurised cow milk from dairy farms near Dhaka, delivered chilled every morning.'],
        'black-tea' => ['name' => 'Strong Black Tea', 'category' => 'tea-drinks', 'price' => '140', 'featured' => true,
            'variants' => ['Weight' => ['200 g' => ['140', null], '400 g' => ['260', null]]],
            'bn' => ['কড়া লিকারের চা', 'সিলেটের বাগানের কড়া লিকারের চা পাতা।'],
            'text' => 'Strong black tea from Sylhet gardens that brews a deep, malty cup. Perfect with milk and sugar.'],
        'whole-spices' => ['name' => 'Whole Garam Masala Mix', 'category' => 'spices', 'price' => '180', 'sale' => '150',
            'bn' => ['আস্ত গরম মসলা', 'এলাচ, দারচিনি, লবঙ্গ আর তেজপাতার মিশ্রণ।'],
            'text' => 'Cardamom, cinnamon, cloves, star anise and bay leaves in one 100 g pack. For biryani, korma and pulao.'],
        'mustard-oil' => ['name' => 'Cold-pressed Mustard Oil', 'category' => 'rice-dal-oil', 'price' => '340',
            'variants' => ['Size' => ['1 L' => ['340', null], '2 L' => ['660', null]]],
            'bn' => ['ঘানি ভাঙা সরিষার তেল', 'ঝাঁঝালো স্বাদের খাঁটি সরিষার তেল।'],
            'text' => 'Pure mustard oil pressed in a traditional ghani for its sharp taste. For bhorta, fish curry and pickles.'],
        'red-lentils' => ['name' => 'Red Lentils (Masoor Dal)', 'category' => 'rice-dal-oil', 'price' => '140', 'featured' => true,
            'variants' => ['Weight' => ['1 kg' => ['140', null], '2 kg' => ['270', null]]],
            'bn' => ['মসুর ডাল', 'দ্রুত সেদ্ধ হয় এমন পরিষ্কার মসুর ডাল।'],
            'text' => 'Cleaned and sorted red lentils that cook soft in twenty minutes. The everyday dal.'],
        'basmati-rice' => ['name' => 'Aromatic Basmati Rice', 'category' => 'rice-dal-oil', 'price' => '220', 'featured' => true,
            'variants' => ['Weight' => ['1 kg' => ['220', '195'], '5 kg' => ['1050', null]]],
            'bn' => ['সুগন্ধি বাসমতি চাল', 'লম্বা দানার সুগন্ধি চাল, পোলাও আর বিরিয়ানির জন্য।'],
            'text' => 'Long-grain aged basmati rice that cooks fluffy and fragrant. Ideal for biryani and pulao.'],
        'farm-eggs' => ['name' => 'Farm Eggs', 'category' => 'dairy-eggs', 'price' => '165', 'featured' => true,
            'variants' => ['Pack' => ['12 eggs' => ['165', null], '30 eggs' => ['390', null]]],
            'bn' => ['খামারের ডিম', 'খামার থেকে প্রতিদিন আসা বাদামি ডিম।'],
            'text' => 'Brown eggs from free-range farms, collected daily and packed in a sturdy tray.'],
        'river-fish' => ['name' => 'Fresh Rui Fish', 'category' => 'fish-meat', 'price' => '380', 'featured' => true,
            'variants' => ['Weight' => ['1 kg' => ['380', null], '2 kg' => ['740', null]]],
            'bn' => ['তাজা রুই মাছ', 'আজ সকালের রুই মাছ, পরিষ্কার করে কেটে দেওয়া হয়।'],
            'text' => 'Fresh rui from the morning catch, scaled, cleaned and cut into curry pieces on request.'],
        'red-onions' => ['name' => 'Red Onions', 'category' => 'fruits-vegetables', 'price' => '90',
            'variants' => ['Weight' => ['1 kg' => ['90', '75'], '3 kg' => ['260', null]]],
            'bn' => ['দেশি পেঁয়াজ', 'ঝাঁঝালো লাল দেশি পেঁয়াজ।'],
            'text' => 'Small red local onions with a strong flavour, picked for every curry and bhorta.'],
        'potatoes' => ['name' => 'Potatoes', 'category' => 'fruits-vegetables', 'price' => '55',
            'variants' => ['Weight' => ['1 kg' => ['55', null], '5 kg' => ['260', null]]],
            'bn' => ['আলু', 'ভাজি, ভর্তা আর তরকারির জন্য তাজা আলু।'],
            'text' => 'Firm, clean potatoes for bhaji, bhorta and curries. Stored cool and sorted by hand.'],
        'mangoes' => ['name' => 'Himsagar Mangoes', 'category' => 'fruits-vegetables', 'price' => '180', 'featured' => true,
            'variants' => ['Weight' => ['1 kg' => ['180', null], '3 kg' => ['520', null]]],
            'bn' => ['হিমসাগর আম', 'রাজশাহীর মিষ্টি, আঁশহীন হিমসাগর আম।'],
            'text' => 'Sweet, fibre-free Himsagar mangoes from Rajshahi orchards, ripened naturally without chemicals.'],
    ],

    // Banners reuse the product photos (`image`).
    'banners' => [
        'banner-hero-1' => ['image' => 'mangoes', 'placement' => 'hero_slider', 'name' => 'Mango season', 'kicker' => 'In season',
            'title' => 'Mango season is here', 'subtitle' => 'Himsagar from Rajshahi orchards, at your door the same day.',
            'button_label' => 'Shop fruit', 'link_url' => '/category/fruits-vegetables', 'secondary_button_label' => 'All deals', 'secondary_link_url' => '/shop',
            'text_color' => '#ffffff', 'text_position' => 'left',
            'bn' => ['kicker' => 'মৌসুমি', 'title' => 'আমের মৌসুম চলে এসেছে', 'subtitle' => 'রাজশাহীর বাগানের হিমসাগর, একই দিনে আপনার দরজায়।', 'button_label' => 'ফল কিনুন', 'secondary_button_label' => 'সব অফার']],
        'banner-hero-2' => ['image' => 'whole-spices', 'placement' => 'hero_slider', 'name' => 'Pantry', 'kicker' => 'Kitchen basics',
            'title' => 'Fill the pantry for less', 'subtitle' => 'Rice, dal, oil and spices at fair prices, delivered in two hours.',
            'button_label' => 'Shop pantry', 'link_url' => '/category/rice-dal-oil', 'text_color' => '#ffffff', 'text_position' => 'left',
            'bn' => ['kicker' => 'রান্নাঘরের দরকারি', 'title' => 'কম খরচে ভাঁড়ার ভরুন', 'subtitle' => 'চাল, ডাল, তেল আর মসলা ন্যায্য দামে, দুই ঘণ্টায় ডেলিভারি।', 'button_label' => 'কিনুন']],
        'banner-vegetables' => ['image' => 'red-onions', 'placement' => 'home_promo', 'name' => 'Vegetables', 'kicker' => 'Every morning',
            'title' => 'Fresh vegetables daily', 'button_label' => 'Shop now', 'link_url' => '/category/fruits-vegetables', 'text_color' => '#ffffff',
            'bn' => ['kicker' => 'প্রতিদিন সকালে', 'title' => 'প্রতিদিন তাজা সবজি', 'button_label' => 'কিনুন']],
        'banner-fish' => ['image' => 'river-fish', 'placement' => 'home_promo', 'name' => 'Fish', 'kicker' => 'Cleaned and cut',
            'title' => 'River fish, ready to cook', 'button_label' => 'Shop fish', 'link_url' => '/category/fish-meat', 'text_color' => '#ffffff',
            'bn' => ['kicker' => 'কেটে পরিষ্কার', 'title' => 'নদীর মাছ, রান্নার জন্য তৈরি', 'button_label' => 'কিনুন']],
        'banner-rice' => ['image' => 'basmati-rice', 'placement' => 'home_promo', 'name' => 'Rice', 'kicker' => 'Save on 5 kg',
            'title' => 'Rice for the whole month', 'button_label' => 'Shop rice', 'link_url' => '/category/rice-dal-oil', 'text_color' => '#ffffff',
            'bn' => ['kicker' => '৫ কেজিতে সাশ্রয়', 'title' => 'পুরো মাসের চাল', 'button_label' => 'কিনুন']],
    ],

    'theme' => [
        'announcement' => ['text' => 'Same-day delivery in Dhaka · free over ৳1,000 · 10% off over ৳1,500 with FRESH10', 'background' => '#15803d', 'foreground' => '#ffffff'],
        'footer' => [
            'about' => 'Bazar Fresh brings the morning bazar to your door: fresh produce, fish and kitchen basics at fair prices.',
            'copyright' => '© Bazar Fresh (demo store). All rights reserved.',
            'contact' => ['email' => 'order@bazarfresh.test', 'phone' => '01700-000007', 'address' => 'Plot 21, Block C, Tajmahal Road, Mohammadpur, Dhaka 1207'],
            'social' => ['facebook' => 'https://facebook.example/bazarfresh', 'youtube' => 'https://youtube.example/bazarfresh'],
        ],
    ],

    'pages' => [
        'about' => ['title' => 'About us', 'bn' => 'আমাদের কথা', 'body' => '<h2>The morning bazar, delivered</h2><p>Bazar Fresh started in 2020 when our neighbours in Mohammadpur asked us to bring their bazar home. We still buy produce at dawn and pack every order by hand.</p><p>Fair prices, honest weights and fresh food: that is the whole idea.</p>'],
        'contact' => ['title' => 'Contact us', 'bn' => 'যোগাযোগ করুন', 'body' => '<p>Something missing from your order, or need to change it? Call 01700-000007 from 7 am to 10 pm, or send us a message here.</p>'],
        'faq' => ['title' => 'Frequently asked questions', 'bn' => 'সাধারণ জিজ্ঞাসা', 'body' => '<p>Can not find your answer? Our team is happy to help from the contact page.</p>'],
        'privacy' => ['title' => 'Privacy policy', 'body' => '<h2>What we keep</h2><p>Your name, phone, address and orders, used only to deliver your groceries.</p><h2>Your choices</h2><p>We never sell your details. You can update them in your account at any time.</p>'],
        'terms' => ['title' => 'Terms of service', 'body' => '<h2>Weights and prices</h2><p>Fresh produce is weighed at packing; small differences are adjusted at delivery.</p><h2>Returns</h2><p>Not happy with an item? Tell the rider or call us within 24 hours and we will replace or refund it.</p>'],
    ],
    'faq' => [
        ['Delivery', 'How fast is delivery?', '<p>Orders placed before 6 pm arrive the same day inside Dhaka, usually within two hours.</p>'],
        ['Delivery', 'Is delivery free?', '<p>Inside Dhaka, delivery is free on orders over ৳1,000.</p>'],
        ['Freshness', 'What if something is not fresh?', '<p>Tell the rider or call us within 24 hours and we will replace it or refund you.</p>'],
        [null, 'Can I pay cash on delivery?', '<p>Yes. You can also pay by bank transfer.</p>'],
    ],
    'blog' => [
        'category' => ['Kitchen notes', 'kitchen-notes', 'Simple recipes and storage tips from the Bazar Fresh kitchen.'],
        'posts' => [
            ['mango-lassi-at-home', 'Mango lassi at home', 'Ripe mango, yogurt and a pinch of cardamom: summer in a glass.', 'mangoes', 2,
                '<p>Blend one ripe mango with a cup of yogurt, half a cup of cold milk and a pinch of cardamom.</p><p>Serve straight away over ice.</p>',
                ['title' => 'ঘরেই ম্যাঙ্গো লাচ্ছি', 'excerpt' => 'পাকা আম, দই আর এক চিমটি এলাচ: গ্লাসে গ্রীষ্ম।']],
            ['perfect-masoor-dal', 'Perfect masoor dal in 20 minutes', 'The everyday dal, with a garlic and cumin tempering.', 'red-lentils', 8,
                '<p>Boil the lentils with turmeric and salt until soft, then whisk.</p><p>Fry garlic, cumin and dried chilli in mustard oil and pour it over.</p>',
                ['title' => '২০ মিনিটে মসুর ডাল', 'excerpt' => 'রসুন আর জিরার ফোড়নে প্রতিদিনের ডাল।']],
            ['keeping-spices-fresh', 'How to keep spices fresh', 'Small jars, a dark shelf and whole spices where you can.', 'whole-spices', 15,
                '<p>Keep spices in small airtight jars away from the stove.</p><p>Whole spices keep their smell for a year; ground ones for a few months.</p>',
                ['title' => 'মসলা তাজা রাখার উপায়', 'excerpt' => 'ছোট বয়াম, অন্ধকার তাক আর যতটা সম্ভব আস্ত মসলা।']],
        ],
    ],
    'testimonials' => [
        ['quote' => 'The fish was cleaned exactly as I asked and arrived within two hours. Like having a bazar next door.', 'name' => 'Shirin A.', 'role' => 'Mohammadpur', 'rating' => 5],
        ['quote' => 'Honest weights and fair prices. The Himsagar mangoes were the sweetest this year.', 'name' => 'Habib R.', 'role' => 'Dhanmondi', 'rating' => 5],
        ['quote' => 'Good service. Once an egg was cracked and they replaced the tray the next day.', 'name' => 'Lima K.', 'role' => 'Shyamoli', 'rating' => 4],
    ],
    'reviewers' => [
        ['name' => 'Shirin Akter', 'email' => 'shirin@bazarfresh.test', 'phone' => '01700000071', 'area' => 'Mohammadpur', 'reviews' => [
            ['river-fish', 5, 'Very fresh', 'Firm flesh and cut neatly into curry pieces. No smell at all.'],
            ['potatoes', 4, 'Good potatoes', 'Clean and firm. A couple were small, but fine for bhaji.'],
            ['mustard-oil', 5, 'Real mustard oil', 'Strong and sharp, just like the oil from the village.'],
        ]],
        ['name' => 'Habibur Rahman', 'email' => 'habib@bazarfresh.test', 'phone' => '01700000072', 'area' => 'Dhanmondi', 'reviews' => [
            ['mangoes', 5, 'So sweet', 'Perfectly ripe and no fibre. The whole family loved them.'],
            ['basmati-rice', 4, 'Fragrant rice', 'Long grains that stay separate. Lovely for pulao.'],
        ]],
        ['name' => 'Lima Khatun', 'email' => 'lima@bazarfresh.test', 'phone' => '01700000073', 'area' => 'Shyamoli', 'reviews' => [
            ['farm-eggs', 4, 'Good eggs', 'Fresh with bright yolks. One cracked egg was replaced quickly.'],
            ['red-lentils', 5, 'Clean dal', 'No stones and it cooks fast. Will buy the 2 kg next time.'],
        ]],
    ],

    // P1b: answered shopper questions (DemoProductPageSeeder): [product, name, e-mail, language, question, answer].
    'questions' => [
        ['river-fish', 'Kamrul Hasan', 'kamrul@bazarfresh.test', 'en', 'Can you cut the fish into curry pieces?', 'Yes. Add a note at checkout and we clean and cut it into curry pieces at no extra cost.'],
        ['mangoes', 'রেহানা পারভীন', 'rehana@bazarfresh.test', 'bn', 'আমে কি কোনো রাসায়নিক দেওয়া হয়?', 'না, আমগুলো প্রাকৃতিকভাবে পাকানো। কোনো রাসায়নিক ব্যবহার করা হয় না।'],
    ],

    'features' => [
        ['icon' => 'truck', 'title' => 'Same-day delivery', 'text' => 'Order before 6 pm in Dhaka'],
        ['icon' => 'shield-check', 'title' => 'Freshness promise', 'text' => 'Not happy? We replace it'],
        ['icon' => 'credit-card', 'title' => 'Cash on delivery', 'text' => 'Or bank transfer'],
        ['icon' => 'headset', 'title' => 'Order by phone', 'text' => '01700-000007, 7 am to 10 pm'],
    ],
    'rich_text' => [
        'title' => 'Fresh from the bazar, at your door',
        'body' => '<p>We buy produce at dawn, pack your order by hand and deliver it the same day. Read <a href="/pages/about-us">our story</a> or see the <a href="/pages/faq">FAQ</a>.</p>',
        'bn' => ['title' => 'বাজার থেকে তাজা, আপনার দরজায়', 'body_html' => '<p>আমরা ভোরে বাজার করি, হাতে আপনার অর্ডার প্যাক করি আর একই দিনে পৌঁছে দিই। পড়ুন <a href="/pages/about-us">আমাদের গল্প</a> অথবা দেখুন <a href="/pages/faq">প্রশ্নোত্তর</a>।</p>'],
    ],
    'newsletter' => ['background' => '#14532d', 'foreground' => '#ffffff'],
    'sections' => [
        ['type' => 'hero_slider', 'banners' => ['banner-hero-1', 'banner-hero-2']],
        ['type' => 'features_strip', 'features' => true],
        ['type' => 'category_strip', 'title' => 'Shop by aisle', 'categories' => ['fruits-vegetables', 'fish-meat', 'dairy-eggs', 'rice-dal-oil', 'spices', 'tea-drinks'],
            'bn' => ['title' => 'তাক অনুযায়ী কিনুন']],
        ['type' => 'hot_deals', 'title' => "Today's deals", 'subtitle' => 'Ends tomorrow night', 'config' => ['limit' => 4, 'view_all_url' => '/shop'],
            'bn' => ['title' => 'আজকের অফার', 'subtitle' => 'কাল রাতে শেষ']],
        ['type' => 'product_grid', 'title' => 'Fresh picks', 'subtitle' => 'Just arrived at the shop', 'config' => ['source' => 'new_arrivals', 'limit' => 8, 'columns' => 4, 'view_all_url' => '/shop'],
            'bn' => ['title' => 'তাজা বাছাই', 'subtitle' => 'সদ্য দোকানে এসেছে']],
        ['type' => 'banner_grid', 'banners' => ['banner-vegetables', 'banner-fish', 'banner-rice'], 'config' => ['layout' => '3-col']],
        ['type' => 'product_carousel', 'title' => 'Everyday essentials', 'subtitle' => 'What the neighbourhood buys most', 'config' => ['source' => 'best_sellers', 'limit' => 8, 'view_all_url' => '/shop'],
            'bn' => ['title' => 'প্রতিদিনের দরকারি', 'subtitle' => 'পাড়ার সবাই যা বেশি কেনেন']],
        ['type' => 'rich_text'],
        ['type' => 'testimonials', 'title' => 'What neighbours say', 'bn' => ['title' => 'প্রতিবেশীরা যা বলেন']],
        ['type' => 'blog_posts', 'title' => 'Kitchen notes', 'config' => ['limit' => 3, 'view_all_url' => '/blog'], 'bn' => ['title' => 'রান্নাঘরের কথা']],
        ['type' => 'newsletter', 'title' => 'Weekly offers in your inbox', 'config' => ['text' => 'One e-mail a week with the best prices. Unsubscribe any time.', 'button_label' => 'Subscribe'],
            'bn' => ['title' => 'সাপ্তাহিক অফার আপনার ইনবক্সে', 'text' => 'সপ্তাহে একটি ই-মেইল, সেরা দামের খবর। যেকোনো সময় বন্ধ করা যায়।', 'button_label' => 'সাবস্ক্রাইব']],
    ],
];
