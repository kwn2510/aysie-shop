(() => {
  const form = document.querySelector('#tracking-form');
  const referenceInput = document.querySelector('#tracking-reference');
  const emailInput = document.querySelector('#tracking-email');
  const message = document.querySelector('#tracking-message');
  const result = document.querySelector('#tracking-result');
  const statuses = {
    awaiting_review: 'Shop đang kiểm tra thanh toán',
    paid: 'Đã xác nhận thanh toán',
    fulfilled: 'Đã gửi file qua email',
    cancelled: 'Đơn hàng đã được hủy'
  };
  const referencePattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function formatDate(value) {
    return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  }

  function addProgressStep(list, label, state) {
    const item = document.createElement('li');
    item.textContent = label;
    if (state) item.classList.add(`is-${state}`);
    list.append(item);
  }

  function renderOrder(order) {
    result.replaceChildren();
    result.hidden = false;
    result.classList.toggle('is-cancelled', order.status === 'cancelled');

    const heading = document.createElement('h2');
    heading.textContent = statuses[order.status];
    result.append(heading);

    const dates = document.createElement('p');
    dates.textContent = `Đặt lúc ${formatDate(order.created_at)} · Cập nhật lần cuối ${formatDate(order.updated_at)}`;
    result.append(dates);

    if (order.status === 'cancelled') {
      const note = document.createElement('p');
      note.textContent = 'Nếu bạn cần hỗ trợ về đơn này, vui lòng liên hệ shop.';
      result.append(note);
      return;
    }

    const progress = document.createElement('ol');
    progress.className = 'tracking-progress';
    addProgressStep(progress, 'Đã ghi nhận đơn hàng', 'complete');
    if (order.status === 'awaiting_review') {
      addProgressStep(progress, 'Shop đang kiểm tra thanh toán', 'current');
      addProgressStep(progress, 'Shop gửi file qua email', '');
    } else if (order.status === 'paid') {
      addProgressStep(progress, 'Đã xác nhận thanh toán', 'complete');
      addProgressStep(progress, 'Shop gửi file qua email', 'current');
    } else {
      addProgressStep(progress, 'Đã xác nhận thanh toán', 'complete');
      addProgressStep(progress, 'Đã gửi file qua email', 'complete');
    }
    result.append(progress);
  }

  const referenceFromUrl = new URLSearchParams(window.location.search).get('reference');
  if (referenceFromUrl) referenceInput.value = referenceFromUrl;

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const reference = referenceInput.value.trim();
    const email = emailInput.value.trim();
    result.hidden = true;
    result.replaceChildren();
    message.classList.remove('is-error');

    if (!referencePattern.test(reference)) {
      message.textContent = 'Mã đơn chưa đúng định dạng. Hãy nhập mã đầy đủ trên màn hình xác nhận đơn.';
      message.classList.add('is-error');
      return;
    }

    const config = window.AYSSupabaseConfig;
    if (!config?.url || !config.publishableKey || !window.supabase?.createClient) {
      message.textContent = 'Hiện chưa thể kết nối để tra cứu. Vui lòng liên hệ shop qua email.';
      message.classList.add('is-error');
      return;
    }

    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    message.textContent = 'Đang tìm đơn hàng…';
    try {
      const client = window.AYSCustomerClient || window.supabase.createClient(config.url, config.publishableKey);
      window.AYSCustomerClient = client;
      const { data, error } = await client.rpc('track_order', {
        p_client_reference: reference,
        p_customer_email: email
      });
      if (error) throw error;
      if (!data?.length) {
        message.textContent = 'Không tìm thấy đơn khớp với mã và email này. Hãy kiểm tra lại hoặc liên hệ shop.';
        message.classList.add('is-error');
        return;
      }
      renderOrder(data[0]);
      message.textContent = 'Đã tìm thấy đơn hàng.';
    } catch (error) {
      console.error('Could not track order:', error);
      message.textContent = 'Chưa thể tra cứu lúc này. Vui lòng thử lại sau hoặc liên hệ shop.';
      message.classList.add('is-error');
    } finally {
      submitButton.disabled = false;
    }
  });
})();
