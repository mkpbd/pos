import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'
import { pageContext, type AssistantTurn, type CurrentConversation } from './assistant/api'
import { replyHandoff, storeHandoff, waNumberOf } from './assistant/handoff'
import { parseAssistantText, plainText, safeStorePath } from './assistant/safe-text'
import { ASSISTANT_TOKEN_KEY, readAssistantToken, writeAssistantToken } from './assistant/token-store'
import { ASSISTANT_ATTRIBUTE, assistantEnabled, isPreviewContext } from './assistant/visibility'
import { storefrontRoutes } from './routes'
import { CHAT_ATTRIBUTE } from './social/whatsapp'
import { bilingualBootstrap, bootstrapFixture, cartFixture, productDetail, resetLocale, tEn } from './test-fixtures'
import type { StoreAssistantBootstrap, StorefrontBootstrap } from './types'

const ORIGIN = window.location.origin
const NUMBER = '8801712345678'
const TOKEN = 'tok_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

afterEach(() => {
  resetLocale()
  localStorage.clear()
  document.documentElement.removeAttribute(CHAT_ATTRIBUTE)
  document.documentElement.removeAttribute(ASSISTANT_ATTRIBUTE)
})

const ASSISTANT: StoreAssistantBootstrap = { enabled: true, name: 'Berry helper', greeting: 'Hi! Ask me anything about Berry Kids.', handoff: 'whatsapp', handoff_url: `https://wa.me/${NUMBER}` }

function withAssistant(assistant: Partial<StoreAssistantBootstrap> | null = {}, base: StorefrontBootstrap = bootstrapFixture()): StorefrontBootstrap {
  return { ...base, store: { ...base.store, whatsapp_number: NUMBER }, assistant: assistant ? { ...ASSISTANT, ...assistant } : null }
}

const turn = (overrides: Partial<AssistantTurn> = {}): AssistantTurn => ({
  conversation_token: TOKEN,
  reply: {
    text: 'Delivery inside Dhaka is **৳60**.\n\n- Outside Dhaka: ৳120\n- Read [our delivery page](/pages/delivery)\n\nSee [Kids Tee](/product/kids-tee) or [this](https://evil.test/x).',
    products: [{ slug: 'kids-tee', name: 'Kids Tee', image_url: '/storage/tee.png', price_text: '৳450', in_stock: true }],
    links: [{ label: 'Delivery', path: '/pages/delivery' }, { label: 'Evil', path: 'https://evil.test' }],
    handoff: { type: 'whatsapp', url: `https://wa.me/${NUMBER}?text=Hello%20from%20the%20server` },
  },
  status: 'ok',
  remaining_messages: 19,
  ...overrides,
})

type Sent = { body: Record<string, unknown>; url: URL }

function serve({ bootstrap = withAssistant(), reply = (): ReturnType<typeof ok> => ok(turn()), current }: { bootstrap?: StorefrontBootstrap; reply?: (sent: Sent) => ReturnType<typeof ok>; current?: CurrentConversation } = {}) {
  const sent: Sent[] = []
  const fetchMock = mockApi({
    'GET /store/bootstrap': ok(bootstrap),
    'GET /store/account/me': ok(null),
    'GET /store/cart': ok(cartFixture()),
    'GET /store/wishlist': ok({ items: [] }),
    'GET /store/builder/popups': ok({ popups: [], never_on: [] }),
    'GET /store/homepage': ok({ sections: [], preview: false }),
    'GET /store/products/kids-tee': ok(productDetail()),
    'GET /store/products/kids-tee/related': ok({ related: [], frequently_bought: [], frequently_bought_source: null }),
    'GET /store/products/kids-tee/reviews': ok([], { summary: { average: '0.0', count: 0, distribution: {} } }),
    'GET /store/products/kids-tee/questions': ok([], { pagination: { current_page: 1, per_page: 10, total: 0, last_page: 1 } }),
    'GET /store/pages/delivery': fail(404, 'NOT_FOUND'),
    'POST /store/visits': ok({ recorded: true }),
    'POST /store/assistant/messages': (init, url) => {
      const entry = { body: JSON.parse(String(init.body)) as Record<string, unknown>, url }
      sent.push(entry)
      return reply(entry)
    },
    'GET /store/assistant/conversations/current': ok(current ?? { conversation_token: null, messages: [], remaining_messages: 20 }),
  })
  return { sent, fetchMock }
}

