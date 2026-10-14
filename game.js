const startButton = document.querySelector('#start-game');
const gameMessage = document.querySelector('#game-message');
const accountLink = document.querySelector('#game-account-link');
const orb = document.querySelector('#gacha-orb');
const resultPanel = document.querySelector('#gacha-result');
const rewardList = document.querySelector('#gacha-reward-list');
const historyList = document.querySelector('#gacha-history-list');
let client;
let verifiedUser = false;
let busy = false;
let pendingRequestId = null;

function showMessage(text, isError = false) {
  gameMessage.textContent = text;
  gameMessage.classList.toggle('is-error', isError);
}

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function errorText(error) {
  const message = String(error?.message || '');
  if (message.includes('already received this month')) {
    return 'Bạn đã nhận mã giảm giá tháng này. Hãy quay lại vào tháng sau nhé!';
  }
  if (message.includes('used all of today')) {
    return 'Bạn đã dùng hết lượt hôm nay. Hẹn bạn vào ngày mai nhé!';
  }
  if (message.includes('current voucher')) {
    return 'Bạn đang có voucher chưa dùng. Hãy dùng hoặc đợi voucher hết hạn rồi quay lại.';
  }
  if (message.includes('not open right now')) {
    return 'Sự kiện Gacha Garden hiện chưa mở hoặc đã kết thúc.';
  }
  if (message.includes('rewards have run out')) {
    return 'Phần thưởng đã hết. Shop sẽ cập nhật sự kiện sau.';
  }
  return message || 'Không thể chơi lúc này. Vui lòng thử lại.';
}

function renderRewards(rewards) {
  rewardList.replaceChildren();
  if (!rewards.length) {
    rewardList.append(makeElement('p', 'gacha-reward', 'Hiện không còn phần thưởng khả dụng.'));
    return;
  }
  rewards.forEach(reward => {
    const card = makeElement('article', 'gacha-reward');
    card.append(
      makeElement('strong', '', reward.title),
      makeElement('p', '', reward.description)
    );
    rewardList.append(card);
  });
}

async function refreshState(showStatus = true) {
  const { data, error } = await client.rpc('get_customer_gacha_state');
  if (error) throw error;
  const state = data?.[0];
  if (!state) throw new Error('Không nhận được thông tin sự kiện từ máy chủ.');

  const dailyRemaining = Math.max(Number(state.daily_attempt_limit) - Number(state.plays_today), 0);
  const bonusPlays = Number(state.bonus_plays) || 0;
  const remaining = dailyRemaining + bonusPlays;
  document.querySelector('#plays-remaining').textContent =
    `${dailyRemaining} miễn phí + ${bonusPlays} thưởng`;
  document.querySelector('#event-status').textContent = state.event_active ? 'Đang mở' : 'Đóng';
  const eventDate = value => new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Ho_Chi_Minh'
  }).format(new Date(value));
  document.querySelector('#event-period').textContent =
    `Thời gian sự kiện: ${eventDate(state.starts_at)} – ${eventDate(state.ends_at)} (giờ Việt Nam)`;
  document.querySelector('#monthly-status').textContent =
    state.monthly_reward_available ? 'Còn lượt nhận mã' : 'Đã nhận mã tháng này';
  renderRewards(Array.isArray(state.reward_preview) ? state.reward_preview : []);

  const eligible = verifiedUser && state.event_active && remaining > 0
    && state.monthly_reward_available && !state.has_active_voucher;
  startButton.disabled = !eligible || busy;
  if (showStatus) {
    if (!state.event_active) showMessage('Sự kiện hiện không mở. Hãy xem thời gian sự kiện và quay lại sau.');
    else if (!state.monthly_reward_available) showMessage('Email của bạn đã nhận mã giảm giá tháng này. Bạn có thể chơi lại vào tháng sau.');
    else if (state.has_active_voucher) showMessage('Bạn đang có voucher chưa dùng trong Ví Voucher.');
    else if (remaining < 1) showMessage('Bạn đã dùng hết lượt hôm nay. Lượt mới sẽ mở lại theo giờ Việt Nam vào ngày mai.');
    else showMessage('Sẵn sàng rồi! Mỗi lượt mở quả cầu được ghi lại để shop hỗ trợ nếu có khiếu nại.');
  }
}

