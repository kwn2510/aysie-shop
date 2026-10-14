(() => {
  const config = window.AYSSupabaseConfig;
  const message = document.querySelector('#orders-message');
  const list = document.querySelector('#admin-order-list');
  const reloadButton = document.querySelector('#reload-orders');
  const signoutButton = document.querySelector('#orders-signout');
  const viewButtons = [...document.querySelectorAll('[data-order-view]')];
  const statuses = {
    awaiting_review: 'Chờ kiểm tra',
    paid: 'Đã thanh toán',
    fulfilled: 'Đã gửi file',
    cancelled: 'Đã hủy'
  };
  let client;
  let busy = false;
  let orders = [];
  let cancellationRequests = [];
  let activeView = 'processing';

  function showMessage(text, isError = false) {
    message.textContent = text;
    message.classList.toggle('is-error', isError);
  }

  function makeElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function setBusy(value) {
    busy = value;
    reloadButton.disabled = value;
    signoutButton.disabled = value;
    viewButtons.forEach(button => { button.disabled = value; });
    list.querySelectorAll('button,select').forEach(control => { control.disabled = value; });
  }

  function formatCurrency(value) {
    return new Intl.NumberFormat('vi-VN', {
      style: 'currency',
      currency: 'VND',
      maximumFractionDigits: 0
    }).format(Number(value));
  }

  function renderOrder(order) {
    const card = makeElement('article', 'admin-order-card');
    const header = makeElement('div', 'admin-order-header');
    const title = makeElement('div', 'admin-order-title');
    title.append(
      makeElement('h2', '', `Đơn ${order.client_reference.slice(0, 8).toUpperCase()}`),
      makeElement('time', '', new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(order.created_at)))
    );
    const status = makeElement('span', `admin-status admin-order-status admin-order-status-${order.status}`, statuses[order.status]);
    header.append(title, status);

    const customer = makeElement('div', 'admin-order-customer');
    const email = makeElement('a', '', order.customer_email);
    email.href = `mailto:${encodeURIComponent(order.customer_email)}`;
    customer.append(
      makeElement('strong', '', order.customer_name),
      email
    );
    if (order.contact) customer.append(makeElement('p', '', `Liên hệ: ${order.contact}`));

    const items = makeElement('ul', 'admin-order-items');
    order.items.forEach(item => {
      items.append(makeElement(
        'li',
        '',
        `${item.name} · ${item.license === 'commercial' ? 'Thương mại' : 'Cá nhân'} · ${formatCurrency(item.unit_price)}`
      ));
    });

    let cancellationPanel = null;
    const cancellation = cancellationRequests.find(request => request.order_id === order.id);
    if (cancellation) {
      const cancellationStatuses = {
        pending: 'Đang chờ xử lý',
        approved: 'Đã duyệt',
        rejected: 'Đã từ chối'
      };
      const requestPanel = makeElement('section', 'admin-cancellation-request');
      requestPanel.append(
        makeElement('h3', '', `Yêu cầu hủy đơn · ${cancellationStatuses[cancellation.status] || cancellation.status}`),
        makeElement('p', '', `Tên: ${cancellation.customer_name}`),
        makeElement('p', '', `Email: ${cancellation.customer_email}`),
        makeElement('p', '', `Liên hệ mạng xã hội: ${cancellation.social_contact_url}`),
        makeElement('p', '', `Lý do: ${cancellation.reason}`),
        makeElement('p', '', `Ngân hàng: ${cancellation.bank_name}`),
        makeElement('p', '', `Chủ tài khoản: ${cancellation.account_holder}`),
        makeElement('p', '', `Số tài khoản: ${cancellation.account_number}`)
      );
      const receiptActions = makeElement('div', 'admin-cancellation-actions');
      const receiptButton = makeElement('button', 'admin-signout', 'Tạo liên kết xem bill');
      receiptButton.type = 'button';
      receiptButton.addEventListener('click', async () => {
        receiptButton.disabled = true;
        try {
          const { data, error } = await client.storage
            .from('order-cancellation-bills')
            .createSignedUrl(cancellation.receipt_path, 60);
          if (error) throw error;
          const receiptLink = makeElement('a', '', 'Mở bill giao dịch (link hết hạn sau 1 phút)');
          receiptLink.href = data.signedUrl;
          receiptLink.target = '_blank';
          receiptLink.rel = 'noopener noreferrer';
          receiptActions.querySelector('a')?.remove();
          receiptActions.insertBefore(receiptLink, receiptButton.nextSibling);
        } catch (error) {
          console.error('Could not create a private cancellation bill link:', error);
          receiptActions.append(makeElement('p', 'is-error', `Không mở được bill: ${error.message}`));
        } finally {
          receiptButton.disabled = false;
        }
      });
      receiptActions.append(receiptButton);
      if (cancellation.status === 'pending') {
        const approveButton = makeElement('button', 'admin-signout', 'Đánh dấu đã xử lý');
        approveButton.type = 'button';
        approveButton.addEventListener('click', () => updateCancellationStatus(cancellation.id, 'approved'));
        const rejectButton = makeElement('button', 'admin-signout', 'Từ chối yêu cầu');
        rejectButton.type = 'button';
        rejectButton.addEventListener('click', () => updateCancellationStatus(cancellation.id, 'rejected'));
        receiptActions.append(approveButton, rejectButton);
      }
      requestPanel.append(receiptActions);
      cancellationPanel = requestPanel;
    }

    const footer = makeElement('div', 'admin-order-footer');
    const total = document.createElement('div');
    total.className = 'admin-order-total';
    if (Number(order.discount) > 0) {
      total.append(
        makeElement('span', '', `Tạm tính: ${formatCurrency(order.subtotal)}`),
        makeElement('span', '', `Voucher ${order.voucher_code} · −${formatCurrency(order.discount)}`),
        makeElement('strong', '', `Thanh toán: ${formatCurrency(order.total)}`)
      );
    } else {
      total.append(makeElement('strong', '', `Tổng: ${formatCurrency(order.total)}`));
    }
    const statusControl = document.createElement('div');
    statusControl.className = 'admin-order-status-control';
    const label = makeElement('label', '', 'Cập nhật trạng thái');
    const select = document.createElement('select');
    select.setAttribute('aria-label', `Trạng thái đơn ${order.client_reference.slice(0, 8)}`);
    Object.entries(statuses).forEach(([value, text]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      option.selected = order.status === value;
      select.append(option);
    });
    label.append(select);
    const saveButton = makeElement('button', 'admin-signout', 'Lưu trạng thái');
    saveButton.type = 'button';
    saveButton.addEventListener('click', () => updateStatus(order.id, select.value));
    statusControl.append(label, saveButton);
    footer.append(total, statusControl);
    card.append(header, customer);
    if (order.order_note) card.append(makeElement('p', 'admin-order-note', `Lời nhắn: ${order.order_note}`));
    card.append(items);
    if (cancellationPanel) card.append(cancellationPanel);
    card.append(footer);
    return card;
  }

  async function loadOrders() {
    showMessage('Đang tải đơn hàng…');
    const pageSize = 1000;
    const loadedOrders = [];
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await client
        .from('orders')
        .select('id,client_reference,customer_name,customer_email,contact,order_note,items,subtotal,discount,voucher_code,total,status,created_at')
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      loadedOrders.push(...data);
      if (data.length < pageSize) break;
    }

    orders = loadedOrders;
    const { data: requests, error: requestsError } = await client
      .from('customer_order_cancellations')
      .select('id,order_id,client_reference,customer_name,customer_email,social_contact_url,reason,bank_name,account_holder,account_number,receipt_path,status,created_at')
      .order('created_at', { ascending: false })
      .limit(1000);
    if (requestsError) throw requestsError;
    cancellationRequests = requests || [];
    renderOrders();
  }

  function renderOrders() {
    const visibleOrders = orders.filter(order => {
      if (activeView === 'fulfilled') return order.status === 'fulfilled';
      if (activeView === 'cancelled') return order.status === 'cancelled';
      return order.status === 'awaiting_review' || order.status === 'paid';
    });
    list.replaceChildren();
    if (!visibleOrders.length) {
      const emptyMessages = {
        processing: 'Không có đơn hàng nào đang xử lý.',
        fulfilled: 'Chưa có đơn nào được giao mầm.',
        cancelled: 'Không có đơn hàng nào đã hủy.'
      };
      list.append(makeElement('p', 'admin-empty', emptyMessages[activeView]));
    } else {
      visibleOrders.forEach(order => list.append(renderOrder(order)));
    }
    viewButtons.forEach(button => {
      const isActive = button.dataset.orderView === activeView;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
      const counts = {
        processing: orders.filter(order => order.status === 'awaiting_review' || order.status === 'paid').length,
        fulfilled: orders.filter(order => order.status === 'fulfilled').length,
        cancelled: orders.filter(order => order.status === 'cancelled').length
      };
      const labels = { processing: 'Đang xử lý', fulfilled: 'Đã giao mầm', cancelled: 'Đã hủy' };
      button.textContent = `${labels[button.dataset.orderView]} (${counts[button.dataset.orderView]})`;
    });
    showMessage(`Hiển thị ${visibleOrders.length} / ${orders.length} đơn hàng`);
  }

  async function updateStatus(orderId, status) {
    if (busy || !Object.hasOwn(statuses, status)) return;
    setBusy(true);
    try {
      const { error } = await client
        .from('orders')
        .update({ status })
        .eq('id', orderId);
      if (error) throw error;
      await loadOrders();
      showMessage('Đã cập nhật trạng thái đơn hàng.');
    } catch (error) {
      console.error('Could not update order status:', error);
      showMessage(`Không cập nhật được đơn hàng: ${error.message}`, true);
    } finally {
      setBusy(false);
    }
  }

  async function updateCancellationStatus(requestId, status) {
    if (busy || !['approved', 'rejected'].includes(status)) return;
    const confirmation = status === 'approved'
      ? 'Đã kiểm tra và xử lý refund cho yêu cầu này?'
      : 'Từ chối yêu cầu hủy đơn này?';
    if (!window.confirm(confirmation)) return;
    setBusy(true);
    try {
      const { error } = await client
        .from('customer_order_cancellations')
        .update({ status, reviewed_at: new Date().toISOString() })
        .eq('id', requestId);
      if (error) throw error;
      await loadOrders();
      showMessage('Đã cập nhật trạng thái yêu cầu hủy.');
    } catch (error) {
      console.error('Could not update cancellation request:', error);
      showMessage(`Không cập nhật được yêu cầu hủy: ${error.message}`, true);
    } finally {
      setBusy(false);
    }
  }

  reloadButton.addEventListener('click', async () => {
    if (busy) return;
    setBusy(true);
    try {
      await loadOrders();
    } catch (error) {
      console.error('Could not load orders:', error);
      showMessage(`Không tải được đơn hàng: ${error.message}`, true);
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

  viewButtons.forEach(button => {
    button.addEventListener('click', () => {
      if (busy || button.dataset.orderView === activeView) return;
      activeView = button.dataset.orderView;
      renderOrders();
    });
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
    await loadOrders();
  }

  initialize().catch(error => {
    console.error('Could not initialize order management:', error);
    showMessage(`Không mở được quản lý đơn hàng: ${error.message}`, true);
  });
})();
