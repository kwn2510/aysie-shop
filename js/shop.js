window.AYSShop = {
  async loadProducts() {
    const config = window.AYSSupabaseConfig;
    if (!config?.url || !config.publishableKey || config.publishableKey === 'PASTE_YOUR_SUPABASE_PUBLISHABLE_KEY_HERE') {
      throw new Error('Add the Supabase publishable key in js/supabase-config.js.');
    }

    const query = new URLSearchParams({
      select: 'id,name,description,price,sale_price,commercial_price,category,design_type,category_label,image_url,gallery,tags,stock,status,sort_order,published_at',
      publication_status: 'eq.published',
      order: 'sort_order.desc,id.asc'
    });
    const response = await fetch(`${config.url}/rest/v1/products?${query}`, {
      headers: { apikey: config.publishableKey }
    });
    if (!response.ok) {
      const details = await response.text();
      throw new Error(`Could not load products from Supabase (${response.status}): ${details}`);
    }

    const rows = await response.json();
    if (!Array.isArray(rows)) throw new Error('Supabase returned an invalid product list.');

    return rows.map(product => ({
      id: Number(product.id),
      name: product.name,
      description: product.description || '',
      price: Number(product.price),
      salePrice: product.sale_price == null ? null : Number(product.sale_price),
      commercialPrice: product.commercial_price == null ? null : Number(product.commercial_price),
      category: product.category,
      designType: product.design_type || undefined,
      categoryLabel: product.category_label,
      image: product.image_url,
      gallery: Array.isArray(product.gallery) ? product.gallery : [],
      tags: Array.isArray(product.tags) ? product.tags : [],
      stock: product.stock == null ? undefined : Number(product.stock),
      status: product.status,
      date: Date.parse(product.published_at || '') || Number(product.sort_order) || 0
    }));
  }
};
