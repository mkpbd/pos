import type { FeedChannel } from '@/features/marketing/feeds-api'

/**
 * P2b product feeds: what each shopping channel is for and, step by step, where its feed address
 * goes. Written for shop owners, not developers; menu names as the channels show them in 2026.
 */

export type FeedChannelCopy = {
  /** Card title. */
  title: string
  /** Short name in buttons and messages ("the Meta feed"). */
  short: string
  description: string
  /** The tool the steps happen in. */
  where: string
  /** Opened from the steps (new tab). */
  link: { href: string; label: string }
  steps: string[]
  /** What happens after the last step. */
  after: string
}

export const FEED_CHANNELS: readonly FeedChannel[] = ['meta', 'tiktok', 'pinterest']

export const FEED_COPY: Record<FeedChannel, FeedChannelCopy> = {
  meta: {
    title: 'Facebook & Instagram Shop (Meta)',
    short: 'Meta',
    description: 'Shows your products in the Shop on your Facebook Page and Instagram, lets you tag them in posts and use them in ads.',
    where: 'Meta Commerce Manager',
    link: { href: 'https://business.facebook.com/commerce', label: 'Open Commerce Manager' },
    steps: [
      'Open Commerce Manager and choose your catalog. No catalog yet? Choose “Add catalog”, pick “E-commerce” and create it.',
      'In the catalog, go to Catalog → Data sources and choose “Add items”.',
      'Choose “Data feed”, then “Scheduled feed” (it may say “Use a URL”).',
      'Paste the feed address and set the updates to “Daily”.',
      'Choose BDT as the currency, give the data source a name such as “Online store”, and upload.',
      'After a few minutes, check Catalog → Items. If Meta lists problems, fix them in your products here — the feed picks up the changes.',
    ],
    after: 'Then connect the catalog to your Shop (Commerce Manager → Shops) to tag products in Facebook and Instagram posts.',
  },
  tiktok: {
    title: 'TikTok catalog',
    short: 'TikTok',
    description: 'Puts your products in a TikTok catalog for product ads and shopping videos.',
    where: 'TikTok Ads Manager',
    link: { href: 'https://ads.tiktok.com', label: 'Open TikTok Ads Manager' },
    steps: [
      'Open TikTok Ads Manager and go to Assets → Catalogs.',
      'Choose “Create”, pick “E-commerce”, then your country and currency.',
      'Open the catalog and choose Products → Add products → Data feed.',
      'Choose “Scheduled” updates, paste the feed address and pick “Daily”.',
      'Start the upload. TikTok shows how many products it accepted and lists any problems.',
    ],
    after: 'Your products then appear in the catalog and can be used in TikTok product ads.',
  },
  pinterest: {
    title: 'Pinterest catalog',
    short: 'Pinterest',
    description: 'Turns your products into shoppable Pins with price and stock.',
    where: 'Pinterest catalogs',
    link: { href: 'https://www.pinterest.com/business/catalogs/', label: 'Open Pinterest catalogs' },
    steps: [
      'You need a Pinterest business account with your store’s website claimed (Settings → Claimed accounts → Websites).',
      'Go to Ads → Catalogs and choose “Create data source”.',
      'Give it a name, choose “XML” as the file format (or “CSV” if you copied the CSV address) and paste the feed address.',
      'Choose your currency, country and language, then “Create pins”.',
    ],
    after: 'Pinterest reads the feed every day; the first time it can take up to 24 hours before your Pins appear.',
  },
}

/** The address with a query parameter added (the Bangla version is `?lang=bn`). */
export function withQuery(url: string, key: string, value: string): string {
  try {
    const parsed = new URL(url)
    parsed.searchParams.set(key, value)
    return parsed.toString()
  } catch {
    return `${url}${url.includes('?') ? '&' : '?'}${key}=${encodeURIComponent(value)}`
  }
}
