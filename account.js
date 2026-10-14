(() => {
  const config = window.AYSSupabaseConfig;
  const authPanel = document.querySelector('#account-auth-panel');
  const dashboard = document.querySelector('#my-ays-dashboard');
  const message = document.querySelector('#account-message');
  const resendButton = document.querySelector('#resend-confirmation');
  const signinTab = document.querySelector('#signin-tab');
  const signupTab = document.querySelector('#signup-tab');
  const signinForm = document.querySelector('#signin-panel');
  const signupForm = document.querySelector('#signup-panel');
  const cancellationDialog = document.querySelector('#order-cancellation-dialog');
  const cancellationForm = document.querySelector('#order-cancellation-form');
  let client;
  let currentUser = null;
  let vouchers = [];
  let customerOrders = [];
  let cancellationRequests = [];
  let cancellationRequestsReady = false;
  let activeCancellationOrder = null;
  let activeOrderFilter = 'awaiting_review';
  const requestedReturnTo = new URLSearchParams(location.search).get('next');

  function redirectAfterAuthentication(user) {
    if (!user?.email_confirmed_at || !requestedReturnTo) return;
    const destination = new URL(requestedReturnTo, location.href);
    if (destination.origin !== location.origin || destination.pathname.endsWith('/account.html')) return;
    location.assign(destination.href);
  }

  const orderStatuses = {
    awaiting_review: 'Chờ kiểm tra thanh toán',
    paid: 'Đã thanh toán',
    fulfilled: 'Đã gửi file',
    cancelled: 'Đã hủy'
  };

  function showMessage(text, isError = false) {
    message.textContent = text;
    message.classList.toggle('is-error', isError);
  }

  function showOrdersMessage(text, isError = false) {
    const element = document.querySelector('#account-orders-message');
    element.textContent = text;
    element.classList.toggle('is-error', isError);
  }

  function setTab(mode) {
    const signup = mode === 'signup';
    signinTab.setAttribute('aria-selected', String(!signup));
    signupTab.setAttribute('aria-selected', String(signup));
    signinForm.hidden = signup;
    signupForm.hidden = !signup;
    showMessage('');
    resendButton.hidden = true;
  }

  function setAccountView(view) {
    document.querySelectorAll('[data-account-view]').forEach(button => {
      const isActive = button.dataset.accountView === view;
      if (isActive) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    document.querySelectorAll('[data-account-panel]').forEach(panel => {
      panel.hidden = panel.dataset.accountPanel !== view;
    });
  }

  function formatCurrency(value) {
    return new Intl.NumberFormat('vi-VN', {
      style: 'currency',
      currency: 'VND',
      maximumFractionDigits: 0
    }).format(Number(value));
  }

  function makeElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function renderOrders(orders) {
    customerOrders = orders;
    renderFilteredOrders();
  }

  function renderFilteredOrders() {
    const list = document.querySelector('#account-orders-list');
    list.replaceChildren();
    const visibleOrders = customerOrders.filter(order => {
      if (activeOrderFilter === 'awaiting_review') return order.status === 'awaiting_review';
      if (activeOrderFilter === 'purchased') return order.status === 'paid' || order.status === 'fulfilled';
      if (activeOrderFilter === 'cancelled') return order.status === 'cancelled';
      return true;
    });
    if (!visibleOrders.length) {
      const emptyMessage = customerOrders.length
        ? 'Không có đơn hàng trong mục này.'
        : 'Chưa có đơn hàng gắn với tài khoản này.';
      list.append(makeElement('p', 'account-empty', emptyMessage));
      showOrdersMessage('0 đơn hàng');
      return;
    }

    visibleOrders.forEach(order => {
      const card = makeElement('article', 'account-order-card');
      const top = makeElement('div', 'account-order-top');
      const reference = makeElement('strong', 'account-order-reference', `Mã đơn: ${order.client_reference}`);
      const status = makeElement('span', 'account-order-status', orderStatuses[order.status] || 'Đang cập nhật');
      top.append(reference, status);
      const items = makeElement('ul');
      order.items.forEach(item => {
        items.append(makeElement('li', '', `${item.name} · ${item.license === 'commercial' ? 'Thương mại' : 'Cá nhân'}`));
      });
      const meta = makeElement('div', 'account-order-meta');
      meta.append(makeElement('span', '', `Đặt ${new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium' }).format(new Date(order.created_at))}`));
      const amount = document.createElement('span');
      if (Number(order.discount) > 0) {
        amount.append(
          makeElement('span', '', `Voucher ${order.voucher_code || ''} · giảm ${formatCurrency(order.discount)} · `),
          makeElement('strong', '', formatCurrency(order.total))
        );
      } else {
        amount.append(makeElement('strong', '', formatCurrency(order.total)));
      }
      meta.append(amount);
      card.append(top, items, meta);
      if (order.status === 'awaiting_review') card.append(renderOrderProgress(order.status));
      const cancellation = cancellationRequests.find(request =>
        request.client_reference === order.client_reference
      );
      if (cancellation) {
        const requestStatus = {
          pending: 'Đã gửi yêu cầu hủy · đang chờ shop kiểm tra',
          approved: 'Yêu cầu hủy đã được duyệt',
          rejected: 'Yêu cầu hủy chưa được duyệt'
        };
        card.append(makeElement(
          'p',
          'account-order-cancellation-status',
          requestStatus[cancellation.status] || 'Đã gửi yêu cầu hủy'
        ));
      } else if (cancellationRequestsReady && (order.status === 'awaiting_review' || order.status === 'paid')) {
        const actions = makeElement('div', 'account-order-cancellation');
        const button = makeElement('button', 'account-outline-button', 'Hủy đơn hàng');
        button.type = 'button';
        button.addEventListener('click', () => openCancellationForm(order));
        actions.append(button);
        card.append(actions);
      }
      list.append(card);
    });
    showOrdersMessage(`Hiển thị ${visibleOrders.length} / ${customerOrders.length} đơn hàng`);
  }

  function openCancellationForm(order) {
    activeCancellationOrder = order;
    cancellationForm.reset();
    document.querySelector('#cancellation-order-reference').textContent = order.client_reference;
    document.querySelector('#cancellation-customer-name').value =
      currentUser?.user_metadata?.display_name || '';
    document.querySelector('#cancellation-customer-email').value = currentUser?.email || '';
    const productList = document.querySelector('#cancellation-products');
    productList.replaceChildren();
    order.items.forEach(item => {
      productList.append(makeElement(
        'li',
        '',
        `${item.name} · ${item.license === 'commercial' ? 'Thương mại' : 'Cá nhân'}`
      ));
    });
    const messageElement = document.querySelector('#cancellation-form-message');
    messageElement.textContent = '';
    messageElement.classList.remove('is-error');
    cancellationDialog.showModal();
  }

  function renderOrderProgress(status) {
    const progress = makeElement('ol', 'account-order-progress');
    const steps = [
      ['awaiting_review', 'Chờ xác nhận thanh toán'],
      ['paid', 'Đã xác nhận thanh toán'],
      ['fulfilled', 'Đã gửi file']
    ];
    const currentIndex = status === 'awaiting_review' ? 0 : status === 'paid' ? 1 : 2;
    steps.forEach(([, label], index) => {
      const item = makeElement('li', index <= currentIndex ? 'is-complete' : '', label);
      if (index === currentIndex) item.classList.add('is-current');
      progress.append(item);
    });
    return progress;
  }

  function renderVouchers() {
    const list = document.querySelector('#account-vouchers-list');
    list.replaceChildren();
    if (!vouchers.length) {
      list.append(makeElement('p', 'account-empty', 'Bạn chưa có voucher. Hãy đăng nhập ở trang trò chơi để thử nhận một mã.'));
      return;
    }

    vouchers.forEach(voucher => {
      const expired = voucher.status === 'expired' || new Date(voucher.expires_at) <= new Date();
      const active = voucher.status === 'active' && !expired;
      const statusText = active ? 'CHƯA DÙNG' : voucher.status === 'redeemed' ? 'ĐÃ SỬ DỤNG' : 'ĐÃ HẾT HẠN';
      const dateLabel = active
        ? `Hạn đến ${new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium' }).format(new Date(voucher.expires_at))}`
        : `Tạo ngày ${new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium' }).format(new Date(voucher.created_at))}`;
      const card = makeElement('article', `account-voucher-card${active ? '' : ' is-unavailable'}`);
      const info = document.createElement('div');
      info.append(
        makeElement('strong', 'account-voucher-code', voucher.code),
        makeElement('p', 'account-voucher-meta', `Giảm ${voucher.discount_percent}% · ${dateLabel}`)
      );
      card.append(info, makeElement('span', 'account-voucher-status', statusText));
      list.append(card);
    });
  }

  async function loadVouchers() {
    const messageElement = document.querySelector('#vouchers-message');
    messageElement.textContent = 'Đang tải voucher…';
    try {
      const { data, error } = await client
        .from('customer_vouchers')
        .select('code,discount_percent,status,created_at,expires_at')
        .order('created_at', { ascending: false })
        .limit(30);
      if (error) throw error;
      vouchers = data || [];
      renderVouchers();
      const activeCount = vouchers.filter(voucher =>
        voucher.status === 'active' && new Date(voucher.expires_at) > new Date()
      ).length;
      messageElement.textContent = activeCount
        ? `Bạn có ${activeCount} voucher chưa dùng.`
        : `${vouchers.length} voucher trong lịch sử.`;
      messageElement.classList.remove('is-error');
    } catch (error) {
      console.error('Could not load customer vouchers:', error);
      vouchers = [];
      renderVouchers();
      messageElement.textContent = `Không tải được voucher: ${error.message}`;
      messageElement.classList.add('is-error');
    }
  }

  async function loadProfileAndOrders(user) {
    currentUser = user;
    cancellationRequests = [];
    cancellationRequestsReady = false;
    authPanel.hidden = true;
    dashboard.hidden = false;
    document.querySelector('#account-email').textContent = user.email || '';
    showOrdersMessage('Đang tải dữ liệu tài khoản…');

    try {
      const profileMessage = document.querySelector('#profile-message');
      const { data: profile, error: profileError } = await client
        .from('profiles')
        .select('display_name')
        .eq('id', user.id)
        .single();
      if (profileError) {
        profileMessage.textContent = `Không tải được hồ sơ: ${profileError.message}`;
        profileMessage.classList.add('is-error');
      } else {
        profileMessage.textContent = '';
        profileMessage.classList.remove('is-error');
        document.querySelector('#profile-display-name').value = profile.display_name;
        document.querySelector('#profile-greeting').textContent = profile.display_name;
      }

      const [ordersResult, cancellationResult] = await Promise.all([
        client.rpc('get_my_orders'),
        client.from('customer_order_cancellations')
          .select('client_reference,status,created_at')
          .order('created_at', { ascending: false })
          .limit(100)
      ]);
      if (ordersResult.error) {
        showOrdersMessage(`Không tải được lịch sử đơn: ${ordersResult.error.message}`, true);
      } else {
        cancellationRequestsReady = !cancellationResult.error;
        cancellationRequests = cancellationRequestsReady ? cancellationResult.data || [] : [];
        renderOrders(ordersResult.data || []);
        if (cancellationResult.error) {
          console.error('Could not load customer cancellation requests:', cancellationResult.error);
          showOrdersMessage(`Không tải được trạng thái yêu cầu hủy: ${cancellationResult.error.message}`, true);
        }
      }
      await loadVouchers();
    } catch (error) {
      console.error('Could not load customer account data:', error);
      showOrdersMessage(`Không tải được dữ liệu tài khoản: ${error.message}`, true);
    }
  }

  async function handleSession(session) {
    if (!session?.user) {
      currentUser = null;
      authPanel.hidden = false;
      dashboard.hidden = true;
      if (new URLSearchParams(location.search).has('verified')) {
        showMessage('Email đã xác minh. Bạn có thể đăng nhập My AYS.');
      }
      return;
    }

    if (!session.user.email_confirmed_at) {
      currentUser = session.user;
      authPanel.hidden = false;
      dashboard.hidden = true;
      showMessage('Hãy xác minh email qua liên kết Supabase trước khi dùng My AYS.');
      resendButton.hidden = false;
      return;
    }
    await loadProfileAndOrders(session.user);
    redirectAfterAuthentication(session.user);
  }

  function errorMessage(error) {
    if (error.message?.toLowerCase().includes('email not confirmed')) {
      resendButton.hidden = false;
      return 'Email chưa được xác minh. Hãy mở thư xác minh rồi đăng nhập lại.';
    }
    if (error.message?.toLowerCase().includes('already registered')) {
      return 'Email này đã có tài khoản. Hãy đăng nhập thay vì đăng ký lại.';
    }
    return error.message || 'Đã có lỗi. Vui lòng thử lại.';
  }

  if (!config?.url || !config.publishableKey || !window.supabase?.createClient) {
    showMessage('Chưa kết nối được Supabase. Hãy thử tải lại trang sau.', true);
    return;
  }

  client = window.AYSCustomerClient || window.supabase.createClient(config.url, config.publishableKey);
  window.AYSCustomerClient = client;
  signinTab.addEventListener('click', () => setTab('signin'));
  signupTab.addEventListener('click', () => setTab('signup'));
  document.querySelectorAll('[data-account-view]').forEach(button => {
    button.addEventListener('click', () => setAccountView(button.dataset.accountView));
  });
  document.querySelectorAll('[data-order-filter]').forEach(button => {
    button.addEventListener('click', () => {
      activeOrderFilter = button.dataset.orderFilter;
      document.querySelectorAll('[data-order-filter]').forEach(filterButton => {
        filterButton.setAttribute('aria-pressed', String(filterButton === button));
      });
      renderFilteredOrders();
    });
  });

  signinForm.addEventListener('submit', async event => {
    event.preventDefault();
    const button = signinForm.querySelector('button[type="submit"]');
    button.disabled = true;
    showMessage('Đang đăng nhập…');
    try {
      const { data, error } = await client.auth.signInWithPassword({
        email: signinForm.elements.email.value.trim(),
        password: signinForm.elements.password.value
      });
      if (error) throw error;
      await handleSession(data.session);
    } catch (error) {
      showMessage(errorMessage(error), true);
    } finally {
      button.disabled = false;
    }
  });

  signupForm.addEventListener('submit', async event => {
    event.preventDefault();
    const button = signupForm.querySelector('button[type="submit"]');
    button.disabled = true;
    showMessage('Đang tạo tài khoản…');
    try {
      const verificationRedirect = new URL('./account.html', location.href);
      verificationRedirect.searchParams.set('verified', '1');
      if (requestedReturnTo) verificationRedirect.searchParams.set('next', requestedReturnTo);
      const { data, error } = await client.auth.signUp({
        email: signupForm.elements.email.value.trim(),
        password: signupForm.elements.password.value,
        options: {
          data: { display_name: signupForm.elements.display_name.value.trim() },
          emailRedirectTo: verificationRedirect.href
        }
      });
      if (error) throw error;
      if (data.session) {
        await handleSession(data.session);
      } else {
        signupForm.reset();
        showMessage('Tài khoản đã được tạo. Hãy mở email xác minh trước khi đăng nhập.');
      }
    } catch (error) {
      showMessage(errorMessage(error), true);
    } finally {
      button.disabled = false;
    }
  });

  document.querySelector('#forgot-password').addEventListener('click', async () => {
    const email = signinForm.elements.email.value.trim();
    if (!email) {
      showMessage('Nhập email trước rồi chọn “Quên mật khẩu?”.', true);
      signinForm.elements.email.focus();
      return;
    }
    showMessage('Đang gửi email khôi phục…');
    try {
      const { error } = await client.auth.resetPasswordForEmail(email, {
        redirectTo: new URL('./account-reset-password.html', location.href).href
      });
      if (error) throw error;
      showMessage('Nếu email có tài khoản, hướng dẫn khôi phục sẽ được gửi. Hãy kiểm tra cả Spam/Junk.');
    } catch (error) {
      showMessage(errorMessage(error), true);
    }
  });

  resendButton.addEventListener('click', async () => {
    const email = currentUser?.email || signupForm.elements.email.value.trim() || signinForm.elements.email.value.trim();
    if (!email) {
      showMessage('Nhập email tài khoản trước khi gửi lại xác minh.', true);
      return;
    }
    resendButton.disabled = true;
    try {
      const { error } = await client.auth.resend({ type: 'signup', email });
      if (error) throw error;
      showMessage('Đã yêu cầu gửi lại email xác minh. Hãy kiểm tra cả Spam/Junk.');
    } catch (error) {
      showMessage(errorMessage(error), true);
    } finally {
      resendButton.disabled = false;
    }
  });

  document.querySelector('#profile-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!currentUser) return;
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const displayName = form.elements.display_name.value.trim();
    if (displayName.length < 2 || displayName.length > 60) {
      showOrdersMessage('Tên hiển thị cần từ 2 đến 60 ký tự.', true);
      return;
    }
    button.disabled = true;
    showOrdersMessage('Đang lưu hồ sơ…');
    try {
      const { data, error } = await client
        .from('profiles')
        .update({ display_name: displayName })
        .eq('id', currentUser.id)
        .select('display_name')
        .single();
      if (error) throw error;
      document.querySelector('#profile-greeting').textContent = data.display_name;
      const profileMessage = document.querySelector('#profile-message');
      profileMessage.textContent = 'Đã lưu hồ sơ.';
      profileMessage.classList.remove('is-error');
    } catch (error) {
      console.error('Could not update customer profile:', error);
      const profileMessage = document.querySelector('#profile-message');
      profileMessage.textContent = `Không lưu được hồ sơ: ${error.message}`;
      profileMessage.classList.add('is-error');
    } finally {
      button.disabled = false;
    }
  });

  document.querySelector('#close-cancellation-dialog').addEventListener('click', () => {
    cancellationDialog.close();
  });
  cancellationDialog.addEventListener('cancel', event => {
    if (document.querySelector('#submit-cancellation').disabled) event.preventDefault();
  });
  cancellationDialog.addEventListener('close', () => {
    cancellationForm.reset();
    const formMessage = document.querySelector('#cancellation-form-message');
    formMessage.textContent = '';
    formMessage.classList.remove('is-error');
    activeCancellationOrder = null;
  });

  cancellationForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!currentUser || !activeCancellationOrder) return;
    const button = document.querySelector('#submit-cancellation');
    const status = document.querySelector('#cancellation-form-message');
    const receipt = cancellationForm.elements.receipt.files[0];
    const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
    if (!receipt || !allowedTypes.has(receipt.type) || receipt.size < 1 || receipt.size > 5 * 1024 * 1024) {
      status.textContent = 'Bill phải là JPG, PNG, WebP hoặc PDF và có dung lượng tối đa 5 MB.';
      status.classList.add('is-error');
      return;
    }
    const reference = activeCancellationOrder.client_reference;
    const filePath = `${currentUser.id}/${reference}/transaction-bill`;
    const formControls = [...cancellationForm.querySelectorAll('input, textarea, button')];
    const request = {
      p_client_reference: reference,
      p_customer_name: cancellationForm.elements.customer_name.value.trim(),
      p_customer_email: cancellationForm.elements.customer_email.value.trim(),
      p_social_contact_url: cancellationForm.elements.social_contact_url.value.trim(),
      p_reason: cancellationForm.elements.reason.value.trim(),
      p_bank_name: cancellationForm.elements.bank_name.value.trim(),
      p_account_holder: cancellationForm.elements.account_holder.value.trim(),
      p_account_number: cancellationForm.elements.account_number.value.trim(),
      p_receipt_path: filePath
    };
    formControls.forEach(control => { control.disabled = true; });
    status.textContent = 'Đang tải bill riêng tư và gửi yêu cầu…';
    status.classList.remove('is-error');
    let uploadedPath = null;
    try {
      const { error: uploadError } = await client.storage
        .from('order-cancellation-bills')
        .upload(filePath, receipt, { contentType: receipt.type, upsert: false });
      if (uploadError) throw uploadError;
      uploadedPath = filePath;

      const { error } = await client.rpc('submit_order_cancellation', request);
      if (error) throw error;

      cancellationRequests.push({
        client_reference: reference,
        status: 'pending',
        created_at: new Date().toISOString()
      });
      cancellationRequestsReady = true;
      cancellationDialog.close();
      renderFilteredOrders();
      showOrdersMessage('Đã gửi yêu cầu hủy. Shop sẽ kiểm tra thông tin và bill giao dịch.');
      activeCancellationOrder = null;
    } catch (error) {
      console.error('Could not submit the customer cancellation request:', error);
      if (uploadedPath) {
        const { error: cleanupError } = await client.storage
          .from('order-cancellation-bills')
          .remove([uploadedPath]);
        if (cleanupError) console.error('Could not remove the unused private cancellation bill:', cleanupError);
      }
      status.textContent = `Không gửi được yêu cầu hủy: ${error.message}`;
      status.classList.add('is-error');
    } finally {
      formControls.forEach(control => { control.disabled = false; });
    }
  });

  document.querySelector('#account-signout').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const { error } = await client.auth.signOut();
      if (error) throw error;
      await handleSession(null);
      showMessage('Đã đăng xuất khỏi My AYS.');
    } catch (error) {
      showOrdersMessage(`Không đăng xuất được: ${error.message}`, true);
    } finally {
      button.disabled = false;
    }
  });

  client.auth.getSession()
    .then(({ data, error }) => {
      if (error) throw error;
      return handleSession(data.session);
    })
    .catch(error => {
      console.error('Could not load the customer account:', error);
      showMessage('Không tải được tài khoản. Hãy thử tải lại trang.', true);
    });
})();
