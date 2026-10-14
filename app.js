const paymentInfo = {
  bankName: 'BIDV',
  accountName: 'NGUYEN THUY LINH',
  accountNumber: '0123456789',
  transferContent: 'Tên + Gmail của bạn'
};

let products = [];
let approvedReviews = [];
let showAllReviews = false;
let customerUser = null;
let customerClient = null;
let orderNotifications = [];
let voucherNotifications = [];
let announcementReadIds = new Set();
let notificationRefreshPending = false;
let notificationRequestId = 0;
function readStoredArray(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

let cart = [];
let wishlist = [];
const productsPerPage = 8;
let currentProductPage = 1;
let activeProduct = null;
let modalTrigger = null;
let appliedVoucher = null;
const accountButton = document.querySelector('#customer-account-button');
const notificationButton = document.querySelector('#header-notifications-toggle');
const notificationPopover = document.querySelector('#header-notification-popover');
const grid = document.querySelector('#product-grid');
const productCount = document.querySelector('#product-count');
const currency = value => new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND',
  maximumFractionDigits: 0
}).format(value);
const personalPrice = product => window.AYSProduct.getPersonalPrice(product);
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
})[character]);

function customerStorageKey(key) {
  return customerUser ? `${key}:${customerUser.id}` : null;
}

function canUseCustomerFeatures() {
  return Boolean(customerUser);
}

function requireCustomerAccount() {
  if (canUseCustomerFeatures()) return true;
  const returnTo = `${location.pathname.split('/').pop() || 'index.html'}${location.hash || '#shop'}`;
  location.href = `account.html?next=${encodeURIComponent(returnTo)}`;
  return false;
}

function setCustomerSession(user) {
  const previousUserId = customerUser?.id || null;
  customerUser = user?.email ? user : null;
  if (!customerUser || customerUser.id !== previousUserId) {
    notificationRequestId += 1;
    notificationRefreshPending = false;
    cart = customerUser ? readStoredArray(`mori-cart:${customerUser.id}`)
      .map(item => typeof item === 'number' ? { id: item, license: 'personal' } : item)
      .filter(item => item && Number.isInteger(Number(item.id)))
      .map(item => ({ id: Number(item.id), license: item.license === 'commercial' ? 'commercial' : 'personal' })) : [];
    wishlist = customerUser ? readStoredArray(`ays-wishlist:${customerUser.id}`).map(Number).filter(Number.isFinite) : [];
    if (notificationPopover) closeHeaderNotifications();
    orderNotifications = [];
    voucherNotifications = [];
    announcementReadIds = new Set(customerUser
      ? readStoredArray(`ays-notification-reads:${customerUser.id}`).map(String)
      : []);
  }
  if (accountButton) {
    accountButton.innerHTML = customerUser
      ? '<i class="fa-solid fa-user" aria-hidden="true"></i>'
      : '<span class="account-label-full">Đăng nhập / Đăng ký</span><span class="account-label-compact">Đăng nhập</span>';
    accountButton.href = customerUser ? 'account.html' : 'account.html?next=index.html%23shop';
    accountButton.setAttribute('aria-label', customerUser ? 'Mở tài khoản My AYS' : 'Đăng nhập hoặc đăng ký My AYS');
    accountButton.title = customerUser ? 'Tài khoản My AYS' : 'Đăng nhập / Đăng ký';
    accountButton.classList.toggle('is-signed-in', Boolean(customerUser));
  }
  if (notificationButton) notificationButton.hidden = !customerUser;
  updateCartCount();
  updateWishlistCount();
  if (products.length) renderProducts();
  if (customerUser) window.setTimeout(refreshHeaderNotifications, 0);
  const url = new URL(window.location.href);
  if (customerUser && url.searchParams.get('notifications') === '1' && notificationPopover && notificationButton) {
    url.searchParams.delete('notifications');
    window.history.replaceState(null, '', `${url.pathname}${url.hash}`);
    notificationPopover.hidden = false;
    notificationButton.setAttribute('aria-expanded', 'true');
    window.setTimeout(refreshHeaderNotifications, 0);
  }
}

function closeHeaderNotifications() {
  if (!notificationPopover || !notificationButton) return;
  notificationPopover.hidden = true;
  notificationButton.setAttribute('aria-expanded', 'false');
}

function getProductAnnouncements() {
  const recentCutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const recentProducts = [...products]
    .filter(product => product.date >= recentCutoff)
    .sort((left, right) => right.date - left.date)
    .slice(0, 4)
    .map(product => ({
      id: `new:${product.id}`,
      title: 'Mầm mới vừa trổ bông',
      message: `${product.name} vừa có mặt trong khu vườn.`,
      created_at: new Date(product.date).toISOString(),
      link: '#shop',
      productId: product.id,
      kind: 'announcement'
    }));
  const saleProducts = products
    .filter(product => product.status !== 'sold' && Number.isFinite(product.salePrice) && product.salePrice < product.price)
    .slice(0, 5)
    .map(product => ({
      id: `sale:${product.id}`,
      title: 'Mầm đang có giá tốt',
      message: `${product.name} đang giảm còn ${currency(product.salePrice)}.`,
      created_at: new Date().toISOString(),
      link: '#shop',
      productId: product.id,
      kind: 'announcement'
    }));
  return [...recentProducts, ...saleProducts];
}

async function refreshHeaderNotifications() {
  if (!customerUser || !customerClient || notificationRefreshPending) return;
  const requestId = ++notificationRequestId;
  const requestedUserId = customerUser.id;
  notificationRefreshPending = true;
  const status = document.querySelector('#header-notification-status');
  status.classList.remove('is-error');
  status.textContent = 'Đang tải thông báo…';
  try {
    const [ordersResult, vouchersResult] = await Promise.all([
      customerClient.from('customer_notifications')
        .select('id,title,message,created_at,read_at')
        .order('created_at', { ascending: false })
        .limit(30),
      customerClient.from('customer_vouchers')
        .select('code,discount_percent,status,created_at,expires_at')
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(10)
    ]);
    if (requestId !== notificationRequestId || customerUser?.id !== requestedUserId) return;
    if (ordersResult.error) throw ordersResult.error;
    if (vouchersResult.error) throw vouchersResult.error;
    orderNotifications = ordersResult.data || [];
    voucherNotifications = (vouchersResult.data || [])
      .filter(voucher => Date.parse(voucher.expires_at) > Date.now())
      .map(voucher => ({
        id: `voucher:${voucher.code}`,
        title: 'Bạn có voucher mới',
        message: `${voucher.code} giảm ${voucher.discount_percent}%, hạn đến ${new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium' }).format(new Date(voucher.expires_at))}.`,
        created_at: voucher.created_at,
        link: 'account.html#vouchers-heading',
        kind: 'announcement'
      }));
    renderHeaderNotifications(voucherNotifications);
    status.textContent = 'Thông báo mới về sản phẩm, ưu đãi, voucher và đơn hàng.';
  } catch (error) {
    if (requestId !== notificationRequestId || customerUser?.id !== requestedUserId) return;
    console.error('Could not load header notifications:', error);
    renderHeaderNotifications([]);
    status.textContent = `Không tải được thông báo: ${error.message}`;
    status.classList.add('is-error');
  } finally {
    if (requestId === notificationRequestId) notificationRefreshPending = false;
  }
}

