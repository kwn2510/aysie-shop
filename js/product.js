window.AYSProduct = {
  getPersonalPrice(product) {
    return Number.isFinite(product.salePrice) && product.salePrice < product.price ? product.salePrice : product.price;
  },
  getGallery(product) {
    return product.gallery && product.gallery.length ? product.gallery : [product.image];
  }
};
