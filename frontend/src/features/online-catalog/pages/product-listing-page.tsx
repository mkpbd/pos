import { Link, useParams } from 'react-router'
import { ArrowLeftIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useProductListingQuery } from '@/features/online-catalog/api'
import { OnlineListingSection } from '@/features/online-catalog/components/online-listing-section'

/**
 * The web listing of one product on its own page, for online store staff who may not edit
 * the product itself (product editors find the same section at the end of the product editor).
 */
export function ProductListingPage() {
  const { productId = '' } = useParams()
  const query = useProductListingQuery(productId)

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="icon" aria-label="Back to products">
          <Link to="/products"><ArrowLeftIcon /></Link>
        </Button>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">{query.data?.product.name ?? 'Online listing'}</h1>
      </div>
      <OnlineListingSection productId={productId} />
    </div>
  )
}
