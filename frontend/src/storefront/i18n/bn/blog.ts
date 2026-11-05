import type { Translations } from '../types'
import type { blog as en } from '../en/blog'

export const blog: Translations<typeof en> = {
  'blog.loading': 'লোড হচ্ছে',
  'blog.loadError': 'পেজটি লোড করা যায়নি',
  'blog.home': 'হোম',
  'blog.title': 'ব্লগ',
  'blog.categories': 'ব্লগ ক্যাটাগরি',
  'blog.allPosts': 'সব পোস্ট',
  'blog.postsIn': '{category} বিষয়ের পোস্ট',
  'blog.posts': 'ব্লগ পোস্ট',
  'blog.emptyPage': 'এই পেজে কোনো পোস্ট নেই',
  'blog.firstPage': 'প্রথম পেজে যান',
  'blog.empty': 'এখনো কোনো পোস্ট প্রকাশিত হয়নি',
  'blog.previousPost': 'আগের পোস্ট',
  'blog.nextPost': 'পরের পোস্ট',
  'blog.filedUnder': 'বিষয়: {category}',
  'blog.morePosts': 'আরও পোস্ট',
  'blog.related': 'সম্পর্কিত পোস্ট',
  'blog.by': 'লিখেছেন {author}',
  'blog.readingTime': { one: 'পড়তে {count} মিনিট', other: 'পড়তে {count} মিনিট' },
}
