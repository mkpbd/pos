import {
  BadgePercentIcon,
  Columns2Icon,
  FileTextIcon,
  GalleryHorizontalIcon,
  HeadingIcon,
  ImageIcon,
  LayoutGridIcon,
  LayoutListIcon,
  LayoutTemplateIcon,
  MailIcon,
  MessageSquareQuoteIcon,
  MinusIcon,
  MoveVerticalIcon,
  NewspaperIcon,
  PanelTopIcon,
  PilcrowIcon,
  RectangleHorizontalIcon,
  ShapesIcon,
  SparklesIcon,
  SquareIcon,
  TagsIcon,
  type LucideIcon,
} from 'lucide-react'
import type { ElementGroup } from '@/storefront/builder/registry'

/** Icons and one-line explanations of the element catalogue (the server's registry has labels only). */
export const ELEMENT_ICONS: Record<string, LucideIcon> = {
  section: PanelTopIcon,
  column: SquareIcon,
  heading: HeadingIcon,
  text: PilcrowIcon,
  image: ImageIcon,
  button: RectangleHorizontalIcon,
  spacer: MoveVerticalIcon,
  divider: MinusIcon,
  inner_row: Columns2Icon,
  hero_slider: GalleryHorizontalIcon,
  banner_grid: LayoutGridIcon,
  rich_text: FileTextIcon,
  features_strip: SparklesIcon,
  testimonials: MessageSquareQuoteIcon,
  newsletter: MailIcon,
  product_carousel: GalleryHorizontalIcon,
  product_grid: LayoutGridIcon,
  product_tabs: LayoutListIcon,
  category_strip: ShapesIcon,
  brand_strip: TagsIcon,
  hot_deals: BadgePercentIcon,
  blog_posts: NewspaperIcon,
}

export function elementIcon(type: string): LucideIcon {
  return ELEMENT_ICONS[type] ?? LayoutTemplateIcon
}

export const ELEMENT_HINTS: Record<string, string> = {
  heading: 'A title for a part of the page.',
  text: 'Paragraphs with bold, italic, lists and links.',
  image: 'A picture from your media library, optionally linked.',
  button: 'A button that takes shoppers to a page.',
  spacer: 'Empty space between elements.',
  divider: 'A thin line that separates content.',
  inner_row: 'Columns inside a column, for side-by-side content.',
  hero_slider: 'Large sliding banners at the top of the page.',
  banner_grid: 'Two to four banners side by side.',
  rich_text: 'A block of formatted text with its own background.',
  features_strip: 'Short selling points with icons (free delivery, returns …).',
  testimonials: 'Quotes from happy customers.',
  newsletter: 'A sign-up form for your newsletter.',
  product_carousel: 'A scrolling row of products.',
  product_grid: 'Products in a grid: featured, best sellers, new or a category.',
  product_tabs: 'Several product lists behind tabs.',
  category_strip: 'Your shop categories as round tiles.',
  brand_strip: 'The brands you sell, as logos.',
  hot_deals: 'Products on promotion with a countdown.',
  blog_posts: 'Your latest blog posts.',
}

export const GROUP_LABELS: Record<ElementGroup, string> = {
  layout: 'Layout',
  content: 'Content',
  commerce: 'Commerce',
  marketing: 'Marketing',
}

export const GROUP_ORDER: ElementGroup[] = ['layout', 'content', 'commerce', 'marketing']
