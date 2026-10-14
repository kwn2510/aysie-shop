(() => {
  const config = window.AYSSupabaseConfig;
  const list = document.querySelector('#admin-product-list');
  const message = document.querySelector('#products-message');
  const form = document.querySelector('#product-form');
  const formMessage = document.querySelector('#product-form-message');
  const editorTitle = document.querySelector('#editor-title');
  const submitButtons = [...form.querySelectorAll('button[type="submit"]')];
  const uploadButton = document.querySelector('#upload-product-image');
  const archiveButton = document.querySelector('#archive-product');
  const signoutButton = document.querySelector('#products-signout');
  const imageFile = document.querySelector('#product-image-file');
  const fields = form.elements;
  const categoryLabels = {
    oc: 'OCs & Characters',
    base: 'Bases & Templates',
    outfit: 'Outfits & Fashion',
    design: 'Design Assets',
    elements: 'Elements'
  };
  let client;
  let products = [];
  let busy = false;

  function showMessage(text, isError = false) {
    message.textContent = text;
    message.classList.toggle('is-error', isError);
  }

  function showFormMessage(text, isError = false) {
    formMessage.textContent = text;
    formMessage.classList.toggle('is-error', isError);
  }

  function setBusy(value) {
    busy = value;
    [...submitButtons, uploadButton, archiveButton, signoutButton].forEach(button => {
      if (button) button.disabled = value;
    });
  }

  function createCell(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = text;
    return element;
  }

  function renderList() {
    list.replaceChildren();
    if (!products.length) {
      list.append(createCell('p', 'admin-empty', 'Chưa có sản phẩm nào.'));
      return;
    }

    products.forEach(product => {
      const row = document.createElement('article');
      row.className = 'admin-product-row';

      const image = document.createElement('img');
      image.src = product.image_url;
      image.alt = '';
      image.loading = 'lazy';
      row.append(image);

      const details = document.createElement('div');
      details.className = 'admin-product-details';
      details.append(
        createCell('strong', '', product.name),
        createCell('span', '', `${categoryLabels[product.category] || product.category_label} · ${new Intl.NumberFormat('vi-VN').format(product.price)} ₫`),
        createCell('span', `admin-status admin-status-${product.publication_status}`, product.publication_status)
      );
      row.append(details);

      const editButton = createCell('button', 'admin-signout', 'Sửa');
      editButton.type = 'button';
      editButton.addEventListener('click', () => editProduct(product));
      row.append(editButton);
      list.append(row);
    });
  }

  function resetEditor() {
    form.reset();
    showFormMessage('');
    fields.id.value = '';
    delete fields.slug.dataset.edited;
    fields.status.value = 'available';
    fields.sort_order.value = '0';
    editorTitle.textContent = 'Thêm sản phẩm';
    archiveButton.hidden = true;
    imageFile.value = '';
  }

  function editProduct(product) {
    fields.id.value = String(product.id);
    fields.name.value = product.name;
    fields.slug.value = product.slug;
    fields.description.value = product.description || '';
    fields.price.value = String(product.price);
    fields.sale_price.value = product.sale_price ?? '';
    fields.commercial_price.value = product.commercial_price ?? '';
    fields.stock.value = product.stock ?? '';
    fields.category.value = product.category;
    fields.design_type.value = product.design_type || '';
    fields.status.value = product.status;
    fields.sort_order.value = String(product.sort_order ?? 0);
    fields.image_url.value = product.image_url || '';
    fields.gallery.value = (product.gallery || []).join('\n');
    fields.tags.value = (product.tags || []).join(', ');
    fields.product_url.value = product.product_url || '';
    editorTitle.textContent = `Sửa: ${product.name}`;
    archiveButton.hidden = product.publication_status === 'archived';
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function numericField(name, required = false) {
    const value = fields[name].value.trim();
    if (!value && !required) return null;
    if (!value) {
      throw new Error(`Hãy nhập trường “${fields[name].closest('label').firstChild.textContent.trim()}”.`);
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
      throw new Error(`Trường “${fields[name].closest('label').firstChild.textContent.trim()}” cần là số nguyên không âm.`);
    }
    return parsed;
  }

  function requireHttpsUrl(value, label) {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`${label} cần là URL hợp lệ.`);
    }
    if (url.protocol !== 'https:') throw new Error(`${label} cần dùng HTTPS.`);
    return url.href;
  }

  function readProduct(publicationStatus) {
    const name = fields.name.value.trim();
    const slug = fields.slug.value.trim().toLowerCase();
    const category = fields.category.value;
    const imageUrl = fields.image_url.value.trim();
    if (name.length < 2 || slug.length < 2) throw new Error('Tên sản phẩm và slug cần có ít nhất 2 ký tự.');
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      throw new Error('Slug chỉ gồm chữ thường không dấu, số và dấu gạch nối.');
    }
    if (!imageUrl) throw new Error('Hãy nhập hoặc tải ảnh chính lên trước khi lưu sản phẩm.');
    requireHttpsUrl(imageUrl, 'Ảnh chính');
    const stock = numericField('stock');
    if (category !== 'design' && stock === null) {
      throw new Error('Nhập tồn kho cho sản phẩm OC, base, outfit hoặc elements.');
    }
    const price = numericField('price', true);
    const salePrice = numericField('sale_price');
    if (salePrice !== null && salePrice >= price) {
      throw new Error('Giá sale phải thấp hơn giá cá nhân.');
    }

    const gallery = fields.gallery.value.split(/\r?\n/).map(url => url.trim()).filter(Boolean)
      .map(url => requireHttpsUrl(url, 'Ảnh gallery'));
    if (!gallery.includes(imageUrl)) gallery.unshift(imageUrl);
    const productUrl = fields.product_url.value.trim();

    return {
      name,
      slug,
      description: fields.description.value.trim(),
      price,
      sale_price: salePrice,
      commercial_price: numericField('commercial_price'),
      category,
      design_type: category === 'design' ? (fields.design_type.value.trim() || null) : null,
      category_label: categoryLabels[category],
      image_url: imageUrl,
      gallery,
      tags: fields.tags.value.split(',').map(tag => tag.trim()).filter(Boolean),
      product_url: productUrl ? requireHttpsUrl(productUrl, 'Link sản phẩm') : null,
      stock,
      status: category !== 'design' ? (stock > 0 ? 'available' : 'sold') : fields.status.value,
      publication_status: publicationStatus,
      sort_order: numericField('sort_order') ?? 0
    };
  }

  async function loadProducts() {
    const { data, error } = await client
      .from('products')
      .select('*')
      .order('sort_order', { ascending: false })
      .order('id', { ascending: true });
    if (error) throw error;
    products = data;
    renderList();
    showMessage(`${products.length} sản phẩm`);
  }

  async function saveProduct(publicationStatus) {
    if (busy) return;
    let productData;
    try {
      productData = readProduct(publicationStatus);
    } catch (error) {
      showFormMessage(error.message, true);
      return;
    }

    setBusy(true);
    showFormMessage(publicationStatus === 'published' ? 'Đang xuất bản…' : 'Đang lưu nháp…');
    try {
      const id = fields.id.value;
      if (id) {
        const { error } = await client.from('products').update(productData).eq('id', id);
        if (error) throw error;
      } else if (publicationStatus === 'published') {
        const { data, error } = await client
          .from('products')
          .insert({ ...productData, publication_status: 'draft' })
          .select('id')
          .single();
        if (error) throw error;

        fields.id.value = String(data.id);
        const { error: publishError } = await client
          .from('products')
          .update({ publication_status: 'published', published_at: new Date().toISOString() })
          .eq('id', data.id);
        if (publishError) throw publishError;
      } else {
        const { data, error } = await client.from('products').insert(productData).select('id').single();
        if (error) throw error;
        fields.id.value = String(data.id);
      }

      await loadProducts();
      resetEditor();
      showFormMessage(publicationStatus === 'published'
        ? 'Đã xuất bản sản phẩm. Tự động gửi email sẽ được bật ở phase notification.'
        : 'Đã lưu nháp.');
    } catch (error) {
      console.error('Could not save the product:', error);
      showFormMessage(`Không lưu được sản phẩm: ${error.message}`, true);
    } finally {
      setBusy(false);
    }
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    const action = event.submitter?.value || 'draft';
    saveProduct(action === 'published' ? 'published' : 'draft');
  });

  fields.name.addEventListener('input', () => {
    if (fields.id.value || fields.slug.dataset.edited === 'true') return;
    fields.slug.value = fields.name.value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/đ/g, 'd')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  });
  fields.slug.addEventListener('input', () => { fields.slug.dataset.edited = 'true'; });

  document.querySelector('#new-product').addEventListener('click', () => {
    resetEditor();
    editorTitle.textContent = 'Thêm sản phẩm';
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  uploadButton.addEventListener('click', async () => {
    if (busy) return;
    const file = imageFile.files[0];
    if (!file) {
      showMessage('Chọn một ảnh trước khi tải lên.', true);
      return;
    }
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      showMessage('Chỉ hỗ trợ ảnh JPEG, PNG, WebP hoặc GIF tối đa 5 MB.', true);
      return;
    }

    const safeName = file.name.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-');
    const objectPath = `products/${Date.now()}-${safeName}`;
    setBusy(true);
    showFormMessage('Đang tải ảnh lên…');
    try {
      const { error } = await client.storage.from('product-images').upload(objectPath, file, {
        contentType: file.type,
        upsert: false
      });
      if (error) throw error;
      const { data } = client.storage.from('product-images').getPublicUrl(objectPath);
      fields.image_url.value = data.publicUrl;
      const gallery = fields.gallery.value.split(/\r?\n/).map(url => url.trim()).filter(Boolean);
      if (!gallery.includes(data.publicUrl)) gallery.unshift(data.publicUrl);
      fields.gallery.value = gallery.join('\n');
      showFormMessage('Đã tải ảnh lên và điền URL vào sản phẩm.');
    } catch (error) {
      console.error('Could not upload product image:', error);
      showFormMessage(`Không tải được ảnh: ${error.message}`, true);
    } finally {
      setBusy(false);
    }
  });

  archiveButton.addEventListener('click', async () => {
    if (busy || !fields.id.value) return;
    if (!window.confirm('Lưu trữ sản phẩm này? Sản phẩm sẽ ẩn khỏi cửa hàng nhưng dữ liệu vẫn được giữ.')) return;

    setBusy(true);
    try {
      const { error } = await client
        .from('products')
        .update({ publication_status: 'archived' })
        .eq('id', fields.id.value);
      if (error) throw error;
      await loadProducts();
      resetEditor();
      showMessage('Đã lưu trữ sản phẩm.');
    } catch (error) {
      console.error('Could not archive the product:', error);
      showMessage(`Không lưu trữ được sản phẩm: ${error.message}`, true);
    } finally {
      setBusy(false);
    }
  });

  signoutButton.addEventListener('click', async () => {
    if (busy) return;
    setBusy(true);
    const { error } = await client.auth.signOut();
    if (error) {
      setBusy(false);
      showMessage(`Không đăng xuất được: ${error.message}`, true);
      return;
    }
    window.location.href = './index.html';
  });

  async function initialize() {
    if (!config?.url || !config.publishableKey || config.publishableKey === 'PASTE_YOUR_SUPABASE_PUBLISHABLE_KEY_HERE') {
      throw new Error('Supabase chưa được cấu hình.');
    }
    if (!window.supabase?.createClient) throw new Error('Không tải được Supabase Auth.');

    client = window.supabase.createClient(config.url, config.publishableKey);
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    if (!data.session) {
      window.location.replace('./index.html');
      return;
    }

    const { data: isAdmin, error: adminError } = await client.rpc('is_current_user_admin');
    if (adminError) throw adminError;
    if (!isAdmin) {
      await client.auth.signOut();
      throw new Error('Tài khoản hiện tại chưa được cấp quyền quản trị.');
    }

    await loadProducts();
  }

  initialize().catch(error => {
    console.error('Could not initialize product management:', error);
    showMessage(`Không mở được quản lý sản phẩm: ${error.message}`, true);
  });
})();
