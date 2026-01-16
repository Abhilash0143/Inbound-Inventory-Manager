import skuData from '../data/sku.json'

const validSkuSet = new Set(
  skuData.skus.map(sku => sku.trim().toUpperCase())
)

export const isValidSku = (sku: string): boolean => {
  return validSkuSet.has(sku.trim().toUpperCase())
}