function renderHeaderNotifications(voucherNotifications) {
  const list = document.querySelector('#header-notification-list');
  const merged = [
    ...getProductAnnouncements(),
    ...voucherNotifications,
    ...orderNotifications.map(notification => ({
      ...notification,
      id: `order:${notification.id}`,
      kind: 'order'
    }))
  ].sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at));
  const unreadCount = merged.filter(notification =>
    notification.kind === 'order'
      ? !notification.read_at
      : !announcementReadIds.has(notification.id)
  ).length;
  document.querySelector('#header-notification-count').textContent = String(unreadCount);
  document.querySelector('#header-notification-count').hidden = unreadCount === 0;
  list.replaceChildren();
  if (!merged.length) {
    list.append(Object.assign(document.createElement('p'), {
      className: 'header-notification-empty',
      textContent: 'Chưa có thông báo mới.'
    }));
    return;
  }

  merged.slice(0, 20).forEach(notification => {
    const unread = notification.kind === 'order'
      ? !notification.read_at
      : !announcementReadIds.has(notification.id);
    const item = document.createElement('article');
    item.className = `header-notification-item${unread ? ' is-unread' : ''}`;
    const content = document.createElement(notification.link ? 'a' : 'div');
    content.className = 'header-notification-content';
    if (notification.link) content.href = notification.link;
    const title = document.createElement('strong');
    title.textContent = notification.title;
    const message = document.createElement('span');
    message.textContent = notification.message;
    const time = document.createElement('time');
    time.dateTime = notification.created_at;
    time.textContent = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium' }).format(new Date(notification.created_at));
    content.append(title, message, time);
    const readButton = document.createElement('button');
    readButton.type = 'button';
    readButton.className = 'header-notification-read';
    readButton.textContent = unread ? 'Đã đọc' : 'Đã xem';
    readButton.disabled = !unread;
    readButton.addEventListener('click', () => markHeaderNotificationRead(notification));
    if (notification.link) content.addEventListener('click', event => {
      if (notification.productId) {
        event.preventDefault();
        closeHeaderNotifications();
        openProduct(notification.productId);
      }
      markHeaderNotificationRead(notification);
    });
    item.append(content, readButton);
    list.append(item);
  });
}

async function markHeaderNotificationRead(notification) {
  try {
    if (notification.kind === 'order') {
      const { error } = await customerClient.from('customer_notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', notification.id.replace('order:', ''));
      if (error) throw error;
    } else {
      announcementReadIds.add(notification.id);
      const storageKey = customerStorageKey('ays-notification-reads');
      localStorage.setItem(storageKey, JSON.stringify([...announcementReadIds]));
    }
    await refreshHeaderNotifications();
  } catch (error) {
    console.error('Could not mark a header notification as read:', error);
    const status = document.querySelector('#header-notification-status');
    status.textContent = `Không cập nhật được thông báo: ${error.message}`;
    status.classList.add('is-error');
  }
}

function renderPaymentInfo() {
  if (!document.querySelector('#bank-qr')) return;
  document.querySelector('#bank-name').textContent = paymentInfo.bankName;
  document.querySelector('#account-name').textContent = paymentInfo.accountName;
  document.querySelector('#account-number').textContent = paymentInfo.accountNumber;
  document.querySelector('#transfer-content').textContent = paymentInfo.transferContent;
  document.querySelector('#bank-qr').src = './media/qr.jpg';
}

function updateFilterCounts() {
  document.querySelectorAll('[data-filter-count]').forEach(counter => {
    const [property, value] = counter.dataset.filterCount.split(':');
    const total = products.filter(product => String(product[property]) === value).length;
    counter.textContent = String(total).padStart(2, '0');
  });
}

function renderProducts() {
  const categories = [...document.querySelectorAll('.category-filter:checked')].map(input => input.value);
  const designTypes = [...document.querySelectorAll('.design-type-filter:checked')].map(input => input.value);
  const prices = document.querySelector('.price-filter:checked')?.value;
  const statuses = [...document.querySelectorAll('.status-filter:checked')].map(input => input.value);
  const sort = document.querySelector('#sort-products').value;
  let filtered = products.filter(product => {
    const categoryMatch = !categories.length || categories.includes(product.category);
    const designTypeMatch = !designTypes.length || (product.category === 'design' && designTypes.includes(product.designType));
    const price = personalPrice(product);
    const priceMatch = !prices || (prices === 'under20' && price < 20000) || (prices === '20to40' && price >= 20000 && price <= 100000) || (prices === 'over40' && price > 100000);
    const statusMatch = !statuses.length || statuses.includes(product.status);
    return categoryMatch && designTypeMatch && priceMatch && statusMatch;
  });
  if (sort === 'newest') filtered.sort((a, b) => b.date - a.date);
  if (sort === 'low') filtered.sort((a, b) => personalPrice(a) - personalPrice(b));
  if (sort === 'high') filtered.sort((a, b) => personalPrice(b) - personalPrice(a));
  const totalPages = Math.max(1, Math.ceil(filtered.length / productsPerPage));
  currentProductPage = Math.min(currentProductPage, totalPages);
  const pageStart = (currentProductPage - 1) * productsPerPage;
  productCount.textContent = `${String(filtered.length).padStart(2, '0')} mầm`;
  grid.innerHTML = filtered.length ? filtered.slice(pageStart, pageStart + productsPerPage).map(productCard).join('') : '<p class="empty-cart">Không có mầm phù hợp với bộ lọc này.</p>';
  renderPagination(totalPages);
  bindProductCards(grid);
  renderFeaturedProducts();
}

function bindProductCards(container) {
  container.querySelectorAll('.product-card').forEach(card => card.addEventListener('click', () => openProduct(Number(card.dataset.id))));
  container.querySelectorAll('.product-card').forEach(card => card.addEventListener('keydown', event => {
    if (event.target !== card || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    openProduct(Number(card.dataset.id));
  }));
  container.querySelectorAll('[data-add-to-cart]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    const product = products.find(item => item.id === Number(button.dataset.addToCart));
    if (Number.isFinite(product.commercialPrice)) return openProduct(product.id);
    addToCart(product);
    button.textContent = product.status === 'sold' ? 'Hết hàng' : 'Đã thêm vào giỏ';
    if (product.status !== 'sold') setTimeout(() => { button.textContent = 'hái vào giỏ'; }, 1200);
  }));
  container.querySelectorAll('[data-wishlist]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    if (!requireCustomerAccount()) return;
    const id = Number(button.dataset.wishlist);
    wishlist = wishlist.includes(id) ? wishlist.filter(item => item !== id) : [...wishlist, id];
    saveWishlist();
    updateWishlistCount();
    if (document.querySelector('#wishlist-modal').classList.contains('is-open')) renderWishlist();
    button.classList.toggle('is-loved', wishlist.includes(id));
    button.textContent = wishlist.includes(id) ? '♥' : '♡';
    button.setAttribute('aria-label', wishlist.includes(id) ? 'Bỏ khỏi mầm yêu thích' : 'Thêm vào mầm yêu thích');
  }));
}

