import { products } from '../../../ui-preview/src/catalog'
import {
  currentExperimentalProductOptInV1,
  currentProductCatalogChannelV1,
  evaluateProductEntryV1,
  productCatalogIdForNavigationV1,
} from '../../lib/product/product-catalog'

// Same product order and labels as the approved UI catalog.
export const PRODUCT_NAVIGATION = products.filter(product => {
  const productId = productCatalogIdForNavigationV1(product.id)
  return productId === null || evaluateProductEntryV1({
    productId, channel: currentProductCatalogChannelV1(),
    experimentalOptIn: currentExperimentalProductOptInV1(),
  }).visible
}).map(product => ({
  id: product.id, label: product.short, path: product.id === 'home' ? '/' : `/${product.id}`,
}))
