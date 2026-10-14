(() => {
  const config = window.AYSSupabaseConfig;
  const message = document.querySelector('#gacha-admin-message');
  const eventForm = document.querySelector('#gacha-event-form');
  const rewardsList = document.querySelector('#admin-gacha-rewards');
  const historyList = document.querySelector('#admin-gacha-history');
  const signoutButton = document.querySelector('#gacha-admin-signout');
  let client;

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

  function asVietnamLocal(value) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(new Date(value));
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
  }

  function fromVietnamLocal(value) {
    return new Date(`${value}:00+07:00`).toISOString();
  }

  function setBusy(busy) {
    document.querySelectorAll('.admin-gacha-panel button, .admin-gacha-panel input, .admin-gacha-panel select')
      .forEach(control => { control.disabled = busy; });
    signoutButton.disabled = busy;
  }

  async function loadEvent() {
    const { data, error } = await client
      .from('customer_gacha_events')
      .select('is_active,starts_at,ends_at,daily_attempt_limit')
      .eq('id', 1)
      .single();
    if (error) throw error;
    document.querySelector('#gacha-event-active').checked = data.is_active;
    document.querySelector('#gacha-event-start').value = asVietnamLocal(data.starts_at);
    document.querySelector('#gacha-event-end').value = asVietnamLocal(data.ends_at);
    document.querySelector('#gacha-daily-limit').value = String(data.daily_attempt_limit);
  }

  function renderReward(reward) {
    const card = makeElement('article', 'admin-gacha-reward');
    const title = makeElement('h3', '', reward.title);
    const form = document.createElement('form');
    form.className = 'admin-gacha-reward-form';

    const addField = (labelText, name, type, value, attributes = {}) => {
      const label = makeElement('label', '', labelText);
      const input = document.createElement(type === 'select' ? 'select' : 'input');
      if (type !== 'select') input.type = type;
      if (type === 'checkbox') label.classList.add('admin-gacha-checkbox');
      input.dataset.field = name;
      if (type === 'select') {
        [['none', 'Không trúng / quà thường'], ['voucher', 'Voucher']].forEach(([key, text]) => {
          const option = makeElement('option', '', text);
          option.value = key;
          option.selected = key === value;
          input.append(option);
        });
      } else if (type === 'checkbox') {
        input.checked = Boolean(value);
      } else {
        input.value = value ?? '';
      }
      Object.entries(attributes).forEach(([key, attributeValue]) => input.setAttribute(key, attributeValue));
      label.append(input);
      form.append(label);
      return input;
    };

    addField('Tên', 'title', 'text', reward.title, { maxlength: '100', required: 'required' });
    addField('Mô tả', 'description', 'text', reward.description, { maxlength: '300', required: 'required' });
    addField('Loại phần thưởng', 'reward_type', 'select', reward.reward_type);
    addField('Trọng số', 'probability_weight', 'number', reward.probability_weight, { min: '1', max: '1000000', required: 'required' });
    addField('Giới hạn tổng số', 'inventory_limit', 'number', reward.inventory_limit, { min: '0', max: '1000000' });
    addField('Đã phát', 'awarded_count', 'text', `${reward.awarded_count} (chỉ đọc)`, { readonly: 'readonly' });
    addField('Mức giảm voucher (%)', 'discount_percent', 'number', reward.discount_percent, { min: '1', max: '100' });
    addField('Đang phát hành', 'is_active', 'checkbox', reward.is_active);
    const save = makeElement('button', 'admin-signout', 'Lưu phần thưởng');
    save.type = 'submit';
    form.append(save);
    form.addEventListener('submit', event => {
      event.preventDefault();
      updateReward(reward.id, form, save);
    });
    card.append(title, form);
    return card;
  }

  async function loadRewards() {
    const { data, error } = await client
      .from('customer_gacha_rewards')
      .select('id,title,description,reward_type,probability_weight,inventory_limit,awarded_count,discount_percent,is_active')
      .order('title');
    if (error) throw error;
    rewardsList.replaceChildren();
    if (!data?.length) {
      rewardsList.append(makeElement('p', 'admin-empty', 'Chưa có phần thưởng nào.'));
      return;
    }
    data.forEach(reward => rewardsList.append(renderReward(reward)));
  }

  async function updateReward(rewardId, form, button) {
    const values = Object.fromEntries([...form.querySelectorAll('[data-field]')].map(input => [
      input.dataset.field,
      input.type === 'checkbox' ? input.checked : input.value
    ]));
    const discount = values.reward_type === 'voucher' ? Number(values.discount_percent) : null;
    const stock = values.inventory_limit === '' ? null : Number(values.inventory_limit);
    if (!Number.isInteger(Number(values.probability_weight)) || Number(values.probability_weight) < 1
      || (values.reward_type === 'voucher' && (!Number.isInteger(discount) || discount < 1 || discount > 100))
      || (stock !== null && (!Number.isInteger(stock) || stock < Number(form.querySelector('[data-field="awarded_count"]').value.split(' ')[0])))) {
      showMessage('Kiểm tra trọng số, mức giảm và số lượng còn lại trước khi lưu.', true);
      return;
    }
    button.disabled = true;
    try {
      const { error } = await client
        .from('customer_gacha_rewards')
        .update({
          title: values.title.trim(),
          description: values.description.trim(),
          reward_type: values.reward_type,
          probability_weight: Number(values.probability_weight),
          inventory_limit: stock,
          discount_percent: discount,
          is_active: values.is_active,
          updated_at: new Date().toISOString()
        })
        .eq('id', rewardId);
      if (error) throw error;
      await loadRewards();
      showMessage('Đã lưu cấu hình phần thưởng. Trọng số chỉ được máy chủ dùng để chọn kết quả.');
    } catch (error) {
      console.error('Could not update Gacha Garden reward:', error);
      showMessage(`Không lưu được phần thưởng: ${error.message}`, true);
    } finally {
      button.disabled = false;
    }
  }

  async function addReward(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const rewardType = document.querySelector('#new-reward-type').value;
    const percentField = document.querySelector('#new-reward-discount');
    const inventoryValue = document.querySelector('#new-reward-inventory').value;
    const discount = rewardType === 'voucher' ? Number(percentField.value) : null;
    if (rewardType === 'voucher' && (!Number.isInteger(discount) || discount < 1 || discount > 100)) {
      showMessage('Phần thưởng voucher cần mức giảm từ 1% đến 100%.', true);
      percentField.focus();
      return;
    }
    button.disabled = true;
    try {
      const { error } = await client.from('customer_gacha_rewards').insert({
        reward_key: `reward-${crypto.randomUUID()}`,
        title: document.querySelector('#new-reward-title').value.trim(),
        description: document.querySelector('#new-reward-description').value.trim(),
        reward_type: rewardType,
        probability_weight: Number(document.querySelector('#new-reward-weight').value),
        inventory_limit: inventoryValue === '' ? null : Number(inventoryValue),
        discount_percent: discount
      });
      if (error) throw error;
      form.reset();
      document.querySelector('#new-reward-weight').value = '10';
      await loadRewards();
      showMessage('Đã thêm phần thưởng mới.');
    } finally {
      button.disabled = false;
    }
  }

  async function loadHistory() {
    const { data, error } = await client.rpc('get_admin_gacha_history', { p_limit: 100 });
    if (error) throw error;
    historyList.replaceChildren();
    if (!data?.length) {
      historyList.append(makeElement('p', 'admin-empty', 'Chưa có lượt chơi nào.'));
      return;
    }
    data.forEach(play => {
      const card = makeElement('article', 'admin-gacha-history-card');
      card.append(
        makeElement('strong', '', `${play.display_name || play.user_email} · ${play.reward_title}`),
        makeElement('p', '', play.user_email),
        makeElement('p', '', play.result_message),
        makeElement('time', '', new Intl.DateTimeFormat('vi-VN', {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: 'Asia/Ho_Chi_Minh'
        }).format(new Date(play.created_at)))
      );
      if (play.voucher_code) card.append(makeElement('code', '', play.voucher_code));
      historyList.append(card);
    });
  }

  eventForm.addEventListener('submit', async event => {
    event.preventDefault();
    const start = document.querySelector('#gacha-event-start').value;
    const end = document.querySelector('#gacha-event-end').value;
    const startAt = new Date(`${start}:00+07:00`);
    const endAt = new Date(`${end}:00+07:00`);
    if (!start || !end || !Number.isFinite(startAt.getTime()) || endAt <= startAt) {
      showMessage('Chọn thời gian hợp lệ; thời điểm kết thúc phải sau thời điểm bắt đầu.', true);
      return;
    }
    setBusy(true);
    try {
      const { error } = await client
        .from('customer_gacha_events')
        .update({
          is_active: document.querySelector('#gacha-event-active').checked,
          starts_at: startAt.toISOString(),
          ends_at: endAt.toISOString(),
          daily_attempt_limit: Number(document.querySelector('#gacha-daily-limit').value),
          updated_at: new Date().toISOString()
        })
        .eq('id', 1);
      if (error) throw error;
      showMessage('Đã lưu thời gian và giới hạn sự kiện.');
    } catch (error) {
      console.error('Could not update Gacha Garden event:', error);
      showMessage(`Không lưu được sự kiện: ${error.message}`, true);
    } finally {
      setBusy(false);
    }
  });

  document.querySelector('#gacha-new-reward-form').addEventListener('submit', event => {
    addReward(event).catch(error => {
      console.error('Could not add Gacha Garden reward:', error);
      showMessage(`Không thêm được phần thưởng: ${error.message}`, true);
    });
  });

  document.querySelector('#new-reward-type').addEventListener('change', event => {
    const percentField = document.querySelector('#new-reward-discount');
    percentField.required = event.currentTarget.value === 'voucher';
    percentField.disabled = event.currentTarget.value !== 'voucher';
    if (percentField.disabled) percentField.value = '';
  });

  document.querySelector('#gacha-credit-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const email = document.querySelector('#credit-email').value.trim();
    const expiresInput = document.querySelector('#credit-expires').value;
    button.disabled = true;
    try {
      const { data: userId, error: lookupError } = await client.rpc(
        'get_admin_customer_id_by_email',
        { p_email: email }
      );
      if (lookupError) throw lookupError;
      const { error } = await client.from('customer_gacha_bonus_credits').insert({
        user_id: userId,
        event_id: 1,
        source: document.querySelector('#credit-source').value,
        description: document.querySelector('#credit-description').value.trim(),
        amount: Number(document.querySelector('#credit-amount').value),
        remaining: Number(document.querySelector('#credit-amount').value),
        expires_at: expiresInput ? fromVietnamLocal(expiresInput) : null
      });
      if (error) throw error;
      form.reset();
      document.querySelector('#credit-amount').value = '1';
      showMessage(`Đã cấp lượt thưởng cho ${email}.`);
    } catch (error) {
      console.error('Could not grant Gacha Garden bonus turns:', error);
      showMessage(`Không cấp được lượt thưởng: ${error.message}`, true);
    } finally {
      button.disabled = false;
    }
  });

  document.querySelector('#reload-gacha-admin').addEventListener('click', () => {
    loadAll().catch(error => {
      console.error('Could not reload Gacha Garden admin data:', error);
      showMessage(`Không tải lại được dữ liệu: ${error.message}`, true);
    });
  });
  document.querySelector('#reload-gacha-history').addEventListener('click', () => {
    loadHistory().catch(error => {
      console.error('Could not reload Gacha Garden history:', error);
      showMessage(`Không tải lại được lịch sử: ${error.message}`, true);
    });
  });
  signoutButton.addEventListener('click', async () => {
    signoutButton.disabled = true;
    const { error } = await client.auth.signOut();
    if (error) {
      signoutButton.disabled = false;
      showMessage(`Không đăng xuất được: ${error.message}`, true);
      return;
    }
    window.location.replace('./index.html');
  });

  async function loadAll() {
    showMessage('Đang tải cấu hình và lịch sử…');
    await Promise.all([loadEvent(), loadRewards(), loadHistory()]);
    showMessage('Đã tải cấu hình Gacha Garden.');
  }

  async function initialize() {
    if (!config?.url || !config.publishableKey || !window.supabase?.createClient) {
      throw new Error('Supabase chưa được cấu hình.');
    }
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
    await loadAll();
  }

  initialize().catch(error => {
    console.error('Could not initialize Gacha Garden admin:', error);
    showMessage(`Không mở được quản trị Gacha Garden: ${error.message}`, true);
  });
})();
