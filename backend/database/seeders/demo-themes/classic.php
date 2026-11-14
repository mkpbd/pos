<?php

/**
 * Classic Shop — the classic preset demo store (DemoThemesSeeder). Same shape as vegan.php.
 */
return [
    'name' => 'Classic Shop',
    'host' => 'classic.shop.localhost',
    'preset' => 'classic',
    'owner' => ['name' => 'Arif Hossain', 'email' => 'owner@classicshop.test'],
    'branch' => 'Classic Shop Banani',
    'sku' => 'CS',
    'meta_description' => 'Everyday menswear, womenswear, shoes, bags and accessories from Classic Shop, delivered across Bangladesh.',
    'free_delivery_over' => '5000.00',
    'coupon' => ['code' => 'CLASSIC20', 'name' => 'Classic 20', 'description' => '20% off orders over ৳5,000 with code CLASSIC20', 'percent' => '20', 'min' => '5000'],
    'flash_sale' => [
        'name' => 'Mid-season flash sale', 'description' => '20% off selected styles for two days only',
        'percent' => '20', 'days' => 2, 'products' => ['backpack', 'leather-belt', 'wool-scarf', 'running-shoes'],
    ],
    'out_of_stock' => 'wrist-watch',
    // Sold at the shop counter (POS): the best sellers.
    'best_sellers' => ['crew-tshirt' => 8, 'oxford-shirt' => 5, 'summer-dress' => 4, 'leather-belt' => 4, 'white-sneakers' => 3, 'chino-trousers' => 3, 'aviator-sunglasses' => 3],
    'swatches' => ['Colour' => [
        'White' => '#ffffff', 'Black' => '#111111', 'Navy' => '#1e3a8a', 'Tan' => '#b07d4f',
        'Beige' => '#d6c7a8', 'Grey' => '#9ca3af', 'Camel' => '#c19a6b',
    ]],

    'categories' => [
        'men' => ['Men', 'cat-men', 'Shirts, jackets, trousers and T-shirts for every day.'],
        'women' => ['Women', 'cat-women', 'Dresses, knitwear, blouses and denim.'],
        'shoes' => ['Shoes', 'cat-shoes', 'Sneakers, boots and running shoes in full sizes.'],
        'bags' => ['Bags', 'cat-bags', 'Totes, backpacks and crossbody bags for work and weekends.'],
        'accessories' => ['Accessories', 'cat-accessories', 'Sunglasses, belts, watches and scarves to finish the look.'],
    ],

    'products' => [
        'oxford-shirt' => ['name' => 'Oxford Button-down Shirt', 'category' => 'men', 'price' => '1990', 'sale' => '1590', 'featured' => true,
            'variants' => ['Size' => ['S', 'M', 'L', 'XL']],
            'text' => 'A soft oxford-weave cotton shirt with a button-down collar. Smart enough for the office and relaxed enough for the weekend.'],
        'denim-jacket' => ['name' => 'Classic Denim Jacket', 'category' => 'men', 'price' => '3990', 'featured' => true,
            'variants' => ['Size' => ['M', 'L', 'XL']],
            'text' => 'A mid-wash denim jacket in sturdy 12 oz cotton. It softens with every wear and goes with almost everything.'],
        'chino-trousers' => ['name' => 'Slim Chino Trousers', 'category' => 'men', 'price' => '2290',
            'variants' => ['Waist' => ['30', '32', '34']],
            'text' => 'Slim-fit chinos in stretch cotton twill. A clean, tapered leg that works with sneakers or loafers.'],
        'crew-tshirt' => ['name' => 'Crew-neck T-shirt', 'category' => 'men', 'price' => '790', 'sale' => '590',
            'variants' => ['Colour' => ['White', 'Black', 'Navy']],
            'text' => 'A heavyweight cotton T-shirt that keeps its shape after washing. Ribbed collar and a regular fit.'],
        'summer-dress' => ['name' => 'Floral Summer Dress', 'category' => 'women', 'price' => '2890', 'sale' => '2290', 'featured' => true,
            'variants' => ['Size' => ['S', 'M', 'L']],
            'text' => 'A light viscose dress with a small floral print and a tie waist. Breezy enough for the hottest afternoons.'],
        'knit-sweater' => ['name' => 'Cable Knit Sweater', 'category' => 'women', 'price' => '3290',
            'variants' => ['Size' => ['S', 'M', 'L']],
            'text' => 'A chunky cable-knit sweater in a soft cotton blend. Cosy for winter evenings without being heavy.'],
        'linen-blouse' => ['name' => 'Linen Blouse', 'category' => 'women', 'price' => '1890',
            'variants' => ['Size' => ['S', 'M', 'L']],
            'text' => 'A relaxed linen blouse with a small stand collar. Cool, breathable and better with every wash.'],
        'wide-leg-jeans' => ['name' => 'Wide-leg Jeans', 'category' => 'women', 'price' => '2590', 'sale' => '2190',
            'variants' => ['Waist' => ['26', '28', '30']],
            'text' => 'High-rise wide-leg jeans in rigid cotton denim. A long, easy line that pairs well with a tucked-in blouse.'],
        'white-sneakers' => ['name' => 'White Leather Sneakers', 'category' => 'shoes', 'price' => '4490', 'sale' => '3990', 'featured' => true,
            'variants' => ['Size' => ['40', '41', '42', '43']],
            'text' => 'Minimal sneakers in smooth white leather with a cushioned insole. Wipe clean and wear with everything.'],
        'chelsea-boots' => ['name' => 'Suede Chelsea Boots', 'category' => 'shoes', 'price' => '5990',
            'variants' => ['Size' => ['40', '41', '42']],
            'text' => 'Ankle boots in soft suede with elastic sides and a grippy rubber sole. Easy to pull on and built to last.'],
        'running-shoes' => ['name' => 'Running Shoes', 'category' => 'shoes', 'price' => '3790',
            'variants' => ['Size' => ['39', '40', '41', '42']],
            'text' => 'Light running shoes with a breathable mesh upper and a responsive foam sole. Good for daily runs and long walks.'],
        'leather-tote' => ['name' => 'Leather Tote Bag', 'category' => 'bags', 'price' => '4990', 'sale' => '4290', 'featured' => true,
            'variants' => ['Colour' => ['Tan', 'Black']],
            'text' => 'A structured tote in full-grain leather with an inner zip pocket. Fits a 14-inch laptop and a day of essentials.'],
        'backpack' => ['name' => 'Canvas Backpack', 'category' => 'bags', 'price' => '2790',
            'text' => 'A waxed canvas backpack with leather straps and a padded laptop sleeve. Shrugs off light rain.'],
        'crossbody' => ['name' => 'Mini Crossbody Bag', 'category' => 'bags', 'price' => '2190',
            'variants' => ['Colour' => ['Black', 'Beige']],
            'text' => 'A small crossbody bag with an adjustable strap and a magnetic flap. Holds a phone, cards and keys.'],
        'aviator-sunglasses' => ['name' => 'Aviator Sunglasses', 'category' => 'accessories', 'price' => '1490', 'sale' => '1190',
            'text' => 'Metal-frame aviators with polarised lenses and full UV protection. Comes with a hard case and cleaning cloth.'],
        'leather-belt' => ['name' => 'Leather Belt', 'category' => 'accessories', 'price' => '990',
            'variants' => ['Size' => ['32', '34', '36']],
            'text' => 'A plain leather belt with a brushed metal buckle. Cut from a single strip of cowhide.'],
        'wrist-watch' => ['name' => 'Minimal Wrist Watch', 'category' => 'accessories', 'price' => '5490',
            'text' => 'A slim quartz watch with a clean dial and a leather strap. Water resistant to 30 metres.'],
        'wool-scarf' => ['name' => 'Wool Scarf', 'category' => 'accessories', 'price' => '1290',
            'variants' => ['Colour' => ['Grey', 'Camel']],
            'text' => 'A soft wool-blend scarf, long enough to wrap twice. Warm without being bulky.'],
    ],

    'banners' => [
        'banner-sale-1' => ['placement' => 'hero_slider', 'name' => 'Season sale', 'kicker' => 'SALE UP TO 30 % OFF',
            'title' => 'The season sale is on', 'subtitle' => 'Shirts, dresses, sneakers and bags at their lowest prices.',
            'button_label' => 'Shop the sale', 'link_url' => '/shop', 'secondary_button_label' => 'Women', 'secondary_link_url' => '/category/women',
            'text_color' => '#ffffff'],
        'banner-sale-2' => ['placement' => 'hero_slider', 'name' => 'New arrivals', 'kicker' => 'SALE UP TO 30 % OFF',
            'title' => 'New arrivals every week', 'subtitle' => 'Fresh styles on the rail, every Thursday.',
            'button_label' => 'Shop men', 'link_url' => '/category/men', 'text_color' => '#ffffff'],
        'banner-men' => ['placement' => 'home_promo', 'name' => 'Men', 'kicker' => 'Men', 'title' => 'Everyday menswear',
            'button_label' => 'Shop men', 'link_url' => '/category/men', 'text_color' => '#ffffff'],
        'banner-women' => ['placement' => 'home_promo', 'name' => 'Women', 'kicker' => 'Women', 'title' => 'Light layers for summer',
            'button_label' => 'Shop women', 'link_url' => '/category/women', 'text_color' => '#ffffff'],
        'banner-shoes' => ['placement' => 'home_promo', 'name' => 'Shoes', 'kicker' => 'Shoes', 'title' => 'Boots and sneakers',
            'button_label' => 'Shop shoes', 'link_url' => '/category/shoes', 'text_color' => '#ffffff'],
    ],

    'theme' => [
        'announcement' => ['text' => 'Season sale: up to 30 % off — free delivery on orders over ৳5,000', 'background' => '#111111', 'foreground' => '#ffffff'],
        'footer' => [
            'about' => 'Classic Shop sells well-made everyday clothes, shoes and accessories at fair prices, online and in Banani.',
            'copyright' => '© Classic Shop (demo store). All rights reserved.',
            'contact' => ['email' => 'care@classicshop.test', 'phone' => '01700-000003', 'address' => 'House 22, Road 11, Banani, Dhaka 1213'],
            'social' => ['facebook' => 'https://facebook.example/classicshop', 'instagram' => 'https://instagram.example/classicshop', 'youtube' => 'https://youtube.example/classicshop'],
        ],
    ],

    'pages' => [
        'about' => ['title' => 'About us', 'body' => '<h2>Classics, done well</h2><p>Classic Shop opened in Banani in 2015 with one rail of shirts. Today we design and source everyday clothing, shoes and bags that last more than a season.</p><p>We keep prices fair by working directly with a few trusted factories.</p>'],
        'contact' => ['title' => 'Contact us', 'body' => '<p>Need help with a size, an order or a return? Send us a message or call 01700-000003, 10 am to 9 pm every day.</p>'],
        'faq' => ['title' => 'Frequently asked questions', 'body' => '<p>Still have a question? Our team is happy to help from the contact page.</p>'],
        'privacy' => ['title' => 'Privacy policy', 'body' => '<h2>Information we keep</h2><p>Your name, contact details, address and order history, used to deliver orders and handle returns.</p><h2>Your choices</h2><p>You can update your details in your account and unsubscribe from e-mails at any time.</p>'],
        'terms' => ['title' => 'Terms of service', 'body' => '<h2>Prices</h2><p>Sale prices are valid while stock lasts and until the end date shown.</p><h2>Exchanges</h2><p>Unworn items with tags can be exchanged or returned within 7 days of delivery.</p>'],
    ],
    'faq' => [
        ['Sizing', 'How do I choose my size?', '<p>Each product lists its fit. If you are between sizes, choose the larger one for a relaxed fit.</p>'],
        ['Delivery', 'How much is delivery?', '<p>Inside Dhaka it is free on orders over ৳5,000; otherwise the fee is shown at checkout.</p>'],
        ['Returns', 'Can I exchange an item?', '<p>Yes, unworn items with tags can be exchanged within 7 days of delivery.</p>'],
        [null, 'Do you have a physical store?', '<p>Yes, in Banani, open from 10 am to 9 pm every day.</p>'],
    ],
    'blog' => [
        'category' => ['Style notes', 'style-notes', 'Outfit ideas, care tips and what is new at Classic Shop.'],
        'posts' => [
            ['five-pieces-for-every-wardrobe', 'Five pieces for every wardrobe', 'The basics we would buy first, and how to wear them.', 'banner-sale-2', 3,
                '<p>An oxford shirt, dark chinos, a crew-neck T-shirt, white sneakers and a denim jacket cover most of the week.</p><p>Add one good bag and you are done.</p>'],
            ['caring-for-leather', 'How to care for leather', 'Simple steps that keep bags, belts and boots looking good for years.', 'banner-shoes', 10,
                '<p>Wipe leather with a dry cloth, keep it away from direct heat and condition it twice a year.</p><p>Suede needs a soft brush and a protective spray instead.</p>'],
            ['summer-in-linen', 'Summer in linen', 'Why linen is the most comfortable fabric for a Dhaka summer.', 'banner-women', 17,
                '<p>Linen lets air through and dries quickly, which is exactly what you want in humid weather.</p><p>Embrace the creases: they are part of its charm.</p>'],
        ],
    ],
    'testimonials' => [
        ['quote' => 'The oxford shirt fits perfectly and the fabric feels great after many washes.', 'name' => 'Rafiq H.', 'role' => 'Gulshan', 'rating' => 5],
        ['quote' => 'Quick delivery and easy exchange when I needed a different size.', 'name' => 'Lamia C.', 'role' => 'Dhanmondi', 'rating' => 5],
        ['quote' => 'Good quality for the price. The sneakers are my daily pair now.', 'name' => 'Sabbir M.', 'role' => 'Chattogram', 'rating' => 4],
    ],
    'reviewers' => [
        ['name' => 'Rafiq Hasan', 'email' => 'rafiq@classicshop.test', 'phone' => '01700000031', 'area' => 'Gulshan', 'reviews' => [
            ['oxford-shirt', 5, 'Great everyday shirt', 'Soft fabric, true to size and the collar keeps its shape.'],
            ['denim-jacket', 4, 'Solid denim', 'Stiff at first but softening nicely. Sleeves are a little long.'],
            ['white-sneakers', 5, 'Comfortable from day one', 'No break-in needed and they clean up easily.'],
        ]],
        ['name' => 'Lamia Chowdhury', 'email' => 'lamia@classicshop.test', 'phone' => '01700000032', 'area' => 'Dhanmondi', 'reviews' => [
            ['summer-dress', 5, 'Light and pretty', 'Perfect for hot days and the print is lovely in person.'],
            ['leather-tote', 4, 'Smart and roomy', 'Fits my laptop and lunch. The leather smells wonderful.'],
            ['aviator-sunglasses', 3, 'Nice but a bit wide', 'Good lenses and case, but the frame is wide for my face.'],
        ]],
        ['name' => 'Sabbir Mahmud', 'email' => 'sabbir@classicshop.test', 'phone' => '01700000033', 'area' => 'Mirpur', 'reviews' => [
            ['crew-tshirt', 4, 'Thick cotton', 'Heavier than most T-shirts and did not shrink.'],
        ]],
    ],

    // P1b: answered shopper questions (DemoProductPageSeeder): [product, name, e-mail, language, question, answer].
    'questions' => [
        ['oxford-shirt', 'Arif Rahman', 'arif@classicshop.test', 'en', 'Does the shirt shrink after washing?', 'It is pre-washed, so it keeps its size. Wash at 30 °C and hang it to dry for the best fit.'],
        ['oxford-shirt', 'মাহমুদ হাসান', 'mahmud@classicshop.test', 'bn', 'কোন সাইজ নেব বুঝতে পারছি না।', 'সাইজ গাইডে বুকের মাপ দেওয়া আছে। দুই সাইজের মাঝামাঝি হলে বড়টি নিন।'],
        ['white-sneakers', 'Priya Das', 'priya@classicshop.test', 'en', 'Are the sneakers true to size?', 'Yes, they fit true to size. If you are between two sizes, choose the larger one.'],
    ],

    'features' => [
        ['icon' => 'truck', 'title' => 'Free delivery', 'text' => 'Inside Dhaka over ৳5,000'],
        ['icon' => 'rotate-ccw', 'title' => '7-day exchange', 'text' => 'Unworn, with tags'],
        ['icon' => 'credit-card', 'title' => 'Cash on delivery', 'text' => 'Or bank transfer'],
        ['icon' => 'store', 'title' => 'Visit us', 'text' => 'Banani, 10 am to 9 pm'],
    ],
    'newsletter' => ['background' => '#111111', 'foreground' => '#ffffff'],
    'sections' => [
        ['type' => 'hero_slider', 'banners' => ['banner-sale-1', 'banner-sale-2']],
        ['type' => 'banner_grid', 'banners' => ['banner-men', 'banner-women', 'banner-shoes'], 'config' => ['layout' => '3-col']],
        ['type' => 'product_tabs', 'title' => 'Shop the collection', 'config' => ['limit' => 8, 'tabs' => [
            ['label' => 'Featured', 'source' => 'featured'],
            ['label' => 'Best sellers', 'source' => 'best_sellers'],
            ['label' => 'On sale', 'source' => 'on_sale'],
        ]]],
        ['type' => 'category_strip', 'title' => 'Shop by category', 'categories' => ['men', 'women', 'shoes', 'bags', 'accessories']],
        ['type' => 'hot_deals', 'title' => 'Flash sale', 'subtitle' => 'Ends soon', 'config' => ['limit' => 8, 'view_all_url' => '/shop']],
        ['type' => 'features_strip', 'features' => true],
        ['type' => 'product_grid', 'title' => 'Best sellers', 'config' => ['source' => 'best_sellers', 'limit' => 8, 'columns' => 4, 'view_all_url' => '/shop']],
        ['type' => 'testimonials', 'title' => 'Customer reviews'],
        ['type' => 'blog_posts', 'title' => 'Style notes', 'config' => ['limit' => 3, 'view_all_url' => '/blog']],
    ],

    // P1a (DemoVariantsSeeder): photos per colour (product photo files by value), option swatch
    // styles and size guides with Bangla.
    'option_photos' => [
        'leather-tote' => ['option' => 'Colour', 'style' => 'image', 'values' => ['Tan' => ['leather-tote.jpg'], 'Black' => ['leather-tote-2.jpg']]],
    ],
    'size_guides' => [
        [
            'name' => 'Clothing sizes', 'title' => 'Clothing size guide', 'categories' => ['men', 'women'],
            'intro' => 'Measure over a thin T-shirt with a soft tape. Measurements are of the body, in centimetres.',
            'note' => 'Between two sizes? Choose the larger one for a relaxed fit.',
            'columns' => ['size' => 'Size', 'chest' => 'Chest (cm)', 'waist' => 'Waist (cm)', 'hip' => 'Hip (cm)'],
            'rows' => [
                ['size' => 'S', 'chest' => '86–91', 'waist' => '71–76', 'hip' => '86–91'],
                ['size' => 'M', 'chest' => '96–101', 'waist' => '81–86', 'hip' => '96–101'],
                ['size' => 'L', 'chest' => '106–111', 'waist' => '91–96', 'hip' => '106–111'],
                ['size' => 'XL', 'chest' => '116–121', 'waist' => '101–106', 'hip' => '116–121'],
            ],
            'bn' => [
                'title' => 'পোশাকের মাপের গাইড',
                'intro' => 'পাতলা টি-শার্টের ওপর নরম ফিতা দিয়ে মাপুন। মাপগুলো শরীরের, সেন্টিমিটারে।',
                'note' => 'দুই মাপের মাঝামাঝি হলে আরামদায়ক ফিটের জন্য বড়টি বেছে নিন।',
                'columns' => ['size' => 'মাপ', 'chest' => 'বুক (সেমি)', 'waist' => 'কোমর (সেমি)', 'hip' => 'নিতম্ব (সেমি)'],
            ],
        ],
        [
            'name' => 'Shoe sizes', 'title' => 'Shoe size guide', 'categories' => ['shoes'],
            'intro' => 'Stand on a sheet of paper, mark your heel and longest toe, and measure the distance.',
            'note' => 'Sizes run true to EU sizing.',
            'columns' => ['eu' => 'EU', 'uk' => 'UK', 'foot' => 'Foot length (cm)'],
            'rows' => [
                ['eu' => '39', 'uk' => '6', 'foot' => '24.6'],
                ['eu' => '40', 'uk' => '6.5', 'foot' => '25.3'],
                ['eu' => '41', 'uk' => '7', 'foot' => '26.0'],
                ['eu' => '42', 'uk' => '8', 'foot' => '26.6'],
                ['eu' => '43', 'uk' => '9', 'foot' => '27.3'],
            ],
            'bn' => [
                'title' => 'জুতার মাপের গাইড',
                'intro' => 'একটি কাগজের ওপর দাঁড়িয়ে গোড়ালি আর সবচেয়ে লম্বা আঙুল চিহ্নিত করুন, তারপর দূরত্ব মাপুন।',
                'note' => 'মাপগুলো ইউরোপীয় (EU) মাপ অনুযায়ী।',
                'columns' => ['foot' => 'পায়ের দৈর্ঘ্য (সেমি)'],
            ],
        ],
    ],
];
