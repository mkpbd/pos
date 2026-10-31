import { useStorefront } from '../api'

/**
 * The store's front page. Homepage sections (sliders, banners, product carousels) are
 * configured in the admin from phase E5; until then the page shows the store itself.
 */
export function HomePage() {
  const { store } = useStorefront()

  return (
    <section className="mx-auto max-w-sf px-4 py-16 text-center lg:py-24">
      <h1 className="text-4xl font-extrabold lg:text-5xl">{store.name}</h1>
      {store.description && <p className="mx-auto mt-4 max-w-2xl text-lg">{store.description}</p>}
    </section>
  )
}
