import { products } from '../../../ui-preview/src/catalog'

// Same product order and labels as the approved UI catalog.
export const PRODUCT_NAVIGATION = products.filter(product => product.id !== 'community').map(product => ({
  id: product.id, label: product.short, path: product.id === 'home' ? '/' : `/${product.id}`,
}))