/** The message list (the screen-reader announcer repeats the newest reply). */
const log = (panel: HTMLElement) => within(within(panel).getByTestId('assistant-messages'))

async function openChat(user = userEvent.setup(), name: RegExp | string = /Ask Berry helper/) {
  await user.click(await screen.findByRole('button', { name }))
  return { user, panel: await screen.findByRole('dialog') }
}

describe('the safe text renderer', () => {
  it('reads paragraphs, bullets, bold and own-store links; nothing else', () => {
    const blocks = parseAssistantText('Hello **there**\nsecond line\n\n- one [Tee](/product/kids-tee)\n* two\n\n<b>not bold</b> [x](javascript:alert(1)) [y](//evil.test) [z](https://evil.test/a)', ORIGIN)
    expect(blocks).toEqual([
      { kind: 'paragraph', lines: [[{ kind: 'text', text: 'Hello ' }, { kind: 'bold', children: [{ kind: 'text', text: 'there' }] }], [{ kind: 'text', text: 'second line' }]] },
      { kind: 'list', items: [[{ kind: 'text', text: 'one ' }, { kind: 'link', label: 'Tee', path: '/product/kids-tee' }], [{ kind: 'text', text: 'two' }]] },
      // HTML stays text; links elsewhere keep their label only.
      { kind: 'paragraph', lines: [[{ kind: 'text', text: '<b>not bold</b> [x](javascript:alert(1)) y z' }]] },
    ])
    expect(plainText('**Price:** ৳60\n\n- [Tee](/product/tee)', ORIGIN)).toBe('Price: ৳60 Tee')
  })

  it('accepts only root-relative paths and this origin', () => {
    expect(safeStorePath('/product/kids-tee?variant=v1#reviews', ORIGIN)).toBe('/product/kids-tee?variant=v1#reviews')
    expect(safeStorePath(`${ORIGIN}/pages/contact`, ORIGIN)).toBe('/pages/contact')
    for (const bad of ['//evil.test/x', '/\\evil.test', 'https://evil.test/pages', 'javascript:alert(1)', 'data:text/html,x', 'pages/contact', '/a b', '', '/x‮y', null]) {
      expect(safeStorePath(bad, ORIGIN), String(bad)).toBeNull()
    }
  })

  it('drops control and direction-override characters', () => {
    expect(plainText('a\u0007b‮c', ORIGIN)).toBe('abc')
  })
})

describe('assistant helpers', () => {
  it('sends the page context of product and category pages', () => {
    expect(pageContext('/product/kids-tee')).toEqual({ type: 'product', slug: 'kids-tee' })
    expect(pageContext('/category/t%C3%A9es/')).toEqual({ type: 'category', slug: 'tées' })
    expect(pageContext('/blog/x')).toEqual({ type: 'other' })
  })

  it('follows only wa.me and own-store hand-offs, with the first question typed in', () => {
    expect(waNumberOf(`https://wa.me/${NUMBER}?text=x`)).toBe(NUMBER)
    expect(waNumberOf(`https://evil.test/${NUMBER}`)).toBeNull()
    expect(waNumberOf(`http://wa.me/${NUMBER}`)).toBeNull()

    const kept = replyHandoff({ type: 'whatsapp', url: `https://wa.me/${NUMBER}?text=From%20server` }, tEn, 'Where is my order?')
    expect(kept).toEqual({ kind: 'whatsapp', href: `https://wa.me/${NUMBER}?text=From%20server` })
    const built = replyHandoff({ type: 'whatsapp', url: `https://wa.me/${NUMBER}` }, tEn, 'Do you  deliver\nto Sylhet?')
    expect(new URL((built as { href: string }).href).searchParams.get('text')).toBe('Hello! I asked your shop assistant: Do you deliver to Sylhet?')
    expect(replyHandoff({ type: 'whatsapp', url: 'https://evil.test/' }, tEn, null)).toBeNull()
    expect(replyHandoff({ type: 'contact', url: '/pages/contact' }, tEn, null)).toEqual({ kind: 'contact', path: '/pages/contact' })
    expect(replyHandoff({ type: 'contact', url: 'https://evil.test/contact' }, tEn, null)).toBeNull()

    // The bootstrap's choice; without handoff_url the store's own number.
    const store = withAssistant({ handoff_url: null })
    expect(new URL((storeHandoff(store, tEn, null) as { href: string }).href).searchParams.get('text')).toBe('Hello! I have a question.')
    expect(storeHandoff(withAssistant({ handoff: 'contact', handoff_url: '/pages/contact' }), tEn, null)).toEqual({ kind: 'contact', path: '/pages/contact' })
    expect(storeHandoff(withAssistant({ handoff: 'none', handoff_url: null }), tEn, null)).toBeNull()
  })

  it('keeps the token in localStorage and survives storage that throws', () => {
    writeAssistantToken(TOKEN)
    expect(localStorage.getItem(ASSISTANT_TOKEN_KEY)).toBe(TOKEN)
    expect(readAssistantToken()).toBe(TOKEN)
    localStorage.setItem(ASSISTANT_TOKEN_KEY, '<script>')
    expect(readAssistantToken()).toBeNull()
    writeAssistantToken(null)
    expect(localStorage.getItem(ASSISTANT_TOKEN_KEY)).toBeNull()

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    expect(readAssistantToken()).toBeNull()
    expect(() => writeAssistantToken(TOKEN)).not.toThrow()
  })

  it('stays out of previews, the editor and framed pages', () => {
    const live = { pathname: '/product/x', search: '' }
    expect(assistantEnabled(withAssistant(), live)).toBe(true)
    expect(assistantEnabled(withAssistant({ enabled: false }), live)).toBe(false)
    expect(assistantEnabled(withAssistant(null), live)).toBe(false)
    expect(assistantEnabled({ ...withAssistant(), preview: true }, live)).toBe(false)
    expect(isPreviewContext({ pathname: '/', search: '?preview=draft' })).toBe(true)
    expect(isPreviewContext({ pathname: '/', search: '?preview=1' })).toBe(true)
    expect(isPreviewContext({ pathname: '/admin/builder-canvas', search: '' })).toBe(true)
  })
})

