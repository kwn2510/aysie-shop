(() => {
  const config = window.AYSSupabaseConfig;
  const message = document.querySelector('#customers-message');
  const list = document.querySelector('#admin-customer-list');
  const searchForm = document.querySelector('#customer-search-form');
  const searchInput = document.querySelector('#customer-search');
  const reloadButton = document.querySelector('#reload-customers');
  const signoutButton = document.querySelector('#customers-signout');
  const previousButton = document.querySelector('#previous-customers');
  const nextButton = document.querySelector('#next-customers');
  const detailEmpty = document.querySelector('#customer-detail-empty');
  const detail = document.querySelector('#customer-detail');
  const pageSize = 50;
  let client;
  let customers = [];
  let offset = 0;
  let totalMatches = 0;
  let busy = false;
  let selectedCustomerId = null;
  let detailRequest = 0;

  const statuses = {
    awaiting_review: 'Chờ kiểm tra thanh toán',
    paid: 'Đã xác nhận thanh toán',
    fulfilled: 'Đã giao mầm',
    cancelled: 'Đã hủy'
  };

  function showMessage(text, isError = false) {
    message.textContent = text;
    message.classList.toggle('is-error', isError);
  }

  function showDetailMessage(text, isError = false) {
    const element = document.querySelector('#customer-orders-message');
    element.textContent = text;
    element.classList.toggle('is-error', isError);
  }

  function makeElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function formatDate(value, includeTime = false) {
    return new Intl.DateTimeFormat('vi-VN', {
      dateStyle: 'medium',
      ...(includeTime ? { timeStyle: 'short' } : {})
    }).format(new Date(value));
  }

  function formatCurrency(value) {
    return new Intl.NumberFormat('vi-VN', {
      style: 'currency',
      currency: 'VND',
      maximumFractionDigits: 0
    }).format(Number(value));
  }

  function setBusy(value) {
    busy = value;
    reloadButton.disabled = value;
    signoutButton.disabled = value;
    previousButton.disabled = value || offset === 0;
    nextButton.disabled = value || offset + customers.length >= totalMatches;
    searchInput.disabled = value;
    searchForm.querySelector('button[type="submit"]').disabled = value;
    list.querySelectorAll('button').forEach(button => { button.disabled = value; });
  }

  function renderCustomers() {
    list.replaceChildren();
    if (!customers.length) {
      list.append(makeElement('p', 'admin-empty', 'Không tìm thấy tài khoản My AYS nào.'));
      return;
    }

    customers.forEach(customer => {
      const row = makeElement('article', `admin-customer-row${customer.user_id === selectedCustomerId ? ' is-selected' : ''}`);
      const info = makeElement('div', 'admin-customer-row-info');
      info.append(
        makeElement('strong', '', customer.display_name),
        makeElement('span', '', customer.email || 'Không có email'),
        makeElement('small', '', `${customer.order_count} đơn liên kết`)
      );
      const button = makeElement('button', 'admin-signout', 'Xem');
      button.type = 'button';
      button.setAttribute('aria-label', `Xem khách hàng ${customer.display_name}`);
      button.addEventListener('click', () => selectCustomer(customer));
      row.append(info, button);
      list.append(row);
    });
  }

  function renderCustomerOrders(orders) {
    const orderList = document.querySelector('#admin-customer-orders');
    orderList.replaceChildren();
    const total = Number(orders[0]?.account_order_total || 0);
    const orderCount = Number(orders[0]?.account_order_count || 0);
    document.querySelector('#customer-order-count').textContent = String(orderCount);
    document.querySelector('#customer-order-total').textContent = formatCurrency(total);

    if (!orderCount) {
      orderList.append(makeElement('p', 'admin-empty', 'Khách hàng chưa có đơn được liên kết.'));
      showDetailMessage('');
      return;
    }
    orders.forEach(order => {
      const card = makeElement('article', 'admin-customer-order');
      const header = makeElement('div', 'admin-customer-order-header');
      header.append(
        makeElement('strong', '', `Đơn ${order.client_reference.slice(0, 8).toUpperCase()}`),
        makeElement('span', `admin-status admin-order-status-${order.status}`, statuses[order.status] || order.status)
      );
      const items = makeElement('ul');
      (order.items || []).forEach(item => {
        items.append(makeElement('li', '', `${item.name} · ${item.license === 'commercial' ? 'Thương mại' : 'Cá nhân'}`));
      });
      const footer = makeElement('div', 'admin-customer-order-footer');
      const amounts = makeElement('div', 'admin-customer-order-amounts');
      if (Number(order.discount) > 0) {
        amounts.append(
          makeElement('span', '', `Voucher ${order.voucher_code} · −${formatCurrency(order.discount)}`),
          makeElement('strong', '', `Thanh toán: ${formatCurrency(order.total)}`)
        );
      } else {
        amounts.append(makeElement('strong', '', formatCurrency(order.total)));
      }
      footer.append(makeElement('time', '', formatDate(order.created_at, true)), amounts);
      card.append(header, items, footer);
      orderList.append(card);
    });
    showDetailMessage(orderCount > orders.length
      ? `Hiển thị ${orders.length} đơn mới nhất trong tổng số ${orderCount}.`
      : `${orderCount} đơn hàng`);
  }

  async function selectCustomer(customer) {
    if (busy) return;
    const requestId = ++detailRequest;
    selectedCustomerId = customer.user_id;
    renderCustomers();
    detailEmpty.hidden = true;
    detail.hidden = false;
    document.querySelector('#customer-detail-heading').textContent = customer.display_name;
    document.querySelector('#customer-detail-email').textContent = customer.email || 'Không có email';
    document.querySelector('#customer-detail-joined').textContent = `Tham gia ${formatDate(customer.created_at)}`;
    document.querySelector('#admin-customer-orders').replaceChildren();
    document.querySelector('#customer-order-count').textContent = '…';
    document.querySelector('#customer-order-total').textContent = '…';
    showDetailMessage('Đang tải đơn hàng…');

    try {
      const { data, error } = await client.rpc('get_admin_customer_orders', {
        p_user_id: customer.user_id
      });
      if (error) throw error;
      if (requestId !== detailRequest || selectedCustomerId !== customer.user_id) return;
      renderCustomerOrders(data || []);
    } catch (error) {
      if (requestId !== detailRequest) return;
      console.error('Could not load customer orders:', error);
      showDetailMessage(`Không tải được đơn hàng: ${error.message}`, true);
    }
  }

  async function loadCustomers() {
    showMessage('Đang tải khách hàng…');
    const { data, error } = await client.rpc('get_admin_customers', {
      p_search: searchInput.value.trim() || null,
      p_limit: pageSize,
      p_offset: offset
    });
    if (error) throw error;
    customers = data || [];
    totalMatches = Number(customers[0]?.total_matches || 0);
    document.querySelector('#customer-page-indicator').textContent =
      `Trang ${Math.floor(offset / pageSize) + 1} · ${totalMatches} kết quả`;
    renderCustomers();
    previousButton.disabled = busy || offset === 0;
    nextButton.disabled = busy || offset + customers.length >= totalMatches;
    const rangeStart = customers.length ? offset + 1 : 0;
    const rangeEnd = offset + customers.length;
    showMessage(`Đang hiển thị ${rangeStart}–${rangeEnd} / ${totalMatches} tài khoản`);

    if (selectedCustomerId && customers.some(customer => customer.user_id === selectedCustomerId)) {
      const selected = customers.find(customer => customer.user_id === selectedCustomerId);
      const { data: orders, error: orderError } = await client.rpc('get_admin_customer_orders', {
        p_user_id: selected.user_id
      });
      if (orderError) throw orderError;
      if (selectedCustomerId !== selected.user_id) return;
      renderCustomerOrders(orders || []);
    } else {
      selectedCustomerId = null;
      detail.hidden = true;
      detailEmpty.hidden = false;
    }
  }

  async function runSearch(event) {
    event?.preventDefault();
    if (busy) return;
    offset = 0;
    selectedCustomerId = null;
    detail.hidden = true;
    detailEmpty.hidden = false;
    setBusy(true);
    try {
      await loadCustomers();
    } catch (error) {
      console.error('Could not search customers:', error);
      showMessage(`Không tìm được khách hàng: ${error.message}`, true);
    } finally {
      setBusy(false);
    }
  }

  searchForm.addEventListener('submit', runSearch);
  reloadButton.addEventListener('click', runSearch);
  searchInput.addEventListener('search', runSearch);

  previousButton.addEventListener('click', async () => {
    if (busy || offset === 0) return;
    offset = Math.max(0, offset - pageSize);
    selectedCustomerId = null;
    detail.hidden = true;
    detailEmpty.hidden = false;
    setBusy(true);
    try {
      await loadCustomers();
    } catch (error) {
      console.error('Could not load previous customer page:', error);
      showMessage(`Không tải được danh sách khách hàng: ${error.message}`, true);
    } finally {
      setBusy(false);
    }
  });

  nextButton.addEventListener('click', async () => {
    if (busy || offset + customers.length >= totalMatches) return;
    offset += pageSize;
    selectedCustomerId = null;
    detail.hidden = true;
    detailEmpty.hidden = false;
    setBusy(true);
    try {
      await loadCustomers();
    } catch (error) {
      console.error('Could not load next customer page:', error);
      showMessage(`Không tải được danh sách khách hàng: ${error.message}`, true);
    } finally {
      setBusy(false);
    }
  });

  signoutButton.addEventListener('click', async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { error } = await client.auth.signOut();
      if (error) throw error;
      window.location.replace('./index.html');
    } catch (error) {
      console.error('Could not sign out from customer management:', error);
      showMessage(`Không đăng xuất được: ${error.message}`, true);
      setBusy(false);
    }
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
    await loadCustomers();
  }

  initialize().catch(error => {
    console.error('Could not initialize customer management:', error);
    showMessage(`Không mở được quản lý khách hàng: ${error.message}`, true);
  });
})();