function renderPagination(totalPages) {
  const pagination = document.querySelector('#product-pagination');
  pagination.innerHTML = Array.from({ length: totalPages }, (_, index) => `<button type="button" class="page-button ${index + 1 === currentProductPage ? 'is-active' : ''}" data-page="${index + 1}">${index + 1}</button>`).join('');
  pagination.querySelectorAll('[data-page]').forEach(button => button.addEventListener('click', () => {
    currentProductPage = Number(button.dataset.page);
    renderProducts();
    document.querySelector('#shop').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
}

function renderFeaturedProducts() {
  const newest = [...products].sort((a, b) => b.date - a.date).slice(0, 4);
  const sale = products.filter(product => Number.isFinite(product.salePrice) && product.salePrice < product.price);
  const newestGrid = document.querySelector('#newest-products');
  const saleGrid = document.querySelector('#sale-products');
  newestGrid.innerHTML = newest.map(productCard).join('');
  saleGrid.innerHTML = sale.length
    ? sale.map(productCard).join('')
    : '<p class="empty-cart">Hiện chưa có mầm nào đang ưu đãi.</p>';
  bindProductCards(newestGrid);
  bindProductCards(saleGrid);
  updateSaleCarouselControls();
}

function updateSaleCarouselControls() {
  const viewport = document.querySelector('#sale-carousel-viewport');
  const hasOverflow = viewport.scrollWidth > viewport.clientWidth + 1;
  document.querySelectorAll('[data-sale-direction]').forEach(button => {
    button.hidden = !hasOverflow;
  });
}

function productCard(product) {
  const isSold = product.status === 'sold';
  const hasCommercial = Number.isFinite(product.commercialPrice);
  const isLoved = wishlist.includes(product.id);
  const currentPrice = personalPrice(product);
  const hasSale = currentPrice < product.price;
  const priceMarkup = hasSale ? `<strong class="sale-price">${currency(currentPrice)}</strong><span class="original-price">${currency(product.price)}</span>` : currency(currentPrice);
  const name = escapeHtml(product.name);
  const image = escapeHtml(product.image);
  const categoryLabel = escapeHtml(product.categoryLabel);
  return `<article class="product-card" data-id="${product.id}" tabindex="0" aria-label="${name}, ${currency(currentPrice)}. Xem chi tiết">
  <div class="product-image"><img src="${image}" alt="${name}" loading="lazy">
  <span class="product-badge">${isSold ? 'Hết hàng' : categoryLabel}</span>
  <button class="card-wish ${isLoved ? 'is-loved' : ''}" data-wishlist="${product.id}" aria-label="${isLoved ? 'Bỏ khỏi mầm yêu thích' : 'Thêm vào mầm yêu thích'}">${isLoved ? '♥' : '♡'}</button>
  </div>
  <div class="product-meta"><div><h3>${name}</h3><p class="product-category">${categoryLabel}</p></div><p class="${hasSale ? 'sale-price-group' : ''}">${priceMarkup}</p></div><button class="product-add ${isSold ? 'is-sold' : ''}" data-add-to-cart="${product.id}" ${isSold ? 'disabled' : ''}>${isSold ? 'Hết hàng' : hasCommercial ? 'mục đích tưới mầm' : 'Hái vào giỏ'}</button></article>`;
}

function renderSearchResults(query = '') {
  const normalizedQuery = query.trim().toLowerCase();
  const matches = products.filter(product => {
    const searchableText = [product.name, product.categoryLabel, ...(product.tags || [])].join(' ').toLowerCase();
    return !normalizedQuery || searchableText.includes(normalizedQuery);
  }).slice(0, 6);
  const results = document.querySelector('#search-results');
  results.innerHTML = matches.length ? matches.map(product => `<button class="search-result" data-search-product="${product.id}"><img src="${escapeHtml(product.image)}" alt=""><span><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.categoryLabel)} · ${currency(personalPrice(product))}</small></span><b>↗</b></button>`).join('') : '<p class="search-empty">Không tìm thấy sản phẩm phù hợp.</p>';
  results.querySelectorAll('[data-search-product]').forEach(result => result.addEventListener('click', () => { openProduct(Number(result.dataset.searchProduct)); closeSearch(); }));
}

function renderWishlist() {
  if (!canUseCustomerFeatures()) return;
  const items = wishlist.map(id => products.find(product => product.id === id)).filter(Boolean);
  const wishlistItems = document.querySelector('#wishlist-items');
  wishlistItems.innerHTML = items.length ? items.map(product => `<div class="wishlist-item"><img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}"><div><h3>${escapeHtml(product.name)}</h3><p>${currency(personalPrice(product))}</p></div><button class="wishlist-add ${product.status === 'sold' ? 'is-sold' : ''}" data-wishlist-add="${product.id}" ${product.status === 'sold' ? 'disabled' : ''}>${product.status === 'sold' ? 'Hết hàng' : Number.isFinite(product.commercialPrice) ? 'Chọn quyền' : 'Hái vào giỏ'}</button><button class="remove-wishlist" data-remove-wishlist="${product.id}" aria-label="Bỏ ${escapeHtml(product.name)} khỏi yêu thích">×</button></div>`).join('') : '<div class="empty-cart">Chưa có mầm yêu thích.</div>';
  wishlistItems.querySelectorAll('[data-wishlist-add]').forEach(button => button.addEventListener('click', () => {
    if (!requireCustomerAccount()) return;
    const product = items.find(item => item.id === Number(button.dataset.wishlistAdd));
    if (!product || product.status === 'sold') return;
    if (Number.isFinite(product.commercialPrice)) {
      closeModal(document.querySelector('#wishlist-modal'), false);
      openProduct(product.id);
      return;
    }
    addToCart(product);
    button.textContent = 'Đã thêm vào giỏ';
    button.classList.add('is-added');
    window.setTimeout(() => {
      if (!button.isConnected) return;
      button.textContent = 'Hái vào giỏ';
      button.classList.remove('is-added');
    }, 1400);
  }));
  wishlistItems.querySelectorAll('[data-remove-wishlist]').forEach(button => button.addEventListener('click', () => {
    if (!requireCustomerAccount()) return;
    wishlist = wishlist.filter(id => id !== Number(button.dataset.removeWishlist));
    saveWishlist();
    updateWishlistCount();
    renderWishlist();
    renderProducts();
  }));
}

function closeSearch() {
  const popover = document.querySelector('#search-popover');
  popover.classList.remove('is-open');
  popover.setAttribute('aria-hidden', 'true');
  document.querySelector('.search-toggle').setAttribute('aria-expanded', 'false');
}

function renderProductTags(product) {
  const tags = [...product.tags];
  if (Number.isFinite(product.commercialPrice) && !tags.includes('Commercial Use')) tags.push('Commercial Use');
  return tags.map(tag => `<span>${escapeHtml(tag)}</span>`).join('');
}

function openModal(id) {
  const modal = document.querySelector(`#${id}`);
  if (!document.querySelector('.modal-backdrop.is-open') && !modalTrigger) modalTrigger = document.activeElement;
  modal.classList.add('is-open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  modal.querySelector('.close-modal')?.focus();
}
function closeModal(modal, restoreFocus = true) {
  modal.classList.remove('is-open');
  modal.setAttribute('aria-hidden', 'true');
  if (!document.querySelector('.modal-backdrop.is-open')) {
    document.body.style.overflow = '';
    if (restoreFocus) {
      modalTrigger?.focus();
      modalTrigger = null;
    }
  }
}
function openProduct(id) {
  activeProduct = products.find(product => product.id === id);
  if (!activeProduct) return;
  document.querySelector('#modal-preview').style.backgroundImage = `url("${activeProduct.image}")`;
  renderProductGallery(activeProduct);
  document.querySelector('#modal-category').textContent = activeProduct.categoryLabel;
  document.querySelector('#modal-name').textContent = activeProduct.name;
  const description = activeProduct.description || '';
  document.querySelector('#modal-description').textContent = description;
  document.querySelector('#product-description').hidden = !description;
  renderLicenseOptions(activeProduct);
  document.querySelector('#modal-tags').innerHTML = renderProductTags(activeProduct);
  const modalStock = document.querySelector('#modal-stock');
  modalStock.hidden = activeProduct.category === 'design';
  modalStock.textContent = activeProduct.status === 'sold' ? 'Hết hàng' : `Còn ${activeProduct.stock} sản phẩm`;
  document.querySelector('#modal-add').disabled = activeProduct.status === 'sold';
  document.querySelector('#modal-add').innerHTML = activeProduct.status === 'sold' ? 'Hết hàng' : 'Hái vào giỏ <span>＋</span>';
  openModal('product-modal');
}

function setReviewMessage(text, isError = false) {
  const message = document.querySelector('#review-message');
  message.textContent = text;
  message.classList.toggle('is-error', isError);
}

function renderProductReviews(reviews) {
  approvedReviews = reviews;
  renderFilteredReviews();
}

function renderFilteredReviews() {
  const list = document.querySelector('#review-list');
  const filter = document.querySelector('#review-rating-filter').value;
  const filtered = approvedReviews.filter(review => filter === 'all' || Number(review.rating) === Number(filter));
  list.replaceChildren();

  if (!filtered.length) {
    list.append(Object.assign(document.createElement('p'), {
      className: 'review-empty',
      textContent: approvedReviews.length
        ? 'Chưa có bình luận nào với số sao này.'
        : 'Chưa có lời nhắn nào — hãy gửi lời đầu tiên nha!'
    }));
    updateReviewControls(filtered.length);
    return;
  }

  filtered.forEach(review => {
    const article = document.createElement('article');
    article.className = 'review-card';
    const icon = document.createElement('span');
    icon.className = 'review-card-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '♡';
    const content = document.createElement('div');
    content.className = 'review-card-content';
    const author = document.createElement('strong');
    author.className = 'review-card-title';
    author.textContent = review.display_name;
    const stars = document.createElement('span');
    stars.className = 'review-stars';
    stars.setAttribute('aria-label', `${review.rating} trên 5 sao`);
    stars.textContent = '★'.repeat(review.rating);
    const comment = document.createElement('p');
    comment.className = 'review-card-comment';
    comment.textContent = review.comment;
    content.append(author, stars, comment);
    article.append(icon, content);
    list.append(article);
  });
  updateReviewControls(filtered.length);
}

function updateReviewControls(count) {
  const list = document.querySelector('#review-list');
  const showAllButton = document.querySelector('#show-all-reviews');
  const actions = document.querySelector('.review-list-actions');
  const arrows = document.querySelectorAll('.review-carousel-arrow');
  document.querySelector('#review-count').textContent = count
    ? `${count} bình luận${document.querySelector('#review-rating-filter').value === 'all' ? '' : ' phù hợp'}`
    : '0 bình luận';
  showAllButton.hidden = count <= 5;
  showAllButton.textContent = showAllReviews ? 'Thu gọn bình luận' : 'Xem tất cả bình luận';
  list.classList.toggle('is-expanded', showAllReviews);
  actions.hidden = count === 0;
  arrows.forEach(button => {
    button.hidden = showAllReviews || count <= 1;
  });
}

async function loadProductReviews() {
  const list = document.querySelector('#review-list');
  document.querySelector('#review-message').textContent = '';
  list.replaceChildren();
  const config = window.AYSSupabaseConfig;
  document.querySelector('#review-list').innerHTML = '<p class="review-empty">Đang tải bình luận…</p>';
  const query = new URLSearchParams({
    select: 'id,display_name,product_name,rating,comment,created_at',
    status: 'eq.approved',
    order: 'created_at.desc',
    limit: '50'
  });

  try {
    const response = await fetch(`${config.url}/rest/v1/product_reviews?${query}`, {
      headers: { apikey: config.publishableKey }
    });
    if (!response.ok) throw new Error(`(${response.status}) ${await response.text()}`);
    const reviews = await response.json();
    if (!Array.isArray(reviews)) throw new Error('Dữ liệu đánh giá không hợp lệ.');
    renderProductReviews(reviews);
  } catch (error) {
    console.error('Could not load product reviews:', error);
    list.append(Object.assign(document.createElement('p'), {
      className: 'review-empty',
      textContent: 'Chưa tải được lời nhắn.'
    }));
    updateReviewControls(0);
  }
}

document.querySelector('#review-form').addEventListener('submit', async event => {
  event.preventDefault();

  const form = event.currentTarget;
  const submitButton = form.querySelector('button[type="submit"]');
  const formData = new FormData(form);
  const displayName = String(formData.get('display_name') || '').trim();
  const comment = String(formData.get('comment') || '').trim();
  if (displayName.length < 2 || comment.length < 10) {
    setReviewMessage('Tên cần ít nhất 2 ký tự và lời nhắn ít nhất 10 ký tự.', true);
    return;
  }

  const config = window.AYSSupabaseConfig;
  submitButton.disabled = true;
  setReviewMessage('Đang gửi đánh giá…');
  try {
    const response = await fetch(`${config.url}/rest/v1/product_reviews`, {
      method: 'POST',
      headers: {
        apikey: config.publishableKey,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({
        display_name: displayName,
        rating: Number(formData.get('rating')),
        comment,
        status: 'pending'
      })
    });
    if (!response.ok) throw new Error(`(${response.status}) ${await response.text()}`);
    form.reset();
    setReviewMessage('Đã nhận đánh giá. Lời nhắn sẽ hiển thị sau khi shop duyệt.');
  } catch (error) {
    console.error('Could not submit product review:', error);
    setReviewMessage('Chưa gửi được đánh giá. Vui lòng thử lại sau.', true);
  } finally {
    submitButton.disabled = false;
  }
});
loadProductReviews();
document.querySelector('#review-rating-filter').addEventListener('change', () => {
  showAllReviews = false;
  renderFilteredReviews();
  document.querySelector('.review-carousel-viewport').scrollTo({ left: 0, behavior: 'smooth' });
});
document.querySelector('#show-all-reviews').addEventListener('click', event => {
  showAllReviews = !showAllReviews;
  renderFilteredReviews();
  event.currentTarget.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
});
document.querySelector('.review-carousel-prev').addEventListener('click', () => {
  const viewport = document.querySelector('.review-carousel-viewport');
  viewport.scrollBy({ left: -viewport.clientWidth * .9, behavior: 'smooth' });
});
document.querySelector('.review-carousel-next').addEventListener('click', () => {
  const viewport = document.querySelector('.review-carousel-viewport');
  viewport.scrollBy({ left: viewport.clientWidth * .9, behavior: 'smooth' });
});
document.querySelectorAll('[data-sale-direction]').forEach(button => button.addEventListener('click', () => {
  const viewport = document.querySelector('#sale-carousel-viewport');
  viewport.scrollBy({ left: Number(button.dataset.saleDirection) * viewport.clientWidth * .9, behavior: 'smooth' });
}));
window.addEventListener('resize', updateSaleCarouselControls);

const mobileSteps = window.matchMedia('(max-width: 800px)');
function syncStepCards() {
  document.querySelectorAll('.step').forEach(step => {
    step.classList.remove('is-flipped');
    const front = step.querySelector('.step-front');
    const back = step.querySelector('.step-back');
    front.setAttribute('aria-hidden', 'false');
    back.setAttribute('aria-hidden', 'false');
    front.inert = false;
    back.inert = false;
    if (mobileSteps.matches) {
      back.setAttribute('aria-hidden', 'true');
      back.inert = true;
    }
    step.querySelectorAll('.step-flip-toggle').forEach(button => {
      button.setAttribute('aria-expanded', 'false');
    });
  });
}
document.querySelectorAll('.step').forEach(step => {
  const buttons = [...step.querySelectorAll('.step-flip-toggle')];
  buttons.forEach(button => button.addEventListener('click', () => {
    if (!mobileSteps.matches) return;
    const isFlipped = !step.classList.contains('is-flipped');
    step.classList.toggle('is-flipped', isFlipped);
    step.querySelector('.step-front').setAttribute('aria-hidden', String(isFlipped));
    step.querySelector('.step-back').setAttribute('aria-hidden', String(!isFlipped));
    step.querySelector('.step-front').inert = isFlipped;
    step.querySelector('.step-back').inert = !isFlipped;
    buttons.forEach(toggle => toggle.setAttribute('aria-expanded', String(isFlipped)));
    buttons.find(toggle => toggle !== button)?.focus({ preventScroll: true });
  }));
});
mobileSteps.addEventListener('change', syncStepCards);
syncStepCards();

function renderProductGallery(product) {
  const gallery = document.querySelector('#modal-gallery');
  if (window.jQuery && window.jQuery(gallery).hasClass('slick-initialized')) window.jQuery(gallery).slick('unslick');
  gallery.innerHTML = window.AYSProduct.getGallery(product).map((image, index) => `<button type="button" class="gallery-thumb ${index === 0 ? 'is-selected' : ''}" data-gallery-image="${escapeHtml(image)}"><img src="${escapeHtml(image)}" alt="${escapeHtml(product.name)} image ${index + 1}"></button>`).join('');
  gallery.querySelectorAll('[data-gallery-image]').forEach(button => button.addEventListener('click', () => {
    document.querySelector('#modal-preview').style.backgroundImage = `url("${button.dataset.galleryImage}")`;
    gallery.querySelectorAll('.gallery-thumb').forEach(item => item.classList.remove('is-selected'));
    button.classList.add('is-selected');
  }));
  if (window.jQuery && typeof window.jQuery.fn.slick === 'function' && gallery.children.length > 1) {
    window.jQuery(gallery).slick({
      arrows: false,
      centerMode: true,
      centerPadding: '18px',
      focusOnSelect: true,
      slidesToShow: Math.min(3, gallery.children.length),
      responsive: [{ breakpoint: 800, settings: { slidesToShow: 2 } }]
    });
  }
}
function renderLicenseOptions(product) {
  const hasCommercial = Number.isFinite(product.commercialPrice);
  const discounted = personalPrice(product) < product.price;
  const personalLabel = discounted ? `${currency(personalPrice(product))} <del>${currency(product.price)}</del>` : currency(product.price);
  document.querySelector('#license-options').innerHTML = `<p class="license-label">Quyền sử dụng</p><label class="license-option"><input type="radio" name="license" value="personal" checked><span><b>Dùng cá nhân</b><small>Giá cá nhân · ${personalLabel}</small></span></label>${hasCommercial ? `<label class="license-option"><input type="radio" name="license" value="commercial"><span><b>Dùng thương mại</b><small>Giá thương mại · ${currency(product.commercialPrice)}</small></span></label>` : '<p class="license-help">Mầm này chỉ hỗ trợ quyền sử dụng cá nhân.</p>'}`;
  updateModalPrice(product, 'personal');
  document.querySelectorAll('input[name="license"]').forEach(input => input.addEventListener('change', () => updateModalPrice(product, input.value)));
}
function updateModalPrice(product, license) {
  const priceElement = document.querySelector('#modal-price');
  if (license === 'commercial') {
    priceElement.textContent = currency(product.commercialPrice);
    return;
  }
  const discounted = personalPrice(product) < product.price;
  priceElement.innerHTML = discounted ? `<span class="modal-sale-price">${currency(personalPrice(product))}</span><del class="modal-original-price">${currency(product.price)}</del>` : currency(product.price);
}
function saveCart() {
  const storageKey = customerStorageKey('mori-cart');
  if (storageKey) localStorage.setItem(storageKey, JSON.stringify(cart));
}
function saveWishlist() {
  const storageKey = customerStorageKey('ays-wishlist');
  if (storageKey) localStorage.setItem(storageKey, JSON.stringify(wishlist));
}
function addToCart(product, license = 'personal') {
  if (!requireCustomerAccount()) return false;
  if (product.status !== 'sold' && !cart.some(item => item.id === product.id && item.license === license)) cart.push({ id: product.id, license });
  saveCart();
  updateCartCount();
  renderCart();
  return true;
}
function updateCartCount() { document.querySelector('#cart-count').textContent = cart.length; document.querySelector('#cart-title-count').textContent = `(${cart.length})`; }
function updateWishlistCount() {
  document.querySelector('#wishlist-count').textContent = wishlist.length;
  document.querySelector('#wishlist-title-count').textContent = `(${wishlist.length})`;
}
function renderCart() {
  if (!canUseCustomerFeatures()) return;
  const items = cart.map(item => { const product = products.find(entry => entry.id === item.id); return { ...product, license: item.license, selectedPrice: item.license === 'commercial' ? product.commercialPrice : personalPrice(product) }; });
  document.querySelector('#cart-items').innerHTML = items.length ? items.map((product, index) => `<div class="cart-item"><div class="cart-item-image" style="background-image:url('${escapeHtml(product.image)}')"></div><div><h3>${escapeHtml(product.name)}</h3><p>${product.license === 'commercial' ? 'Dùng thương mại' : 'Dùng cá nhân'} · ${currency(product.selectedPrice)}</p></div><button class="remove-item" data-remove-index="${index}" aria-label="Bỏ ${escapeHtml(product.name)} khỏi giỏ">×</button></div>`).join('') : '<div class="empty-cart">Đang chờ bạn lựa mầm vào giỏ.</div>';
  document.querySelector('#cart-total').textContent = currency(items.reduce((total, product) => total + product.selectedPrice, 0));
  document.querySelector('#checkout-button').disabled = !items.length;
  document.querySelectorAll('[data-remove-index]').forEach(button => button.addEventListener('click', () => {
    if (!requireCustomerAccount()) return;
    cart.splice(Number(button.dataset.removeIndex), 1);
    saveCart();
    updateCartCount();
    renderCart();
  }));
}
function renderCheckoutSummary() {
  if (!canUseCustomerFeatures()) return;
  const nameInput = document.querySelector('#customer-name');
  const emailInput = document.querySelector('#customer-email');
  if (!nameInput.value.trim()) nameInput.value = customerUser.user_metadata?.display_name || '';
  emailInput.value = customerUser.email || '';
  const items = cart.map(item => { const product = products.find(entry => entry.id === item.id); return { ...product, license: item.license, selectedPrice: item.license === 'commercial' ? product.commercialPrice : personalPrice(product) }; });
  document.querySelector('#checkout-order-items').innerHTML = items.map(product => `<div class="checkout-order-item"><img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}"><div><strong>${escapeHtml(product.name)}</strong><small>${product.license === 'commercial' ? 'Dùng thương mại' : 'Dùng cá nhân'}</small></div><span>${currency(product.selectedPrice)}</span></div>`).join('');
  const subtotal = items.reduce((total, product) => total + product.selectedPrice, 0);
  appliedVoucher = null;
  document.querySelector('#checkout-subtotal').textContent = currency(subtotal);
  document.querySelector('#checkout-discount-row').hidden = true;
  document.querySelector('#checkout-voucher-code').value = '';
  document.querySelector('#remove-checkout-voucher').hidden = true;
  setCheckoutVoucherMessage('Voucher chỉ dùng được khi đăng nhập đúng tài khoản My AYS.');
  document.querySelector('#checkout-total').textContent = currency(subtotal);
}

function setCheckoutVoucherMessage(text, state = '') {
  const message = document.querySelector('#checkout-voucher-message');
  message.textContent = text;
  message.classList.toggle('is-error', state === 'error');
  message.classList.toggle('is-success', state === 'success');
}

function currentCartForOrder() {
  return cart.map(item => ({ id: item.id, license: item.license }));
}

async function previewCheckoutVoucher(code) {
  const config = window.AYSSupabaseConfig;
  if (!config?.url || !config.publishableKey || !window.supabase?.createClient) {
    throw new Error('Không kết nối được Supabase để xác minh voucher.');
  }
  const client = window.supabase.createClient(config.url, config.publishableKey);
  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  if (sessionError) throw sessionError;
  const user = sessionData.session?.user;
  if (!user?.email_confirmed_at) {
    throw new Error('Hãy đăng nhập My AYS bằng email đã xác minh để dùng voucher.');
  }
  const checkoutEmail = document.querySelector('#customer-email').value.trim().toLowerCase();
  if (!checkoutEmail || checkoutEmail !== user.email?.toLowerCase()) {
    throw new Error('Nhập đúng email đã xác minh của tài khoản My AYS trước khi áp dụng voucher.');
  }

  const { data, error } = await client.rpc('preview_my_voucher', {
    p_code: code,
    p_items: currentCartForOrder()
  });
  if (error) throw error;
  if (!data?.[0]) throw new Error('Voucher không áp dụng được cho giỏ hàng này.');
  return { ...data[0], ownerEmail: user.email.toLowerCase() };
}

function updateCheckoutVoucherSummary(voucher) {
  const subtotal = Number(voucher.subtotal);
  const discount = Number(voucher.discount);
  document.querySelector('#checkout-subtotal').textContent = currency(subtotal);
  document.querySelector('#checkout-discount').textContent = `−${currency(discount)}`;
  document.querySelector('#checkout-voucher-label').textContent = voucher.voucher_code;
  document.querySelector('#checkout-discount-row').hidden = false;
  document.querySelector('#checkout-total').textContent = currency(Number(voucher.total));
  document.querySelector('#remove-checkout-voucher').hidden = false;
  setCheckoutVoucherMessage(
    `Đã áp dụng giảm ${Number(voucher.discount_percent)}% trên ${currency(Number(voucher.eligible_subtotal))} sản phẩm đủ điều kiện. Hạn ${new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium' }).format(new Date(voucher.expires_at))}.`,
    'success'
  );
}

document.querySelectorAll('.category-filter,.design-type-filter,.price-filter,.status-filter').forEach(input => input.addEventListener('change', () => { currentProductPage = 1; renderProducts(); }));
document.querySelector('#sort-products').addEventListener('change', renderProducts);
document.querySelector('#clear-filters').addEventListener('click', () => { document.querySelectorAll('.category-filter,.design-type-filter,.price-filter,.status-filter').forEach(input => input.checked = false); currentProductPage = 1; renderProducts(); });
document.querySelector('.filter-toggle').addEventListener('click', event => {
  const button = event.currentTarget;
  const filters = document.querySelector('.filters');
  const isExpanded = filters.classList.toggle('is-expanded');
  button.setAttribute('aria-expanded', String(isExpanded));
});
document.querySelector('.search-toggle').addEventListener('click', () => { const popover = document.querySelector('#search-popover'); const willOpen = !popover.classList.contains('is-open'); popover.classList.toggle('is-open', willOpen); popover.setAttribute('aria-hidden', String(!willOpen)); document.querySelector('.search-toggle').setAttribute('aria-expanded', String(willOpen)); if (willOpen) { renderSearchResults(); document.querySelector('#search-input').focus(); } });
document.querySelector('#search-input').addEventListener('input', event => renderSearchResults(event.target.value));
document.addEventListener('click', event => { if (!event.target.closest('.site-header')) closeSearch(); });
document.querySelector('#modal-add').addEventListener('click', () => {
  if (!requireCustomerAccount()) return;
  if (!addToCart(activeProduct, document.querySelector('input[name="license"]:checked')?.value || 'personal')) return;
  closeModal(document.querySelector('#product-modal'));
  openModal('cart-modal');
});
document.querySelector('#open-cart').addEventListener('click', () => {
  if (!requireCustomerAccount()) return;
  renderCart();
  openModal('cart-modal');
});
document.querySelector('#open-wishlist').addEventListener('click', () => {
  if (!requireCustomerAccount()) return;
  renderWishlist();
  openModal('wishlist-modal');
});
document.querySelector('#checkout-button').addEventListener('click', () => {
  if (!requireCustomerAccount()) return;
  renderCheckoutSummary();
  closeModal(document.querySelector('#cart-modal'));
  openModal('checkout-modal');
});
notificationButton?.addEventListener('click', async () => {
  if (!requireCustomerAccount()) return;
  const isOpen = !notificationPopover.hidden;
  if (isOpen) {
    closeHeaderNotifications();
    return;
  }
  notificationPopover.hidden = false;
  notificationButton.setAttribute('aria-expanded', 'true');
  await refreshHeaderNotifications();
});
document.addEventListener('click', event => {
  if (!event.target.closest('.header-notifications')) closeHeaderNotifications();
});
document.querySelector('#checkout-voucher-code').addEventListener('input', () => {
  if (!appliedVoucher) return;
  appliedVoucher = null;
  const subtotal = cart.reduce((total, item) => {
    const product = products.find(entry => entry.id === item.id);
    return total + (item.license === 'commercial' ? product.commercialPrice : personalPrice(product));
  }, 0);
  document.querySelector('#checkout-discount-row').hidden = true;
  document.querySelector('#checkout-total').textContent = currency(subtotal);
  document.querySelector('#remove-checkout-voucher').hidden = true;
  setCheckoutVoucherMessage('Mã đã thay đổi. Áp dụng lại để kiểm tra voucher.');
});
document.querySelector('#customer-email').addEventListener('input', event => {
  if (!appliedVoucher || event.target.value.trim().toLowerCase() === appliedVoucher.ownerEmail) return;
  appliedVoucher = null;
  const subtotal = cart.reduce((total, item) => {
    const product = products.find(entry => entry.id === item.id);
    return total + (item.license === 'commercial' ? product.commercialPrice : personalPrice(product));
  }, 0);
  document.querySelector('#checkout-discount-row').hidden = true;
  document.querySelector('#checkout-total').textContent = currency(subtotal);
  document.querySelector('#remove-checkout-voucher').hidden = true;
  setCheckoutVoucherMessage('Email đã đổi; voucher cần khớp email tài khoản My AYS.', 'error');
});
document.querySelector('#apply-checkout-voucher').addEventListener('click', async event => {
  const button = event.currentTarget;
  const code = document.querySelector('#checkout-voucher-code').value.trim().toUpperCase();
  if (!code) {
    setCheckoutVoucherMessage('Nhập mã voucher My AYS trước nhé.', 'error');
    return;
  }
  button.disabled = true;
  setCheckoutVoucherMessage('Đang kiểm tra voucher…');
  try {
    const voucher = await previewCheckoutVoucher(code);
    appliedVoucher = voucher;
    document.querySelector('#checkout-voucher-code').value = voucher.voucher_code;
    updateCheckoutVoucherSummary(voucher);
  } catch (error) {
    console.error('Could not apply checkout voucher:', error);
    appliedVoucher = null;
    const subtotal = cart.reduce((total, item) => {
      const product = products.find(entry => entry.id === item.id);
      return total + (item.license === 'commercial' ? product.commercialPrice : personalPrice(product));
    }, 0);
    document.querySelector('#checkout-discount-row').hidden = true;
    document.querySelector('#checkout-total').textContent = currency(subtotal);
    document.querySelector('#remove-checkout-voucher').hidden = true;
    setCheckoutVoucherMessage(error.message || 'Không áp dụng được voucher.', 'error');
  } finally {
    button.disabled = false;
  }
});
document.querySelector('#remove-checkout-voucher').addEventListener('click', () => {
  appliedVoucher = null;
  renderCheckoutSummary();
});
document.querySelector('#checkout-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!requireCustomerAccount()) return;
  const form = event.target;
  const submitButton = form.querySelector('button[type="submit"]');
  const orderItems = cart.map(item => { const product = products.find(entry => entry.id === item.id); return { ...product, license: item.license, selectedPrice: item.license === 'commercial' ? product.commercialPrice : personalPrice(product) }; });
  let orderTotal = orderItems.reduce((total, product) => total + product.selectedPrice, 0);
  const formData = new FormData(form);
  const voucherCodeToSubmit = appliedVoucher?.voucher_code || null;
  if (voucherCodeToSubmit && appliedVoucher.ownerEmail !== String(formData.get('email')).trim().toLowerCase()) {
    setCheckoutVoucherMessage('Email checkout phải trùng email đã xác minh voucher.', 'error');
    return;
  }
  const orderReference = sessionStorage.getItem('ays-order-reference') || crypto.randomUUID();
  sessionStorage.setItem('ays-order-reference', orderReference);
  formData.set('_subject', `New AYS order ${orderReference} from ${formData.get('name')}`);
  formData.set('order_reference', orderReference);
  formData.set('items', orderItems.map(product => `${product.name} - ${product.license === 'commercial' ? 'Commercial Use' : 'Personal Use'} (${currency(product.selectedPrice)})`).join(', '));
  formData.set('total', currency(orderTotal));
  formData.set('_captcha', 'false');
  submitButton.disabled = true;
  submitButton.textContent = 'Đang gửi đơn…';

  let orderRecorded = false;
  try {
    const config = window.AYSSupabaseConfig;
    const headers = {
      apikey: config.publishableKey,
      'Content-Type': 'application/json'
    };
    if (window.supabase?.createClient) {
      const authClient = window.supabase.createClient(config.url, config.publishableKey);
      const { data: sessionData, error: sessionError } = await authClient.auth.getSession();
      if (sessionError) {
        console.error('Could not read the customer session; submitting this as a guest order:', sessionError);
      } else if (sessionData.session?.access_token) {
        headers.Authorization = `Bearer ${sessionData.session.access_token}`;
      }
    }
    const orderResponse = await fetch(`${config.url}/rest/v1/rpc/submit_order`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        p_client_reference: orderReference,
        p_customer_name: formData.get('name'),
        p_customer_email: formData.get('email'),
        p_contact: formData.get('contact') || '',
        p_order_note: formData.get('order_note') || '',
        p_items: currentCartForOrder(),
        p_voucher_code: voucherCodeToSubmit
      })
    });
    if (!orderResponse.ok) {
      const details = await orderResponse.text();
      throw new Error(`Không lưu được đơn hàng (${orderResponse.status}): ${details}`);
    }
    const savedOrder = await orderResponse.json();
    orderRecorded = true;
    orderTotal = Number(savedOrder.total);
    formData.set('subtotal', currency(Number(savedOrder.subtotal)));
    formData.set('discount', currency(Number(savedOrder.discount)));
    formData.set('voucher_code', savedOrder.voucher_code || '');
    formData.set('total', currency(orderTotal));
    if (Number(savedOrder.discount) > 0) {
      formData.set('items', `${formData.get('items')}; Voucher ${savedOrder.voucher_code}: -${currency(Number(savedOrder.discount))}`);
    }

    const response = await fetch('https://formsubmit.co/ajax/kwn.hsthuylinh@gmail.com', {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: formData
    });
    if (!response.ok) throw new Error('Order request failed');
    cart = [];
    saveCart();
    updateCartCount();
    updateWishlistCount();
    sessionStorage.removeItem('ays-order-reference');
    closeModal(document.querySelector('#checkout-modal'), false);
    document.querySelector('#order-success-copy').textContent = Number(savedOrder.discount) > 0
      ? `Voucher ${savedOrder.voucher_code} đã giảm ${currency(Number(savedOrder.discount))}. Số tiền thanh toán ${currency(orderTotal)}. Shop sẽ kiểm tra bill và gửi file qua email trong vòng 1-12 tiếng.`
      : 'Cảm ơn bạn đã order! Shop sẽ kiểm tra thanh toán và gửi file qua email trong vòng 1-12 tiếng.';
    document.querySelector('#success-order-reference').textContent = orderReference;
    document.querySelector('#success-track-order').href = `track-order.html?reference=${encodeURIComponent(orderReference)}`;
    renderProducts();
    openModal('success-modal');
    form.reset();
    appliedVoucher = null;
  } catch (error) {
    console.error('Could not submit the order:', error);
    window.alert(orderRecorded
      ? 'Đơn đã được lưu để shop theo dõi, nhưng email kèm bill chưa gửi được. Hãy thử gửi lại; mã đơn sẽ được giữ để không tạo bản ghi trùng.'
      : 'Chưa ghi nhận được đơn hàng. Vui lòng thử lại sau ít phút.');
  } finally {
    submitButton.disabled = false;
    submitButton.innerHTML = 'Tôi đã thanh toán · Gửi Hạt Giống <span>→</span>';
  }
});
document.querySelectorAll('[data-close-modal]').forEach(button => button.addEventListener('click', () => closeModal(button.closest('.modal-backdrop'))));
document.querySelectorAll('.modal-backdrop').forEach(modal => modal.addEventListener('click', event => { if (event.target === modal) closeModal(modal); }));
document.addEventListener('keydown', event => {
  const openModals = [...document.querySelectorAll('.modal-backdrop.is-open')];
  if (event.key === 'Escape' && openModals.length) {
    closeModal(openModals[openModals.length - 1]);
    return;
  }
  if (event.key !== 'Tab' || !openModals.length) return;

  const activeModal = openModals[openModals.length - 1];
  const focusable = [...activeModal.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])')]
    .filter(element => element.getClientRects().length);
  if (!focusable.length) return;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && (document.activeElement === first || !activeModal.contains(document.activeElement))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (document.activeElement === last || !activeModal.contains(document.activeElement))) {
    event.preventDefault();
    first.focus();
  }
});