async function loadHistory() {
  const { data, error } = await client.rpc('get_my_gacha_history');
  if (error) throw error;
  historyList.replaceChildren();
  if (!data?.length) {
    historyList.append(makeElement('p', 'gacha-history-item', 'Bạn chưa có lượt chơi nào.'));
    return;
  }
  data.forEach(play => {
    const item = makeElement('article', 'gacha-history-item');
    item.append(
      makeElement('strong', '', play.reward_title),
      makeElement('p', '', play.result_message),
      makeElement('time', '', new Intl.DateTimeFormat('vi-VN', {
        dateStyle: 'medium',
        timeStyle: 'short'
      }).format(new Date(play.created_at)))
    );
    if (play.voucher_code) item.append(makeElement('code', 'voucher-code', play.voucher_code));
    historyList.append(item);
  });
}

function showResult(play) {
  const isVoucher = play.reward_type === 'voucher';
  document.querySelector('#result-emoji').textContent = isVoucher ? '🎁' : '🌱';
  document.querySelector('#result-title').textContent = play.reward_title;
  document.querySelector('#result-message').textContent = play.result_message;
  const code = document.querySelector('#voucher-code');
  code.textContent = play.voucher_code || '';
  code.hidden = !play.voucher_code;
  const note = document.querySelector('#voucher-note');
  note.textContent = play.voucher_code
    ? `Đã lưu vào My AYS · Hạn dùng ${new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium' }).format(new Date(play.expires_at))}.`
    : '';
  note.hidden = !play.voucher_code;
  resultPanel.classList.add('is-visible');
}

async function playGacha() {
  if (!verifiedUser || !client || busy) return;
  busy = true;
  startButton.disabled = true;
  resultPanel.classList.remove('is-visible');
  orb.classList.add('is-spinning');
  showMessage('Đang mở quả cầu và xác nhận phần thưởng an toàn…');
  try {
    if (!pendingRequestId) pendingRequestId = crypto.randomUUID();
    const { data, error } = await client.rpc('play_customer_gacha', {
      p_request_id: pendingRequestId
    });
    if (error) throw error;
    const play = data?.[0];
    if (!play?.play_id) throw new Error('Máy chủ chưa trả về kết quả lượt chơi.');
    pendingRequestId = null;
    await new Promise(resolve => window.setTimeout(resolve, 700));
    showResult(play);
    await Promise.all([refreshState(false), loadHistory()]);
    showMessage(play.voucher_code
      ? 'Chúc mừng bạn! Mã giảm giá đã được lưu vào Ví Voucher.'
      : 'Cảm ơn bạn đã chơi! Kết quả đã được lưu vào lịch sử.');
  } catch (error) {
    console.error('Could not play Gacha Garden:', error);
    showMessage(errorText(error), true);
    try {
      await refreshState(false);
    } catch (refreshError) {
      console.error('Could not refresh Gacha Garden state:', refreshError);
    }
  } finally {
    busy = false;
    orb.classList.remove('is-spinning');
    startButton.disabled = !verifiedUser;
    try {
      await refreshState(false);
    } catch (error) {
      console.error('Could not refresh Gacha Garden controls:', error);
    }
  }
}

async function initializeGame() {
  const config = window.AYSSupabaseConfig;
  startButton.disabled = true;
  if (!config?.url || !config.publishableKey || !window.supabase?.createClient) {
    showMessage('Chưa kết nối được tài khoản My AYS. Hãy tải lại trang sau.', true);
    accountLink.hidden = false;
    return;
  }

  client = window.AYSCustomerClient || window.supabase.createClient(config.url, config.publishableKey);
  window.AYSCustomerClient = client;
  try {
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    verifiedUser = Boolean(data.session?.user?.email_confirmed_at);
    if (!verifiedUser) {
      showMessage('Đăng nhập My AYS bằng email đã xác minh để xem lượt và tham gia.');
      accountLink.hidden = false;
      rewardList.replaceChildren(makeElement('p', 'gacha-reward', 'Đăng nhập để xem phần thưởng hiện có.'));
      historyList.replaceChildren(makeElement('p', 'gacha-history-item', 'Đăng nhập để xem lịch sử của bạn.'));
      return;
    }
    accountLink.hidden = true;
    await Promise.all([refreshState(), loadHistory()]);
  } catch (error) {
    console.error('Could not initialize Gacha Garden:', error);
    showMessage(errorText(error), true);
    accountLink.hidden = !verifiedUser;
  }
}

startButton.addEventListener('click', playGacha);
initializeGame();
