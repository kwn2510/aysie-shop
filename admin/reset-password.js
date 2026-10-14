(() => {
  const form = document.querySelector('#admin-reset-form');
  const message = document.querySelector('#reset-message');
  const loginLink = document.querySelector('#reset-login-link');
  const submitButton = form.querySelector('button[type="submit"]');
  const config = window.AYSSupabaseConfig;
  let recoverySessionReady = false;

  function showMessage(text, isError = false) {
    message.textContent = text;
    message.classList.toggle('is-error', isError);
  }

  function showLoginLink() {
    loginLink.hidden = false;
  }

  if (!config?.url || !config.publishableKey || config.publishableKey === 'PASTE_YOUR_SUPABASE_PUBLISHABLE_KEY_HERE') {
    showMessage('Chưa cấu hình Supabase. Hãy kiểm tra js/supabase-config.js.', true);
    showLoginLink();
    return;
  }

  if (!window.supabase?.createClient) {
    showMessage('Không tải được Supabase Auth. Hãy tải lại trang sau.', true);
    showLoginLink();
    return;
  }

  const client = window.supabase.createClient(config.url, config.publishableKey);

  client.auth.onAuthStateChange(event => {
    if (event === 'PASSWORD_RECOVERY') {
      recoverySessionReady = true;
      form.hidden = false;
      showMessage('Đặt mật khẩu mới gồm ít nhất 8 ký tự.');
    }
  });

  client.auth.getSession()
    .then(({ data, error }) => {
      if (error) throw error;
      if (data.session && window.location.hash.includes('type=recovery')) {
        recoverySessionReady = true;
        form.hidden = false;
        showMessage('Đặt mật khẩu mới gồm ít nhất 8 ký tự.');
        return;
      }
      if (!recoverySessionReady) {
        showMessage('Link khôi phục không hợp lệ hoặc đã hết hạn. Hãy yêu cầu gửi email khôi phục mới.', true);
        showLoginLink();
      }
    })
    .catch(error => {
      console.error('Could not validate the password recovery link:', error);
      showMessage('Không xác thực được link khôi phục. Hãy yêu cầu gửi email mới.', true);
      showLoginLink();
    });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!recoverySessionReady) {
      showMessage('Link khôi phục chưa được xác thực. Hãy mở lại link mới nhất trong email.', true);
      return;
    }

    const password = form.elements.password.value;
    const confirmPassword = form.elements.confirmPassword.value;
    if (password.length < 8) {
      showMessage('Mật khẩu mới cần ít nhất 8 ký tự.', true);
      return;
    }
    if (password !== confirmPassword) {
      showMessage('Hai mật khẩu chưa khớp. Hãy kiểm tra và nhập lại.', true);
      return;
    }

    submitButton.disabled = true;
    showMessage('Đang cập nhật mật khẩu…');
    const { error } = await client.auth.updateUser({ password });
    submitButton.disabled = false;

    if (error) {
      showMessage('Không cập nhật được mật khẩu. Link có thể đã hết hạn; hãy gửi email khôi phục mới.', true);
      return;
    }

    recoverySessionReady = false;
    form.hidden = true;
    showMessage('Đã đổi mật khẩu thành công. Bạn có thể đăng nhập bằng mật khẩu mới.');
    showLoginLink();
  });
})();