function initHeroSlider() {
  const heroArt = document.querySelector('.hero-art');
  const heroSlideInterval = 2000;
  if (!heroArt) return;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (window.jQuery && typeof window.jQuery.fn.slick === 'function') {
    window.jQuery(heroArt).slick({
      autoplay: !reduceMotion,
      autoplaySpeed: heroSlideInterval,
      arrows: false,
      dots: true,
      fade: true,
      infinite: true,
      pauseOnHover: true,
      speed: 300
    });
    return;
  }

  const slides = [...heroArt.querySelectorAll('.hero-art-image')];
  if (slides.length < 2 || reduceMotion) return;
  let activeSlide = 0;
  slides.forEach((slide, index) => slide.classList.toggle('is-active', index === activeSlide));
  window.setInterval(() => {
    slides[activeSlide].classList.remove('is-active');
    activeSlide = (activeSlide + 1) % slides.length;
    slides[activeSlide].classList.add('is-active');
  }, heroSlideInterval);
}

initHeroSlider();

if (window.AYSSupabaseConfig?.url && window.AYSSupabaseConfig.publishableKey && window.supabase?.createClient) {
  customerClient = window.supabase.createClient(
    window.AYSSupabaseConfig.url,
    window.AYSSupabaseConfig.publishableKey
  );
  customerClient.auth.onAuthStateChange((_event, session) => {
    const previousUserId = customerUser?.id || null;
    setCustomerSession(session?.user || null);
    if (session?.user && previousUserId === session.user.id) {
      window.setTimeout(refreshHeaderNotifications, 0);
    }
  });
  customerClient.auth.getSession()
    .then(({ data, error }) => {
      if (error) throw error;
      setCustomerSession(data.session?.user || null);
    })
    .catch(error => {
      console.error('Could not restore the customer session:', error);
      document.querySelector('#header-notification-status').textContent = 'Không kiểm tra được tài khoản. Hãy tải lại trang.';
    });
} else {
  console.error('Supabase is not configured; customer-only shop actions are unavailable.');
}

window.AYSShop.loadProducts()
  .then(data => {
    products = data;
    products.forEach(product => {
      if (product.category !== 'design') {
        product.stock = Math.max(0, Number.isInteger(product.stock) ? product.stock : 0);
        product.status = product.stock > 0 ? 'available' : 'sold';
      }
    });
    cart = cart.filter(item => {
      const product = products.find(entry => entry.id === item.id);
      return product && product.status !== 'sold' && (item.license !== 'commercial' || Number.isFinite(product.commercialPrice));
    });
    saveCart();
    updateFilterCounts();
    renderPaymentInfo();
    renderProducts();
    updateCartCount();
    updateWishlistCount();
    renderCart();
    if (customerUser) renderHeaderNotifications(voucherNotifications);
  })
  .catch(error => {
    console.error(error);
    if (grid) grid.innerHTML = '<p class="empty-cart">Không thể tải dữ liệu sản phẩm.</p>';
  });
