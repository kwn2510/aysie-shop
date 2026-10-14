(() => {
  const config = window.AYSSupabaseConfig;
  const form = document.querySelector('#reset-form');
  const message = document.querySelector('#reset-message');
  const backLink = document.querySelector('#reset-back-link');
  let client;
  let recoverySessionAvailable = false;

  function showMessage(text, isError = false) {
    message.textContent = text;
    message.classList.toggle('is-error', isError);
  }

  if (!config?.url || !config.publishableKey || !window.supabase?.createClient) {
    form.hidden = true;
    showMessage('Chưa kết nối được Supabase. Hãy tải lại trang sau.', true);
    return;
  }

  client = window.AYSCustomerClient || window.supabase.createClient(config.url, config.publishableKey);
  window.AYSCustomerClient = client;
  client.auth.getSession()
    .then(({ data, error }) => {
      if (error) throw error;
      recoverySessionAvailable = Boolean(data.session);
      form.hidden = !recoverySessionAvailable;
      if (!recoverySessionAvailable) {
        showMessage('Liên kết khôi phục không hợp lệ hoặc đã hết hạn. Hãy yêu cầu email khôi phục mới từ trang My AYS.', true);
        backLink.hidden = false;
      } else {
        showMessage('');
      }
    })
    .catch(error => {
      console.error('Could not validate the password recovery link:', error);
      form.hidden = true;
      showMessage(`Không xác thực được liên kết: ${error.message}`, true);
      backLink.hidden = false;
    });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!recoverySessionAvailable) return;
    const password = form.elements.password.value;
    if (password.length < 8) {
      showMessage('Mật khẩu cần có ít nhất 8 ký tự.', true);
      return;
    }
    if (password !== form.elements.confirm_password.value) {
      showMessage('Hai mật khẩu chưa khớp nhau.', true);
      return;
    }
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    showMessage('Đang cập nhật mật khẩu…');
    try {
      const { error } = await client.auth.updateUser({ password });
      if (error) throw error;
      form.hidden = true;
      showMessage('Mật khẩu đã được cập nhật. Hãy đăng nhập lại bằng mật khẩu mới.');
      backLink.hidden = false;
    } catch (error) {
      showMessage(`Không cập nhật được mật khẩu: ${error.message}`, true);
    } finally {
      button.disabled = false;
    }
  });
})();
