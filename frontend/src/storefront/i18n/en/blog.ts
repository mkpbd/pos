import type { Messages } from '../types'

export const blog = {
  'blog.loading': 'Loading',
  'blog.loadError': 'This page could not be loaded',
  'blog.home': 'Home',
  'blog.title': 'Blog',
  'blog.categories': 'Blog categories',
  'blog.allPosts': 'All posts',
  'blog.postsIn': 'Posts in {category}',
  'blog.posts': 'Blog posts',
  'blog.emptyPage': 'There are no posts on this page',
  'blog.firstPage': 'Go to the first page',
  'blog.empty': 'No posts have been published yet',
  'blog.previousPost': 'Previous post',
  'blog.nextPost': 'Next post',
  'blog.filedUnder': 'Filed under {category}',
  'blog.morePosts': 'More posts',
  'blog.related': 'Related posts',
  'blog.by': 'By {author}',
  'blog.readingTime': { one: '{count} min read', other: '{count} min read' },
} as const satisfies Messages