describe('the shop assistant widget', () => {
  it('shows no chat button when the store’s assistant is off or the page is a preview', async () => {
    serve({ bootstrap: withAssistant({ enabled: false }) })
    const first = renderRoutes(storefrontRoutes, '/')
    expect(await screen.findByRole('banner')).toBeInTheDocument()
    expect(screen.queryByTestId('assistant-launcher')).not.toBeInTheDocument()
    expect(document.documentElement).not.toHaveAttribute(ASSISTANT_ATTRIBUTE)
    first.unmount()

    serve({ bootstrap: withAssistant() })
    renderRoutes(storefrontRoutes, '/?preview=1')
    expect(await screen.findByRole('banner')).toBeInTheDocument()
    expect(screen.queryByTestId('assistant-launcher')).not.toBeInTheDocument()
  })

  it('answers a suggested question with text, product cards, links and the hand-off', async () => {
    const { sent } = serve()
    renderRoutes(storefrontRoutes, '/product/kids-tee')
    const launcher = await screen.findByRole('button', { name: 'Ask Berry helper, our AI shop assistant' })
    expect(launcher).toHaveClass('sf-assistant-launcher', 'fixed')
    expect(document.documentElement).toHaveAttribute(ASSISTANT_ATTRIBUTE)

    const { user, panel } = await openChat()
    expect(within(panel).getByRole('heading', { name: 'Berry helper' })).toBeInTheDocument()
    expect(within(panel).getByTestId('assistant-notice')).toHaveTextContent('AI assistant — answers can be wrong')
    expect(within(panel).getByText('Hi! Ask me anything about Berry Kids.')).toBeInTheDocument()
    const suggestions = within(panel).getByRole('group', { name: 'Suggested questions' })
    expect(within(suggestions).getAllByRole('button').map((b) => b.textContent)).toEqual(['What is the delivery charge?', 'Which payment methods can I use?', 'What are your return rules?'])

    await user.click(within(suggestions).getByRole('button', { name: 'What is the delivery charge?' }))
    await within(panel).findByText('Outside Dhaka: ৳120')
    expect(sent[0]!.body).toEqual({ message: 'What is the delivery charge?', language: 'en', page: { type: 'product', slug: 'kids-tee' } })

    // The reply: bold, a bullet list, own-store links; the outside link keeps only its label.
    expect(within(panel).getByText('৳60').tagName).toBe('STRONG')
    expect(within(panel).getByRole('link', { name: 'our delivery page' })).toHaveAttribute('href', '/pages/delivery')
    expect(within(panel).getByRole('link', { name: 'Kids Tee' })).toHaveAttribute('href', '/product/kids-tee')
    expect(within(panel).queryByRole('link', { name: 'this' })).not.toBeInTheDocument()
    expect(panel.querySelector('a[href^="https://evil"]')).toBeNull()

    const cards = within(panel).getByTestId('assistant-products')
    const card = within(cards).getByRole('link')
    expect(card).toHaveAttribute('href', '/product/kids-tee')
    expect(card).toHaveTextContent('Kids Tee')
    expect(card).toHaveTextContent('৳450')
    expect(card).toHaveTextContent('In stock')
    const links = within(panel).getByRole('list', { name: 'Helpful pages' })
    expect(within(links).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/pages/delivery'])

    const handoff = within(panel).getByTestId('assistant-handoff')
    expect(handoff).toHaveAttribute('href', `https://wa.me/${NUMBER}?text=Hello%20from%20the%20server`)
    expect(handoff).toHaveAttribute('target', '_blank')
    // The persistent hand-off carries the conversation's first question.
    expect(new URL(within(panel).getByTestId('assistant-talk-to-person').getAttribute('href')!).searchParams.get('text')).toBe(
      'Hello! I asked your shop assistant: What is the delivery charge?',
    )

    expect(screen.getByTestId('assistant-announcer')).toHaveTextContent('Delivery inside Dhaka is ৳60.')
    expect(localStorage.getItem(ASSISTANT_TOKEN_KEY)).toBe(TOKEN)
    // Suggestions only before the first question.
    expect(within(panel).queryByRole('group', { name: 'Suggested questions' })).not.toBeInTheDocument()
  })

  it('sends with Enter, keeps Shift+Enter for a new line, counts characters and sends the token on', async () => {
    const { sent } = serve({ reply: () => ok(turn({ reply: { text: 'Yes.', products: [], links: [], handoff: null } })) })
    renderRoutes(storefrontRoutes, '/')
    const { user, panel } = await openChat()
    const box = within(panel).getByRole('textbox', { name: 'Your question' })
    expect(box).toHaveAttribute('maxlength', '500')

    await user.type(box, 'Do you have{Shift>}{Enter}{/Shift}red tees?')
    expect(box).toHaveValue('Do you have\nred tees?')
    expect(within(panel).getByText('21 of 500 characters')).toBeInTheDocument()
    await user.keyboard('{Enter}')
    await log(panel).findByText('Yes.')
    expect(box).toHaveValue('')
    expect(sent[0]!.body).toEqual({ message: 'Do you have\nred tees?', language: 'en', page: { type: 'other' } })

    await user.type(box, 'And blue?{Enter}')
    await waitFor(() => expect(sent).toHaveLength(2))
    expect(sent[1]!.body.conversation_token).toBe(TOKEN)
  })

  it('reopens the last conversation from the stored token', async () => {
    localStorage.setItem(ASSISTANT_TOKEN_KEY, TOKEN)
    serve({
      current: {
        conversation_token: TOKEN,
        remaining_messages: 3,
        messages: [
          { id: '1', role: 'user', text: 'Do you deliver to Sylhet?', products: [], links: [], handoff: null, status: 'ok', created_at: '2026-11-20T10:00:00Z' },
          { id: '2', role: 'assistant', text: 'Yes, in **3–5 days**.', products: [], links: [], handoff: null, status: 'ok', created_at: '2026-11-20T10:00:02Z' },
        ],
      },
    })
    renderRoutes(storefrontRoutes, '/')
    const { panel } = await openChat()
    expect(await within(panel).findByText('Do you deliver to Sylhet?')).toBeInTheDocument()
    expect(within(panel).getByText('3–5 days').tagName).toBe('STRONG')
    expect(within(panel).getByTestId('assistant-remaining')).toHaveTextContent('3 questions left in this chat')
    expect(within(panel).queryByRole('group', { name: 'Suggested questions' })).not.toBeInTheDocument()
  })

  it('forgets a token the server no longer knows', async () => {
    localStorage.setItem(ASSISTANT_TOKEN_KEY, TOKEN)
    serve()
    renderRoutes(storefrontRoutes, '/')
    const { panel } = await openChat()
    await within(panel).findByRole('group', { name: 'Suggested questions' })
    expect(localStorage.getItem(ASSISTANT_TOKEN_KEY)).toBeNull()
  })

  it('tells the shopper when the chat is full and starts a new one', async () => {
    const { sent } = serve({ reply: () => ok(turn({ status: 'limit', remaining_messages: 0, reply: { text: 'This chat is long enough — please start a new one.', products: [], links: [], handoff: null } })) })
    renderRoutes(storefrontRoutes, '/')
    const { user, panel } = await openChat()
    await user.type(within(panel).getByRole('textbox', { name: 'Your question' }), 'One more?{Enter}')
    await log(panel).findByText('This chat is long enough — please start a new one.')
    const full = within(panel).getByTestId('assistant-full')
    expect(full).toHaveTextContent('This chat is full. Start a new chat to ask more.')
    expect(within(panel).queryByRole('textbox')).not.toBeInTheDocument()

    await user.click(within(full).getByRole('button', { name: 'New chat' }))
    expect(within(panel).getByRole('textbox', { name: 'Your question' })).toBeInTheDocument()
    expect(within(panel).queryByText('One more?')).not.toBeInTheDocument()
    expect(localStorage.getItem(ASSISTANT_TOKEN_KEY)).toBeNull()
    expect(sent).toHaveLength(1)
  })

  it('shows the server’s fallback and its own when the assistant is busy or unreachable', async () => {
    let call = 0
    serve({
      reply: () => {
        call += 1
        if (call === 1) return ok(turn({ conversation_token: null, status: 'unavailable', remaining_messages: 20, reply: { text: 'The assistant is resting. Please contact the store.', products: [], links: [], handoff: { type: 'contact', url: '/pages/contact' } } }))
        return fail(429, 'TOO_MANY_REQUESTS')
      },
    })
    renderRoutes(storefrontRoutes, '/')
    const { user, panel } = await openChat()
    const box = within(panel).getByRole('textbox', { name: 'Your question' })
    await user.type(box, 'Hello{Enter}')
    await log(panel).findByText('The assistant is resting. Please contact the store.')
    expect(within(panel).getByRole('link', { name: 'Contact the store' })).toHaveAttribute('href', '/pages/contact')
    expect(localStorage.getItem(ASSISTANT_TOKEN_KEY)).toBeNull()

    await user.type(box, 'Again{Enter}')
    await log(panel).findByText('Lots of questions at the moment. Please wait a minute and try again.')
    expect(within(panel).getAllByTestId('assistant-handoff').at(-1)).toHaveAttribute('href', expect.stringMatching(new RegExp(`^https://wa\\.me/${NUMBER}\\?text=`)))
  })

  it('works without storage', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    serve({ reply: () => ok(turn({ reply: { text: 'Sure.', products: [], links: [], handoff: null } })) })
    renderRoutes(storefrontRoutes, '/')
    const { user, panel } = await openChat()
    await user.type(within(panel).getByRole('textbox', { name: 'Your question' }), 'Hi{Enter}')
    expect(await log(panel).findByText('Sure.')).toBeInTheDocument()
  })

  it('speaks Bangla and asks in Bangla', async () => {
    const { sent } = serve({ bootstrap: withAssistant({ greeting: null }, bilingualBootstrap()) })
    renderRoutes(storefrontRoutes, '/?lang=bn')
    const { user, panel } = await openChat(userEvent.setup(), 'Berry helper-কে জিজ্ঞেস করুন, আমাদের এআই শপ সহকারী')
    expect(within(panel).getByTestId('assistant-notice')).toHaveTextContent('এআই সহকারী — উত্তর ভুল হতে পারে')
    expect(within(panel).getByText('নমস্কার! আমাদের পণ্য, ডেলিভারি, পেমেন্ট বা রিটার্ন নিয়ে জিজ্ঞেস করুন।')).toBeInTheDocument()
    await user.click(within(panel).getByRole('button', { name: 'রিটার্নের নিয়ম কী?' }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]!.body).toMatchObject({ message: 'রিটার্নের নিয়ম কী?', language: 'bn' })
  })

  it('stacks with the WhatsApp chat button and returns focus on close', async () => {
    serve({ bootstrap: withAssistant({}, { ...bootstrapFixture(), store: { ...bootstrapFixture().store, whatsapp_chat_button: true } }) })
    renderRoutes(storefrontRoutes, '/')
    await screen.findByTestId('whatsapp-chat')
    expect(document.documentElement).toHaveAttribute(CHAT_ATTRIBUTE)
    expect(document.documentElement).toHaveAttribute(ASSISTANT_ATTRIBUTE)

    const { user, panel } = await openChat()
    await user.click(within(panel).getByRole('button', { name: 'Close chat' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await act(async () => {})
    expect(screen.getByTestId('assistant-launcher')).toHaveFocus()
  })
})
