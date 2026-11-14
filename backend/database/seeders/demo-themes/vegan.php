<?php

/**
 * Green Basket — the vegan preset demo store (DemoThemesSeeder). Prices in BDT as decimal
 * strings. Product `variants`: option name => list of values (all at the product's price and
 * sale price) or value => [price, sale price|null]. `sale` makes the variant's selling price
 * the sale price with the regular price as its compare-at ("was") price.
 */
return [
    'name' => 'Green Basket',
    'host' => 'vegan.shop.localhost',
    'preset' => 'vegan',
    'owner' => ['name' => 'Farhana Kabir', 'email' => 'owner@greenbasket.test'],
    'branch' => 'Green Basket Dhanmondi',
    'sku' => 'GB',
    'meta_description' => 'Plant-based groceries, cold-pressed drinks and natural care delivered across Dhaka by Green Basket.',
    'free_delivery_over' => '1500.00',
    'coupon' => ['code' => 'GREEN10', 'name' => 'Green 10', 'description' => '10% off orders over ৳1,000 with code GREEN10', 'percent' => '10', 'min' => '1000'],
    'flash_sale' => [
        'name' => 'Fresh weekend', 'description' => '15% off picked fresh favourites until Sunday night',
        'percent' => '15', 'days' => 3, 'products' => ['baby-spinach', 'mixed-berries', 'kombucha', 'granola'],
    ],
    'out_of_stock' => 'almond-milk',
    // Sold at the shop counter (POS): the best sellers.
    'best_sellers' => ['organic-tomatoes' => 8, 'avocado' => 6, 'baby-spinach' => 6, 'oat-milk' => 5, 'tofu' => 4, 'granola' => 4, 'green-smoothie' => 3, 'plant-protein' => 2],
    'swatches' => ['Colour' => ['Natural' => '#e8dcc4', 'Green' => '#2e7d32']],

    'categories' => [
        'fresh-produce' => ['Fresh produce', 'cat-produce', 'Vegetables and fruit from partner farms around Dhaka, packed the morning they ship.'],
        'vegan-pantry' => ['Vegan pantry', null, 'Grains, spreads and plant protein for everyday cooking.'],
        'drinks' => ['Drinks', 'cat-drinks', 'Plant milks, cold-pressed juice and gently fermented drinks.'],
        'natural-beauty' => ['Natural beauty', 'cat-beauty', 'Simple skin and hair care made from plants, without the long ingredient lists.'],
        'fitness-nutrition' => ['Fitness & nutrition', 'cat-fitness', 'Protein and snacks for training days, all plant-based.'],
        'eco-accessories' => ['Eco accessories', null, 'Small swaps that leave less plastic behind.'],
    ],

    'products' => [
        'organic-tomatoes' => ['name' => 'Organic Tomatoes', 'category' => 'fresh-produce', 'price' => '120', 'sale' => '99', 'featured' => true,
            'variants' => ['Weight' => ['500 g' => ['65', '55'], '1 kg' => ['120', '99']]],
            'text' => 'Vine-ripened tomatoes grown without synthetic sprays in Savar. They are sweet enough for salads and sturdy enough for a slow curry.'],
        'baby-spinach' => ['name' => 'Baby Spinach', 'category' => 'fresh-produce', 'price' => '60',
            'text' => 'Tender spinach leaves, washed twice and packed in a compostable bag. Toss them into a smoothie or wilt them into dal at the last minute.'],
        'avocado' => ['name' => 'Hass Avocado', 'category' => 'fresh-produce', 'price' => '180', 'sale' => '150', 'featured' => true,
            'variants' => ['Pack' => ['1 pc' => ['180', '150'], '3 pcs' => ['510', '430']]],
            'text' => 'Creamy Hass avocados picked firm so they ripen on your counter in two or three days. Press gently near the stem: a slight give means it is ready.'],
        'mixed-berries' => ['name' => 'Mixed Berries Box', 'category' => 'fresh-produce', 'price' => '450',
            'text' => 'A chilled box of strawberries, blueberries and mulberries in season. Eat them within two days or freeze them for smoothie bowls.'],
        'broccoli' => ['name' => 'Broccoli', 'category' => 'fresh-produce', 'price' => '90',
            'text' => 'Tight green heads cut the day before delivery. Steam the florets and slice the stalk thinly for a stir-fry.'],
        'oat-milk' => ['name' => 'Barista Oat Milk', 'category' => 'drinks', 'price' => '390', 'sale' => '349', 'featured' => true,
            'variants' => ['Pack' => ['1 L' => ['390', '349'], '6 × 1 L' => ['2190', '1990']]],
            'text' => 'A creamy oat drink that foams like dairy for lattes and flat whites. Lightly sweetened with oats only and fortified with calcium.'],
        'almond-milk' => ['name' => 'Unsweetened Almond Milk', 'category' => 'drinks', 'price' => '420',
            'text' => 'Almonds and water with a pinch of sea salt, nothing sweet added. Good with cereal, overnight oats and baking.'],
        'green-smoothie' => ['name' => 'Cold-pressed Green Juice', 'category' => 'drinks', 'price' => '250', 'sale' => '199',
            'variants' => ['Size' => ['250 ml' => ['250', '199'], '500 ml' => ['450', '360']]],
            'text' => 'Cucumber, spinach, green apple and lemon pressed without heat. Keep it cold and drink it within three days of delivery.'],
        'kombucha' => ['name' => 'Ginger Kombucha', 'category' => 'drinks', 'price' => '220',
            'text' => 'Small-batch kombucha brewed with black tea and fresh ginger. Lightly fizzy, tangy and low in sugar.'],
        'tofu' => ['name' => 'Organic Firm Tofu', 'category' => 'vegan-pantry', 'price' => '260',
            'text' => 'Firm tofu pressed from non-GMO soybeans. Cube it for a curry or crumble it for a quick breakfast scramble.'],
        'quinoa' => ['name' => 'White Quinoa', 'category' => 'vegan-pantry', 'price' => '650', 'sale' => '590',
            'variants' => ['Weight' => ['500 g' => ['650', '590'], '1 kg' => ['1250', '1120']]],
            'text' => 'Pre-rinsed white quinoa that cooks fluffy in fifteen minutes. A complete protein for salads, bowls and pulao-style dishes.'],
        'granola' => ['name' => 'Maple Nut Granola', 'category' => 'vegan-pantry', 'price' => '480', 'featured' => true,
            'text' => 'Rolled oats baked slowly with cashews, almonds and a little maple syrup. Crunchy clusters that stay crisp in plant milk.'],
        'peanut-butter' => ['name' => 'Crunchy Peanut Butter', 'category' => 'vegan-pantry', 'price' => '350',
            'text' => 'Roasted peanuts ground with a pinch of salt and nothing else. Stir the natural oil back in before spreading.'],
        'plant-protein' => ['name' => 'Plant Protein Powder', 'category' => 'fitness-nutrition', 'price' => '2400', 'sale' => '2100', 'featured' => true,
            'variants' => ['Flavour' => ['Chocolate', 'Vanilla']],
            'text' => 'A blend of pea and brown rice protein with 24 g of protein per scoop. Mixes smoothly with water or oat milk, without a chalky aftertaste.'],
        'energy-bars' => ['name' => 'Date & Cacao Energy Bars', 'category' => 'fitness-nutrition', 'price' => '600',
            'variants' => ['Pack' => ['6 pack' => ['600', null], '12 pack' => ['1150', null]]],
            'text' => 'Soft bars of dates, cacao and cashews for a pre-workout snack. No added sugar and nothing you cannot pronounce.'],
        'aloe-gel' => ['name' => 'Pure Aloe Vera Gel', 'category' => 'natural-beauty', 'price' => '450',
            'text' => 'Cooling aloe gel for sun-warmed skin and as a light moisturiser. Fragrance-free and suitable for sensitive skin.'],
        'coconut-oil' => ['name' => 'Virgin Coconut Oil', 'category' => 'natural-beauty', 'price' => '550', 'sale' => '495',
            'variants' => ['Size' => ['250 ml' => ['550', '495'], '500 ml' => ['990', '890']]],
            'text' => 'Cold-pressed coconut oil for hair, skin and the kitchen. It turns solid below 24 °C: warm the jar in your hands to soften it.'],
        'bamboo-toothbrush' => ['name' => 'Bamboo Toothbrush Set', 'category' => 'eco-accessories', 'price' => '290',
            'variants' => ['Pack' => ['2 pack' => ['290', null], '4 pack' => ['540', null]]],
            'text' => 'Toothbrushes with compostable bamboo handles and soft bristles. Snap off the head and compost the handle when you are done.'],
        'tote-bag' => ['name' => 'Organic Cotton Tote', 'category' => 'eco-accessories', 'price' => '390', 'featured' => true,
            'variants' => ['Colour' => ['Natural', 'Green']],
            'text' => 'A roomy tote in heavy organic cotton with long handles. It folds flat and carries a full week of groceries.'],
    ],

    'banners' => [
        'banner-hero-1' => ['placement' => 'hero_slider', 'name' => 'Fresh from the farm', 'kicker' => '100 % plant-based',
            'title' => 'fresh from the farm to your door', 'subtitle' => 'Organic vegetables and fruit picked this morning, delivered across Dhaka.',
            'button_label' => 'Shop produce', 'link_url' => '/category/fresh-produce',
            'secondary_button_label' => 'Our story', 'secondary_link_url' => '/pages/about-us', 'text_color' => '#1e3a24'],
        'banner-hero-2' => ['placement' => 'hero_slider', 'name' => 'Smoothie season', 'kicker' => 'New',
            'title' => 'blend something green today', 'subtitle' => 'Plant milks, berries and protein for breakfast bowls.',
            'button_label' => 'Shop drinks', 'link_url' => '/category/drinks',
            'secondary_button_label' => 'Read the recipes', 'secondary_link_url' => '/blog', 'text_color' => '#1e3a24', 'text_position' => 'center'],
        'banner-promo' => ['placement' => 'home_promo', 'name' => 'Pantry staples', 'kicker' => 'Pantry',
            'title' => 'lunch bowls made easy', 'subtitle' => 'Quinoa, tofu and dressings in one basket.',
            'button_label' => 'Shop pantry', 'link_url' => '/category/vegan-pantry', 'text_color' => '#ffffff'],
        'banner-brand' => ['placement' => 'home_promo', 'name' => 'Our farms', 'kicker' => 'Grown nearby',
            'title' => 'meet the farmers we buy from', 'subtitle' => 'Six family farms within 50 km of Dhaka.',
            'button_label' => 'About us', 'link_url' => '/pages/about-us', 'text_color' => '#ffffff'],
    ],

    'theme' => [
        'announcement' => ['text' => 'free delivery over ৳1,500 · 100 % plant-based · order by phone 01700-000000', 'background' => '#2e7d32', 'foreground' => '#ffffff'],
        'footer' => [
            'about' => 'Green Basket brings organic produce and plant-based pantry staples from small farms to homes across Dhaka.',
            'copyright' => '© Green Basket (demo store). All rights reserved.',
            'contact' => ['email' => 'hello@greenbasket.test', 'phone' => '01700-000001', 'address' => 'House 7, Road 9A, Dhanmondi, Dhaka 1209'],
            'social' => ['facebook' => 'https://facebook.example/greenbasket', 'instagram' => 'https://instagram.example/greenbasket'],
        ],
    ],

    'pages' => [
        'about' => ['title' => 'About us', 'body' => '<h2>Plants first, since 2019</h2><p>Green Basket started as a weekend stall of vegetables from two farms in Savar. Today we work with six family farms and a handful of small makers, and we still pack every order by hand in Dhanmondi.</p><p>Everything we sell is plant-based. We keep the range short so the produce is always fresh.</p>'],
        'contact' => ['title' => 'Contact us', 'body' => '<p>Questions about an order, a product or a delivery slot? Write to us here or call 01700-000001 between 9 am and 8 pm. We reply within one working day.</p>'],
        'faq' => ['title' => 'Frequently asked questions', 'body' => '<p>Something else on your mind? Send us a message from the contact page.</p>'],
        'privacy' => ['title' => 'Privacy policy', 'body' => '<h2>What we collect</h2><p>Your name, phone number, e-mail and delivery address, used only to deliver your orders and answer your questions.</p><h2>What we never do</h2><p>We do not sell or share your details. Newsletter e-mails are sent only after you confirm your address.</p>'],
        'terms' => ['title' => 'Terms of service', 'body' => '<h2>Orders</h2><p>Prices include all charges shown at checkout. Fresh produce is weighed when packed and may vary slightly from the listed weight.</p><h2>Returns</h2><p>If anything arrives damaged or not fresh, tell us within 24 hours and we replace it or refund you.</p>'],
    ],
    'faq' => [
        ['Delivery', 'Where do you deliver?', '<p>Everywhere inside Dhaka city, and to other districts by courier.</p>'],
        ['Delivery', 'Is delivery free?', '<p>Inside Dhaka, delivery is free on orders over ৳1,500.</p>'],
        ['Products', 'Is everything really vegan?', '<p>Yes. Every product is plant-based, with no animal ingredients or animal testing.</p>'],
        [null, 'How do I keep produce fresh?', '<p>Store leafy greens in the fridge in their bag, and keep tomatoes and avocados at room temperature until ripe.</p>'],
    ],
    'blog' => [
        'category' => ['Recipes', 'recipes', 'Quick plant-based meals from the Green Basket kitchen.'],
        'posts' => [
            ['five-minute-smoothie-bowl', 'A five-minute smoothie bowl', 'Frozen berries, oat milk and a spoon of protein: breakfast before the kettle boils.', 'banner-hero-2', 4,
                '<p>Blend a cup of frozen berries with half a cup of oat milk and one scoop of vanilla protein until thick.</p><p>Top with granola, sliced banana and a few mulberries, and eat it straight away.</p>'],
            ['weeknight-quinoa-bowl', 'Weeknight quinoa bowl', 'One pot of quinoa, three toppings and a lemon dressing.', 'banner-promo', 11,
                '<p>Cook quinoa while you roast broccoli and cubes of tofu with a little oil and salt.</p><p>Finish with avocado, tomatoes and a dressing of lemon juice, olive oil and a pinch of chilli.</p>'],
            ['visiting-our-farms', 'A morning with our farmers', 'What we saw on a visit to the fields that grow our tomatoes and spinach.', 'banner-brand', 18,
                '<p>We spent a morning in Savar with the families who grow our tomatoes and spinach.</p><p>They rotate crops by season and use compost from the village, which is why the tomatoes taste like tomatoes.</p>'],
        ],
    ],
    'testimonials' => [
        ['quote' => 'The spinach still crunches two days later. I have not bought greens anywhere else since.', 'name' => 'Nusrat J.', 'role' => 'Dhanmondi', 'rating' => 5],
        ['quote' => 'Finally oat milk that foams properly. Delivery was on time both weeks.', 'name' => 'Tanvir A.', 'role' => 'Banani', 'rating' => 5],
        ['quote' => 'Good prices on the pantry staples and the tote bag is lovely.', 'name' => 'Mehreen S.', 'role' => 'Uttara', 'rating' => 4],
    ],
    'reviewers' => [
        ['name' => 'Nusrat Jahan', 'email' => 'nusrat@greenbasket.test', 'phone' => '01700000011', 'area' => 'Dhanmondi', 'reviews' => [
            ['avocado', 5, 'Perfectly ripe in two days', 'Ordered three and all of them ripened evenly on the counter. Creamy, no brown spots.'],
            ['oat-milk', 5, 'Foams like the real thing', 'I use it in my morning latte and it froths beautifully. Not too sweet.'],
            ['plant-protein', 4, 'Smooth, mild chocolate', 'Mixes well with oat milk. I would like a little more chocolate flavour, but no chalkiness at all.'],
        ]],
        ['name' => 'Tanvir Ahmed', 'email' => 'tanvir@greenbasket.test', 'phone' => '01700000012', 'area' => 'Banani', 'reviews' => [
            ['organic-tomatoes', 5, 'Tastes like tomatoes again', 'Sweet, deep red and they last the week. My curry has never been better.'],
            ['granola', 4, 'Crunchy and not too sweet', 'Big clusters that stay crisp. The bag could be resealable.'],
            ['tote-bag', 5, 'Strong and roomy', 'Carried a full shop home without the handles stretching.'],
        ]],
        ['name' => 'Mehreen Sultana', 'email' => 'mehreen@greenbasket.test', 'phone' => '01700000013', 'area' => 'Uttara', 'reviews' => [
            ['coconut-oil', 4, 'Lovely for hair', 'Light coconut smell and it melts quickly in the hand. The jar is a bit small.'],
            ['green-smoothie', 3, 'Fresh but sharp', 'Very fresh and clearly cold-pressed, though a bit too sour for me. I add a banana.'],
        ]],
    ],

    // P1b: answered shopper questions (DemoProductPageSeeder): [product, name, e-mail, language, question, answer].
    'questions' => [
        ['avocado', 'Sabrina Islam', 'sabrina@greenbasket.test', 'en', 'How ripe are the avocados when they arrive?', 'They arrive firm and ripen in two to three days on the counter. Move them to the fridge once they give a little when pressed.'],
        ['avocado', 'রাশেদ করিম', 'rashed@greenbasket.test', 'bn', 'ঢাকার বাইরে কি অ্যাভোকাডো পাঠান?', 'হ্যাঁ, কুরিয়ারে ৩–৫ দিনে পাঠাই। কাঁচা অবস্থায় পাঠাই, যাতে পৌঁছে পাকে।'],
        ['oat-milk', 'Imran Hossain', 'imran@greenbasket.test', 'en', 'Is the oat milk sweetened?', 'No sugar is added: just oats, water, sunflower oil and a pinch of salt. The natural oat sweetness is all you taste.'],
    ],

    'features' => [
        ['icon' => 'leaf', 'title' => '100 % plant-based', 'text' => 'Nothing from animals, ever'],
        ['icon' => 'truck', 'title' => 'Free delivery', 'text' => 'Inside Dhaka over ৳1,500'],
        ['icon' => 'shield-check', 'title' => 'Freshness promise', 'text' => 'Not fresh? We replace it'],
        ['icon' => 'headset', 'title' => 'Order by phone', 'text' => '01700-000000, 9 am to 8 pm'],
    ],
    'newsletter' => ['background' => '#2e7d32', 'foreground' => '#ffffff'],
    'sections' => [
        ['type' => 'hero_slider', 'banners' => ['banner-hero-1', 'banner-hero-2']],
        ['type' => 'features_strip', 'features' => true],
        ['type' => 'category_strip', 'title' => 'shop by category', 'categories' => ['fresh-produce', 'drinks', 'natural-beauty', 'fitness-nutrition']],
        ['type' => 'product_grid', 'title' => 'new arrivals', 'subtitle' => 'Just in from the farms', 'config' => ['source' => 'new_arrivals', 'limit' => 8, 'columns' => 4, 'view_all_url' => '/shop']],
        ['type' => 'banner_grid', 'banners' => ['banner-promo', 'banner-brand'], 'config' => ['layout' => '2-col']],
        ['type' => 'product_carousel', 'title' => 'best sellers', 'subtitle' => 'What Dhaka is cooking with this week', 'config' => ['source' => 'best_sellers', 'limit' => 8, 'view_all_url' => '/shop']],
        ['type' => 'hot_deals', 'title' => 'fresh weekend deals', 'subtitle' => '15 % off until Sunday night', 'config' => ['limit' => 8, 'view_all_url' => '/shop']],
        ['type' => 'testimonials', 'title' => 'what our customers say'],
        ['type' => 'blog_posts', 'title' => 'from our kitchen', 'subtitle' => 'Simple plant-based recipes', 'config' => ['limit' => 3, 'view_all_url' => '/blog']],
        ['type' => 'newsletter', 'title' => 'fresh picks in your inbox', 'config' => ['text' => 'One e-mail a week with what is in season. Unsubscribe any time.']],
    ],
];
