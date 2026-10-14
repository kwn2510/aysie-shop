(() => {
  const accountButton = document.querySelector('#customer-account-button');
  const notificationLink = document.querySelector('#header-notification-link');
  const config = window.AYSSupabaseConfig;
  if (!accountButton || !config?.url || !config.publishableKey || !window.supabase?.createClient) return;

  const client = window.AYSCustomerClient
    || window.supabase.createClient(config.url, config.publishableKey);
  window.AYSCustomerClient = client;

  function setCount(id, value) {
    const badge = document.getElementById(id);
    if (!badge) return;
    badge.textContent = String(value);
    badge.hidden = value < 1;
  }

  function readCount(storageKey) {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) || '[]');
      return Array.isArray(value) ? value.length : 0;
    } catch (error) {
      console.error(`Could not read ${storageKey} from browser storage:`, error);
      return 0;
    }
  }

  async function updateCustomerCounts(user) {
    if (!user) {
      setCount('cart-count', 0);
      setCount('wishlist-count', 0);
      setCount('header-notification-count', 0);
      return;
    }
    setCount('cart-count', readCount(`mori-cart:${user.id}`));
    setCount('wishlist-count', readCount(`ays-wishlist:${user.id}`));
    try {
      const { data, error } = await client
        .from('customer_notifications')
        .select('id')
        .is('read_at', null)
        .limit(100);
      if (error) throw error;
      const { data: vouchers, error: voucherError } = await client
        .from('customer_vouchers')
        .select('code,expires_at')
        .eq('status', 'active')
        .limit(100);
      if (voucherError) throw voucherError;
      const activeVouchers = (vouchers || []).filter(voucher =>
        voucher.expires_at && Date.parse(voucher.expires_at) > Date.now());
      setCount('header-notification-count', (data || []).length + activeVouchers.length);
    } catch (error) {
      console.error('Could not load customer header notification count:', error);
    }
  }

  const renderSession = session => {
    const user = session?.user;
    accountButton.href = user ? 'account.html' : 'account.html?next=index.html%23shop';
    accountButton.setAttribute('aria-label', user ? 'Mở tài khoản My AYS' : 'Đăng nhập hoặc đăng ký My AYS');
    accountButton.title = user ? 'Tài khoản My AYS' : 'Đăng nhập / Đăng ký';
    accountButton.classList.toggle('is-signed-in', Boolean(user));
    accountButton.innerHTML = user
      ? '<i class="fa-solid fa-user" aria-hidden="true"></i>'
      : '<span class="account-label-full">Đăng nhập / Đăng ký</span><span class="account-label-compact">Đăng nhập</span>';
    if (notificationLink) notificationLink.hidden = !user;
    updateCustomerCounts(user);
  };

  client.auth.onAuthStateChange((_event, session) => renderSession(session));
  client.auth.getSession()
    .then(({ data, error }) => {
      if (error) throw error;
      renderSession(data.session);
    })
    .catch(error => {
      console.error('Could not restore the customer header session:', error);
    });
})();
