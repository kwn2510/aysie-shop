(() => {
  const config = window.AYSSupabaseConfig;
  const message = document.querySelector('#reviews-admin-message');
  const list = document.querySelector('#admin-review-list');
  const reloadButton = document.querySelector('#reload-reviews');
  const signoutButton = document.querySelector('#reviews-signout');
  const viewButtons = [...document.querySelectorAll('[data-review-view]')];
  let client;
  let busy = false;
  let reviews = [];
  let activeView = 'pending';
  const statuses = {
    pending: 'Chờ duyệt',
    approved: 'Đã duyệt',
    rejected: 'Đã từ chối'
  };

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
    list.querySelectorAll('button').forEach(button => { button.disabled = value; });
  }

  async function loadReviews() {
    showMessage('Đang tải đánh giá…');
    const pageSize = 1000;
    const loadedReviews = [];
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await client
        .from('product_reviews')
        .select('id,display_name,product_name,rating,comment,status,created_at')
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      loadedReviews.push(...data);
      if (data.length < pageSize) break;
    }

    reviews = loadedReviews;
    renderReviews();
  }

  function renderReviews() {
    const visibleReviews = reviews.filter(review => review.status === activeView);
    list.replaceChildren();
    if (!visibleReviews.length) {
      const emptyMessages = {
        pending: 'Không có đánh giá nào đang chờ duyệt.',
        approved: 'Chưa có đánh giá nào được duyệt.',
        rejected: 'Chưa có đánh giá nào bị từ chối.'
      };
      list.append(makeElement('p', 'admin-empty', emptyMessages[activeView]));
    }

    visibleReviews.forEach(review => {
      const card = makeElement('article', 'admin-review-card');
      const header = makeElement('div', 'admin-review-card-header');
      const title = makeElement('div', 'admin-review-title');
      title.append(makeElement('strong', '', review.display_name));
      if (review.product_name) title.append(makeElement('span', '', review.product_name));
      const status = makeElement('span', `admin-status admin-status-${review.status}`, statuses[review.status] || review.status);
      header.append(title, status);

      const meta = makeElement(
        'p',
        'admin-review-meta',
        `${'★'.repeat(review.rating)}${'☆'.repeat(5 - review.rating)} · ${new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(review.created_at))}`
      );
      const comment = makeElement('p', 'admin-review-comment', review.comment);
      const actions = makeElement('div', 'admin-review-actions');

      if (review.status !== 'approved') {
        const approveButton = makeElement('button', 'admin-signout', 'Duyệt');
        approveButton.type = 'button';
        approveButton.addEventListener('click', () => updateStatus(review.id, 'approved'));
        actions.append(approveButton);
      }
      if (review.status !== 'rejected') {
        const rejectButton = makeElement('button', 'admin-danger-button', 'Từ chối');
        rejectButton.type = 'button';
        rejectButton.addEventListener('click', () => updateStatus(review.id, 'rejected'));
        actions.append(rejectButton);
      }

      card.append(header, meta, comment, actions);
      list.append(card);
    });
    const counts = {
      pending: reviews.filter(review => review.status === 'pending').length,
      approved: reviews.filter(review => review.status === 'approved').length,
      rejected: reviews.filter(review => review.status === 'rejected').length
    };
    const labels = { pending: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Đã từ chối' };
    viewButtons.forEach(button => {
      const isActive = button.dataset.reviewView === activeView;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
      button.textContent = `${labels[button.dataset.reviewView]} (${counts[button.dataset.reviewView]})`;
    });
    showMessage(`Hiển thị ${visibleReviews.length} / ${reviews.length} đánh giá`);
  }

  async function updateStatus(id, status) {
    if (busy) return;
    setBusy(true);
    try {
      const { error } = await client
        .from('product_reviews')
        .update({ status })
        .eq('id', id);
      if (error) throw error;
      await loadReviews();
      showMessage(status === 'approved' ? 'Đã duyệt đánh giá.' : 'Đã từ chối đánh giá.');
    } catch (error) {
      console.error('Could not moderate product review:', error);
      showMessage(`Không cập nhật được đánh giá: ${error.message}`, true);
    } finally {
      setBusy(false);
    }
  }

  reloadButton.addEventListener('click', async () => {
    if (busy) return;
    setBusy(true);
    try {
      await loadReviews();
    } catch (error) {
      console.error('Could not load product reviews:', error);
      showMessage(`Không tải được đánh giá: ${error.message}`, true);
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
      if (busy || button.dataset.reviewView === activeView) return;
      activeView = button.dataset.reviewView;
      renderReviews();
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

    await loadReviews();
  }

  initialize().catch(error => {
    console.error('Could not initialize review moderation:', error);
    showMessage(`Không mở được trang duyệt đánh giá: ${error.message}`, true);
  });
})();
