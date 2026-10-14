(() => {
  const form = document.querySelector('#admin-login-form');
  const message = document.querySelector('#admin-message');
  const signoutButton = document.querySelector('#admin-signout');
  const forgotPasswordButton = document.querySelector('#admin-forgot-password');
  const productsLink = document.querySelector('#admin-products-link');
  const ordersLink = document.querySelector('#admin-orders-link');
  const customersLink = document.querySelector('#admin-customers-link');
  const gachaLink = document.querySelector('#admin-gacha-link');
  const submitButton = form.querySelector('button[type="submit"]');
  const config = window.AYSSupabaseConfig;

  function showMessage(text, isError = false) {
    message.textContent = text;
    message.classList.toggle('is-error', isError);
  }

  if (!config?.url || !config.publishableKey || config.publishableKey === 'PASTE_YOUR_SUPABASE_PUBLISHABLE_KEY_HERE') {
    form.hidden = true;
    showMessage('Chưa cấu hình Supabase. Hãy kiểm tra js/supabase-config.js.', true);
    return;
  }

  if (!window.supabase?.createClient) {
    form.hidden = true;
    showMessage('Không tải được Supabase Auth. Hãy tải lại trang sau.', true);
    return;
  }

  const client = window.supabase.createClient(config.url, config.publishableKey);

  async function checkAdmin(session) {
    if (!session) {
      form.hidden = false;
      signoutButton.hidden = true;
      productsLink.hidden = true;
      ordersLink.hidden = true;
      customersLink.hidden = true;
      gachaLink.hidden = true;
      showMessage('');
      return;
    }

    form.hidden = true;
    showMessage('Đang kiểm tra quyền quản trị…');
    const { data, error } = await client.rpc('is_current_user_admin');
    if (error) {
      showMessage('Chưa xác minh được quyền admin. Hãy kiểm tra cấu hình database rồi thử lại.', true);
      signoutButton.hidden = false;
      productsLink.hidden = true;
      ordersLink.hidden = true;
      customersLink.hidden = true;
      gachaLink.hidden = true;
      return;
    }
    if (!data) {
      showMessage('Tài khoản này chưa được cấp quyền quản trị.', true);
      signoutButton.hidden = false;
      productsLink.hidden = true;
      ordersLink.hidden = true;
      customersLink.hidden = true;
      gachaLink.hidden = true;
      return;
    }

    signoutButton.hidden = false;
    productsLink.hidden = false;
    ordersLink.hidden = false;
    customersLink.hidden = false;
    gachaLink.hidden = false;
    showMessage('Đăng nhập quản trị thành công.');
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    submitButton.disabled = true;
    showMessage('Đang đăng nhập…');

    const formData = new FormData(form);
    const { data, error } = await client.auth.signInWithPassword({
      email: String(formData.get('email')).trim(),
      password: String(formData.get('password'))
    });

    submitButton.disabled = false;
    if (error) {
      showMessage('Đăng nhập thất bại. Kiểm tra email và mật khẩu rồi thử lại.', true);
      return;
    }
    await checkAdmin(data.session);
  });

  forgotPasswordButton.addEventListener('click', async () => {
    const email = String(new FormData(form).get('email') || '').trim();
    if (!email) {
      showMessage('Nhập email tài khoản admin trước, rồi chọn “Quên mật khẩu?”.', true);
      form.querySelector('[name="email"]').focus();
      return;
    }

    forgotPasswordButton.disabled = true;
    showMessage('Đang gửi email khôi phục…');
    const { error } = await client.auth.resetPasswordForEmail(email, {
      redirectTo: new URL('./reset-password.html', window.location.href).href
    });
    forgotPasswordButton.disabled = false;

    if (error) {
      showMessage('Không gửi được email khôi phục. Kiểm tra email và cấu hình Auth URL rồi thử lại.', true);
      return;
    }
    showMessage('Nếu email này có tài khoản, Supabase sẽ gửi hướng dẫn khôi phục. Kiểm tra cả mục Spam/Junk nhé.');
  });

  signoutButton.addEventListener('click', async () => {
    signoutButton.disabled = true;
    const { error } = await client.auth.signOut();
    signoutButton.disabled = false;
    if (error) {
      showMessage('Không thể đăng xuất. Vui lòng thử lại.', true);
      return;
    }
    await checkAdmin(null);
  });

  client.auth.getSession()
    .then(({ data, error }) => {
      if (error) throw error;
      return checkAdmin(data.session);
    })
    .catch(error => {
      console.error('Could not restore the admin session:', error);
      showMessage('Không thể kiểm tra phiên đăng nhập. Hãy tải lại trang.', true);
    });
})();
