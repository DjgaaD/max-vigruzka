import React from 'react';
import ReactDOM from 'react-dom/client';
import { MaxUI, Button } from '@maxhub/max-ui';
import '@maxhub/max-ui/dist/styles.css';
import axios from 'axios';

declare global {
  interface Window {
    WebApp?: {
      ready: () => void;
      initData?: string;
      initDataUnsafe?: {
        user?: {
          id: number;
          first_name?: string;
          last_name?: string;
          username?: string;
        };
      };
    };
  }
}

type Role = 'customer' | 'loader' | 'admin';

interface BackendUser {
  id: number;
  max_user_id: number;
  role: Role;
  first_name?: string;
  last_name?: string;
  username?: string;
  rating_avg?: number | null;
  rating_count?: number;
  created_at?: string;
}

interface Auction {
  id: number;
  title: string;
  description: string | null;
  street?: string | null;
  house?: string | null;
  flat?: string | null;
  date_time: string;
  auction_ends_at: string;
  status: string;
  winner_loader_id?: number | null;
  payment_status?: 'waiting_payment' | 'paid' | 'completed' | null;
  loader_marked_done?: boolean;
  customer_confirmed_done?: boolean;
}

interface AuctionWithCustomer extends Auction {
  first_name?: string;
  last_name?: string;
  username?: string;
  bids_count?: number;
}

const API_BASE = '/api';

type MaxUser = { id: number; first_name?: string; last_name?: string; username?: string };

function getStartParam(): string | null {
  try {
    const w = window as any;
    const fromUnsafe = w.WebApp?.initDataUnsafe?.start_param;
    if (typeof fromUnsafe === 'string' && fromUnsafe) return fromUnsafe;
  } catch {
    // ignore
  }
  try {
    if (typeof location !== 'undefined') {
      const sp = new URLSearchParams(location.search);
      const p1 = sp.get('WebAppStartParam') || sp.get('startapp');
      if (p1) return p1;
      const hash = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;
      const spHash = new URLSearchParams(hash);
      const p2 = spHash.get('WebAppStartParam') || spHash.get('startapp');
      if (p2) return p2;
    }
  } catch {
    // ignore
  }
  return null;
}

function todayYYYYMMDD(): string {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function isPastDate(yyyyMmDd: string): boolean {
  return yyyyMmDd < todayYYYYMMDD();
}

function formatDateDisplay(yyyyMmDd: string): string {
  if (!yyyyMmDd) return '';
  const [y, m, d] = yyyyMmDd.split('-');
  return `${d}.${m}.${y}`;
}

function formatCreatedAt(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}.${month}.${year}`;
}

/** Текущее время, округлённое вверх до следующего получаса, в формате HH:MM */
function currentTimeSlotHHMM(): string {
  const d = new Date();
  const m = d.getMinutes();
  const roundUp = m > 0 || d.getSeconds() > 0 ? 30 - (m % 30) : 0;
  const next = new Date(d.getTime() + roundUp * 60 * 1000);
  return String(next.getHours()).padStart(2, '0') + ':' + String(next.getMinutes()).padStart(2, '0');
}

/** Список времени (30 мин) для даты: прошедшие слоты отфильтрованы */
function getTimeOptionsForDate(timeOptions: string[], dateYYYYMMDD: string): string[] {
  const today = todayYYYYMMDD();
  if (dateYYYYMMDD < today) return timeOptions;
  if (dateYYYYMMDD > today) return timeOptions;
  const minTime = currentTimeSlotHHMM();
  return timeOptions.filter((t) => t >= minTime);
}

/** Для времени окончания поиска: если дата поиска = дате работ, показываем только слоты не позже (workTime − 90 мин) */
function getTimeOptionsForSearchEnd(
  timeOptions: string[],
  searchEndDate: string,
  workDate: string,
  workTime: string
): string[] {
  let opts = getTimeOptionsForDate(timeOptions, searchEndDate);
  if (searchEndDate !== workDate || !workTime) return opts;
  const [wh, wm] = workTime.split(':').map(Number);
  const totalMins = wh * 60 + wm - 90;
  const maxH = Math.floor(totalMins / 60);
  const maxM = totalMins % 60;
  const maxTime = String(maxH).padStart(2, '0') + ':' + (maxM >= 30 ? '30' : '00');
  if (totalMins < 0) return [];
  return opts.filter((t) => t <= maxTime);
}

/** Дни календаря для месяца. minDate — даты раньше неё считаются прошедшими (по умолчанию сегодня). */
function getCalendarDays(year: number, month: number, minDate?: string) {
  const first = new Date(year, month - 1, 1);
  const last = new Date(year, month, 0);
  const startWeekday = first.getDay();
  const daysInMonth = last.getDate();
  const min = minDate || todayYYYYMMDD();
  const out: { date: string; day: number; isCurrentMonth: boolean; isPast: boolean }[] = [];
  const pad = (n: number) => String(n).padStart(2, '0');
  for (let i = 0; i < startWeekday; i++) {
    const d = new Date(year, month - 1, 1 - (startWeekday - i));
    out.push({
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      day: d.getDate(),
      isCurrentMonth: false,
      isPast: true
    });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${year}-${pad(month)}-${pad(d)}`;
    out.push({ date, day: d, isCurrentMonth: true, isPast: date < min });
  }
  const rest = 42 - out.length;
  for (let i = 1; i <= rest; i++) {
    const next = new Date(year, month, i);
    const date = `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}`;
    out.push({ date, day: next.getDate(), isCurrentMonth: false, isPast: date < min });
  }
  return out;
}

/** Разбираем user из строки вида initData/WebAppData:
 *  - сама строка может быть закодирована (WebAppData=chat%3D...&user%3D...)
 *  - внутри user лежит JSON, который может быть закодирован 1–2 раза
 */
function parseUserFromInitLike(initLike: string | undefined): MaxUser | null {
  if (!initLike || typeof initLike !== 'string') return null;

  let current = initLike;
  for (let step = 0; step < 3; step++) {
    try {
      const params = new URLSearchParams(current);
      let userStr = params.get('user');
      if (!userStr) {
        // если нет user, попробуем дальше декодировать всю строку
        throw new Error('no user param');
      }

      for (let i = 0; i < 3; i++) {
        try {
          const obj = JSON.parse(userStr) as { id?: number; first_name?: string; last_name?: string; username?: string };
          if (obj && typeof obj.id === 'number') {
            return {
              id: obj.id,
              first_name: obj.first_name,
              last_name: obj.last_name,
              username: obj.username
            };
          }
        } catch {
          // возможно, userStr всё ещё закодирован
        }
        try {
          const decodedUser = decodeURIComponent(userStr);
          if (decodedUser === userStr) break;
          userStr = decodedUser;
        } catch {
          break;
        }
      }
    } catch {
      // попробуем раскодировать всю строку ещё раз и повторить попытку
    }

    try {
      const decodedWhole = decodeURIComponent(current);
      if (decodedWhole === current) break;
      current = decodedWhole;
    } catch {
      break;
    }
  }

  return null;
}

function getMaxUser(): MaxUser | null {
  const w = window.WebApp;
  const fromUnsafe = w?.initDataUnsafe?.user ?? null;
  if (fromUnsafe) return fromUnsafe;
  const fromInitData = parseUserFromInitLike(w?.initData);
  if (fromInitData) return fromInitData;
  if (typeof location !== 'undefined') {
    const qs = location.search.startsWith('?') ? location.search.slice(1) : location.search;
    const hash = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;
    const spQs = new URLSearchParams(qs);
    const spHash = new URLSearchParams(hash);

    // Вариант 1: initData в query/hash
    const initDataParam = spQs.get('initData') || spHash.get('initData');
    if (initDataParam) {
      const u = parseUserFromInitLike(initDataParam);
      if (u) return u;
    }

    // Вариант 2: MAX присылает всё в WebAppData (как в твоём href)
    const webAppDataParam = spQs.get('WebAppData') || spHash.get('WebAppData');
    if (webAppDataParam) {
      const u = parseUserFromInitLike(webAppDataParam);
      if (u) return u;
    }

    // Вариант 3: вся строка целиком похожа на initData/WebAppData
    const u2 = parseUserFromInitLike(qs || hash);
    if (u2) return u2;
  }
  return null;
}

interface AdminUser {
  id: number;
  max_user_id: number;
  role: string;
  first_name?: string;
  last_name?: string;
  username?: string;
  rating_avg?: number | null;
  rating_count?: number;
  created_at?: string;
  is_blocked?: boolean;
  block_reason?: string | null;
  block_until?: string | null;
  auctions_count?: number;
  bids_count?: number;
  active_orders_count?: number;
}

interface AdminStats {
  users_total: number;
  customers_count: number;
  loaders_count: number;
  auctions_total: number;
  auctions_active: number;
  bids_total: number;
  ratings_total: number;
  service_fee_percent?: number;
}

interface AdminAuctionBidDetail {
  id: number;
  auction_id: number;
  loader_id: number;
  amount: number;
  created_at: string;
  loader: {
    id: number;
    first_name?: string;
    last_name?: string;
    username?: string;
    rating_avg?: number | null;
    rating_count?: number;
  };
}

interface AdminAuctionDetail {
  auction: {
    id: number;
    title: string;
    description: string | null;
    cargo_params: any;
    date_time: string;
    auction_ends_at: string;
    status: string;
    created_at: string;
  };
  customer: {
    id: number;
    first_name?: string;
    last_name?: string;
    username?: string;
    rating_avg?: number | null;
    rating_count?: number;
  };
  bids: AdminAuctionBidDetail[];
  leader_bid?: AdminAuctionBidDetail | null;
  winner_bid?: AdminAuctionBidDetail | null;
}

type AdminAuth = { type: 'max'; backendUser: BackendUser } | { type: 'token'; token: string };

interface AdminAuctionSummary extends Auction {
  first_name?: string;
  last_name?: string;
  username?: string;
  bids_count?: number;
}

function adminAuthConfig(auth: AdminAuth): { params?: { admin_user_id: number }; headers?: { Authorization: string } } {
  if (auth.type === 'max') return { params: { admin_user_id: auth.backendUser.id } };
  return { headers: { Authorization: `Bearer ${auth.token}` } };
}

const AdminPanel: React.FC<{ auth: AdminAuth; onError: (s: string | null) => void }> = ({ auth, onError }) => {
  const [users, setUsers] = React.useState<AdminUser[]>([]);
  const [stats, setStats] = React.useState<AdminStats | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [detailId, setDetailId] = React.useState<number | null>(null);
  const [detail, setDetail] = React.useState<{ user: AdminUser; auctions: Auction[]; bids: unknown[] } | null>(null);
  const [blockModal, setBlockModal] = React.useState<{ userId: number; blocked: boolean; reason: string; until: string } | null>(null);
  const [blockSending, setBlockSending] = React.useState(false);
  const [auctionDetail, setAuctionDetail] = React.useState<AdminAuctionDetail | null>(null);
  const [broadcastRole, setBroadcastRole] = React.useState<'customer' | 'loader'>('loader');
  const [broadcastText, setBroadcastText] = React.useState('');
  const [broadcastSending, setBroadcastSending] = React.useState(false);
  const [serviceFee, setServiceFee] = React.useState<string>('');
  const [serviceFeeSaving, setServiceFeeSaving] = React.useState(false);
  const [tab, setTab] = React.useState<'users' | 'active' | 'completed'>('users');
  const [adminActiveAuctions, setAdminActiveAuctions] = React.useState<AdminAuctionSummary[]>([]);
  const [adminCompletedAuctions, setAdminCompletedAuctions] = React.useState<AdminAuctionSummary[]>([]);

  const authConfig = React.useMemo(() => adminAuthConfig(auth), [auth.type, auth.type === 'max' ? auth.backendUser.id : auth.token]);

  const loadUsers = React.useCallback(async () => {
    try {
      const res = await axios.get<{ users: AdminUser[] }>(`${API_BASE}/admin/users`, authConfig);
      setUsers(res.data.users);
    } catch {
      onError('Не удалось загрузить список пользователей.');
    }
  }, [authConfig, onError]);

  const loadStats = React.useCallback(async () => {
    try {
      const res = await axios.get<AdminStats>(`${API_BASE}/admin/stats`, authConfig);
      setStats(res.data);
      if (res.data.service_fee_percent != null) {
        setServiceFee(String(res.data.service_fee_percent));
      }
    } catch {
      onError('Не удалось загрузить статистику.');
    }
  }, [authConfig, onError]);

  const loadAdminAuctions = React.useCallback(async () => {
    try {
      const [activeRes, completedRes] = await Promise.all([
        axios.get<{ auctions: AdminAuctionSummary[] }>(`${API_BASE}/admin/auctions/active`, authConfig),
        axios.get<{ auctions: AdminAuctionSummary[] }>(`${API_BASE}/admin/auctions/completed`, authConfig)
      ]);
      setAdminActiveAuctions(activeRes.data.auctions);
      setAdminCompletedAuctions(completedRes.data.auctions);
    } catch {
      onError('Не удалось загрузить список заявок.');
    }
  }, [authConfig, onError]);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await Promise.all([loadUsers(), loadStats(), loadAdminAuctions()]);
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [loadUsers, loadStats, loadAdminAuctions]);

  const openDetail = async (id: number) => {
    try {
      const res = await axios.get<{ user: AdminUser; auctions: Auction[]; bids: unknown[] }>(
        `${API_BASE}/admin/users/${id}`,
        authConfig
      );
      setDetailId(id);
      setDetail(res.data);
    } catch {
      onError('Не удалось загрузить данные пользователя.');
    }
  };

  const submitBlock = async () => {
    if (!blockModal) return;
    setBlockSending(true);
    try {
      await axios.post(
        `${API_BASE}/admin/users/${blockModal.userId}/block`,
        { blocked: blockModal.blocked, reason: blockModal.reason || undefined, until: blockModal.until || undefined },
        authConfig
      );
      setBlockModal(null);
      await loadUsers();
      if (detailId === blockModal.userId) setDetail(null);
    } catch {
      onError('Не удалось изменить блокировку.');
    } finally {
      setBlockSending(false);
    }
  };

  const refreshDetail = async () => {
    if (detailId == null) return;
    try {
      const res = await axios.get<{ user: AdminUser; auctions: Auction[]; bids: unknown[] }>(
        `${API_BASE}/admin/users/${detailId}`,
        authConfig
      );
      setDetail(res.data);
    } catch {
      onError('Не удалось обновить данные пользователя.');
    }
  };

  const finishAuction = async (auctionId: number) => {
    if (!window.confirm('Завершить эту заявку досрочно?')) return;
    try {
      await axios.post(`${API_BASE}/admin/auctions/${auctionId}/finish`, null, authConfig);
      await loadUsers();
      await refreshDetail();
      await loadAdminAuctions();
    } catch {
      onError('Не удалось завершить заявку.');
    }
  };

  const openAuctionDetail = async (auctionId: number) => {
    try {
      const res = await axios.get<AdminAuctionDetail>(`${API_BASE}/admin/auctions/${auctionId}`, authConfig);
      setAuctionDetail(res.data);
    } catch {
      onError('Не удалось загрузить детали заявки.');
    }
  };

  const submitBroadcast = async () => {
    if (!broadcastText.trim()) {
      onError('Введите текст рассылки.');
      return;
    }
    setBroadcastSending(true);
    try {
      const res = await axios.post<{ recipients: number }>(
        `${API_BASE}/admin/broadcast`,
        { role: broadcastRole, text: broadcastText },
        authConfig
      );
      onError(`Рассылка отправлена ${res.data.recipients} пользователям.`);
      setBroadcastText('');
    } catch {
      onError('Не удалось отправить рассылку.');
    } finally {
      setBroadcastSending(false);
    }
  };

  if (loading) return <p style={{ marginTop: 24 }}>Загрузка...</p>;

  const isDark = true; // включаем тёмную тему для админки
  const bgMain = isDark ? '#020617' : '#fff';
  const textMain = isDark ? '#e5e7eb' : '#000';
  const cardBg = isDark ? '#0f172a' : '#f0f7ff';
  const borderColor = isDark ? '#1f2937' : '#e0e0e0';
  const subCardBg = isDark ? '#020617' : '#fafafa';
  const mutedText = isDark ? '#9ca3af' : '#666';
  const tableHeaderBg = isDark ? '#020617' : undefined;
  const tableHeaderText = isDark ? '#e5e7eb' : undefined;

  return (
    <div style={{ marginTop: 24, background: bgMain, color: textMain, padding: 16, borderRadius: 16 }}>
      <h4 style={{ marginTop: 0, marginBottom: 8 }}>Админ-панель</h4>

      <div style={{ marginBottom: 24, padding: 16, borderRadius: 12, border: `1px solid ${borderColor}`, background: cardBg }}>
        <h5 style={{ marginTop: 0, marginBottom: 12 }}>Статистика сервиса</h5>
        {stats && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, fontSize: 14 }}>
            <div>Пользователей: <strong>{stats.users_total}</strong></div>
            <div>Заказчиков: <strong>{stats.customers_count}</strong></div>
            <div>Грузчиков: <strong>{stats.loaders_count}</strong></div>
            <div>Заявок всего: <strong>{stats.auctions_total}</strong></div>
            <div>Заявок активных: <strong>{stats.auctions_active}</strong></div>
            <div>Ставок всего: <strong>{stats.bids_total}</strong></div>
            <div>Оценок: <strong>{stats.ratings_total}</strong></div>
            <div>Комиссия сервиса: <strong>{stats.service_fee_percent ?? 10}%</strong></div>
          </div>
        )}
        <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <button
            type="button"
            onClick={async () => {
              try {
                await axios.post(`${API_BASE}/admin/test-notify-loaders`, null, authConfig);
                onError('Тестовая рассылка запущена (см. лог бэкенда).');
              } catch {
                onError('Не удалось запустить тестовую рассылку.');
              }
            }}
            style={{ padding: '6px 12px', fontSize: 12 }}
          >
            Тестовая рассылка грузчикам
          </button>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 260 }}>
            <div style={{ fontSize: 12, color: isDark ? '#d1d5db' : '#555' }}>Массовая рассылка</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select
                value={broadcastRole}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                  setBroadcastRole(e.target.value === 'customer' ? 'customer' : 'loader')
                }
                style={{ padding: 4, borderRadius: 6, border: '1px solid #ccc', fontSize: 12 }}
              >
                <option value="loader">Грузчики</option>
                <option value="customer">Заказчики</option>
              </select>
              <button
                type="button"
                onClick={submitBroadcast}
                disabled={broadcastSending}
                style={{ padding: '6px 12px', fontSize: 12 }}
              >
                Отправить
              </button>
            </div>
            <textarea
              value={broadcastText}
              onChange={(e) => setBroadcastText(e.target.value)}
              rows={3}
              placeholder="Текст сообщения для рассылки"
              style={{ width: '100%', padding: 6, borderRadius: 6, border: '1px solid #ccc', fontSize: 12, resize: 'vertical' }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 200 }}>
            <div style={{ fontSize: 12, color: isDark ? '#d1d5db' : '#555' }}>Процент сервиса</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={serviceFee}
                onChange={(e) => setServiceFee(e.target.value)}
                style={{ width: 80, padding: 4, borderRadius: 6, border: '1px solid #ccc', fontSize: 12 }}
              />
              <span style={{ fontSize: 12 }}>%</span>
              <button
                type="button"
                disabled={serviceFeeSaving}
                onClick={async () => {
                  const v = Number(serviceFee);
                  if (!Number.isFinite(v) || v < 0 || v > 100) {
                    onError('Введите процент от 0 до 100.');
                    return;
                  }
                  setServiceFeeSaving(true);
                  try {
                    await axios.post(`${API_BASE}/admin/service-fee`, { percent: v }, authConfig);
                    await loadStats();
                  } catch {
                    onError('Не удалось сохранить процент сервиса.');
                  } finally {
                    setServiceFeeSaving(false);
                  }
                }}
                style={{ padding: '6px 12px', fontSize: 12 }}
              >
                Сохранить
              </button>
            </div>
          </div>
        </div>
      </div>
      <div style={{ marginBottom: 12, display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={() => setTab('users')}
          style={{ padding: '6px 12px', fontSize: 12, borderRadius: 16, border: '1px solid #ccc', background: tab === 'users' ? '#1890ff' : '#fff', color: tab === 'users' ? '#fff' : '#333' }}
        >
          Пользователи
        </button>
        <button
          type="button"
          onClick={() => setTab('active')}
          style={{ padding: '6px 12px', fontSize: 12, borderRadius: 16, border: '1px solid #ccc', background: tab === 'active' ? '#1890ff' : '#fff', color: tab === 'active' ? '#fff' : '#333' }}
        >
          Активные заявки
        </button>
        <button
          type="button"
          onClick={() => setTab('completed')}
          style={{ padding: '6px 12px', fontSize: 12, borderRadius: 16, border: '1px solid #ccc', background: tab === 'completed' ? '#1890ff' : '#fff', color: tab === 'completed' ? '#fff' : '#333' }}
        >
          Завершённые заявки
        </button>
      </div>

      {tab === 'users' && (
      <>
      <h5 style={{ marginBottom: 8 }}>Пользователи</h5>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: `2px solid ${borderColor}`, background: tableHeaderBg }}>
              <th style={{ textAlign: 'left', padding: 8, color: tableHeaderText }}>ID</th>
              <th style={{ textAlign: 'left', padding: 8, color: tableHeaderText }}>Имя</th>
              <th style={{ textAlign: 'left', padding: 8, color: tableHeaderText }}>Роль</th>
              <th style={{ textAlign: 'left', padding: 8, color: tableHeaderText }}>Рейтинг</th>
              <th style={{ textAlign: 'left', padding: 8, color: tableHeaderText }}>Заявок</th>
              <th style={{ textAlign: 'left', padding: 8, color: tableHeaderText }}>Ставок</th>
              <th style={{ textAlign: 'left', padding: 8, color: tableHeaderText }}>Активных</th>
              <th style={{ textAlign: 'left', padding: 8, color: tableHeaderText }}>Блок</th>
              <th style={{ textAlign: 'left', padding: 8, color: tableHeaderText }}></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} style={{ borderBottom: `1px solid ${borderColor}` }}>
                <td style={{ padding: 8 }}>{u.id}</td>
                <td style={{ padding: 8 }}>{u.first_name} {u.last_name}</td>
                <td style={{ padding: 8 }}>{u.role === 'customer' ? 'Заказчик' : 'Грузчик'}</td>
                <td style={{ padding: 8 }}>{u.rating_avg != null ? `★ ${u.rating_avg}` : '—'}</td>
                <td style={{ padding: 8 }}>{u.auctions_count ?? 0}</td>
                <td style={{ padding: 8 }}>{u.bids_count ?? 0}</td>
                <td style={{ padding: 8 }}>{u.active_orders_count ?? 0}</td>
                <td style={{ padding: 8 }}>{u.is_blocked ? 'Да' + (u.block_until ? ` до ${formatCreatedAt(u.block_until)}` : '') : 'Нет'}</td>
                <td style={{ padding: 8 }}>
                  <button type="button" onClick={() => openDetail(u.id)} style={{ marginRight: 8, padding: '4px 8px', fontSize: 11 }}>Подробнее</button>
                  <button type="button" onClick={() => setBlockModal({ userId: u.id, blocked: !u.is_blocked, reason: u.block_reason || '', until: u.block_until ? u.block_until.slice(0, 16) : '' })} style={{ padding: '4px 8px', fontSize: 11 }}>{u.is_blocked ? 'Разблокировать' : 'Блок'}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {detail && (
        <div style={{ marginTop: 24, padding: 16, border: `1px solid ${borderColor}`, borderRadius: 12, background: cardBg }}>
          <h5>Пользователь: {detail.user.first_name} {detail.user.last_name} (ID {detail.user.id})</h5>
          <p style={{ fontSize: 12, color: mutedText }}>Заявок: {detail.auctions.length}</p>
          <div style={{ maxHeight: 200, overflowY: 'auto' }}>
            {detail.auctions.map((a) => (
              <div key={a.id} style={{ padding: 8, marginBottom: 4, background: subCardBg, borderRadius: 8, fontSize: 12, border: `1px solid ${borderColor}` }}>
                <strong>{a.title}</strong> — {a.status}, {new Date(a.date_time).toLocaleString('ru-RU')}
                <button
                  type="button"
                  onClick={async () => {
                    if (!window.confirm('Удалить эту заявку?')) return;
                    try {
                      await axios.delete(`${API_BASE}/admin/auctions/${a.id}`, authConfig);
                      // обновляем детальную информацию и список пользователей
                      await loadUsers();
                      setDetail(null);
                      setDetailId(null);
                    } catch {
                      onError('Не удалось удалить заявку.');
                    }
                  }}
                  style={{ marginLeft: 8, padding: '2px 6px', fontSize: 11 }}
                >
                  Удалить
                </button>
                {a.status === 'active' && (
                  <button
                    type="button"
                    onClick={() => finishAuction(a.id)}
                    style={{ marginLeft: 8, padding: '2px 6px', fontSize: 11 }}
                  >
                    Завершить
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => openAuctionDetail(a.id)}
                  style={{ marginLeft: 8, padding: '2px 6px', fontSize: 11 }}
                >
                  Детали
                </button>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 12, color: mutedText, marginTop: 12 }}>Ставок: {(detail.bids as unknown[]).length}</p>
          <button type="button" onClick={() => { setDetail(null); setDetailId(null); }}>Закрыть</button>
        </div>
      )}

      {auctionDetail && (
        <div style={{ marginTop: 24, padding: 16, border: `1px solid ${borderColor}`, borderRadius: 12, background: cardBg }}>
          <h5>Заявка #{auctionDetail.auction.id}: {auctionDetail.auction.title}</h5>
          <p style={{ fontSize: 12, color: mutedText }}>
            Заказчик: {auctionDetail.customer.first_name} {auctionDetail.customer.last_name}
            {auctionDetail.customer.rating_avg != null && ` (★ ${auctionDetail.customer.rating_avg})`}
          </p>
          {auctionDetail.auction.description && (
            <p style={{ fontSize: 12 }}>{auctionDetail.auction.description}</p>
          )}
          <p style={{ fontSize: 12, color: mutedText }}>
            Работы: {new Date(auctionDetail.auction.date_time).toLocaleString('ru-RU')} ·
            Торги до: {new Date(auctionDetail.auction.auction_ends_at).toLocaleString('ru-RU')}
          </p>
          <p style={{ fontSize: 12, color: mutedText }}>Статус: {auctionDetail.auction.status}</p>

          <h6 style={{ marginTop: 12, marginBottom: 4 }}>Ставки</h6>
          {auctionDetail.bids.length === 0 && (
            <p style={{ fontSize: 12, color: mutedText }}>Ставок пока нет.</p>
          )}
          {auctionDetail.bids.length > 0 && (
            <div style={{ maxHeight: 220, overflowY: 'auto' }}>
              {auctionDetail.bids.map((b) => {
                const isLeader = auctionDetail.leader_bid && b.id === auctionDetail.leader_bid.id;
                const isWinner = auctionDetail.winner_bid && b.id === auctionDetail.winner_bid.id;
                return (
                  <div
                    key={b.id}
                    style={{
                      padding: 8,
                      marginBottom: 4,
                      borderRadius: 8,
                      border: '1px solid #ddd',
                      background: isWinner ? '#e6ffed' : isLeader ? '#e6f7ff' : '#fff',
                      fontSize: 12
                    }}
                  >
                    <div>
                      Грузчик: {b.loader.first_name} {b.loader.last_name}
                      {b.loader.rating_avg != null && ` (★ ${b.loader.rating_avg})`}
                    </div>
                    <div>Ставка: {b.amount}</div>
                    <div>Время: {new Date(b.created_at).toLocaleString('ru-RU')}</div>
                    {isLeader && !isWinner && (
                      <div style={{ color: '#1890ff', marginTop: 2 }}>Сейчас лидер по цене</div>
                    )}
                    {isWinner && (
                      <div style={{ color: '#389e0d', marginTop: 2 }}>Победитель (лучшая цена при завершении)</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <button type="button" onClick={() => setAuctionDetail(null)} style={{ marginTop: 8 }}>
            Закрыть детали заявки
          </button>
        </div>
      )}
      </>
      )}

      {tab === 'active' && (
        <div style={{ marginTop: 8 }}>
          <h5 style={{ marginBottom: 8 }}>Активные заявки</h5>
          {adminActiveAuctions.length === 0 && <p style={{ fontSize: 13, color: mutedText }}>Нет активных заявок.</p>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {adminActiveAuctions.map((a) => (
              <div key={a.id} style={{ padding: 10, borderRadius: 8, border: `1px solid ${borderColor}`, background: subCardBg }}>
                <strong>{a.title}</strong>
                <div style={{ fontSize: 12, color: mutedText, marginTop: 2 }}>
                  Заказчик: {a.first_name} {a.last_name}
                </div>
                <div style={{ fontSize: 12, color: mutedText }}>
                  Работы: {new Date(a.date_time).toLocaleString('ru-RU')} · Торги до: {new Date(a.auction_ends_at).toLocaleString('ru-RU')}
                </div>
                <div style={{ fontSize: 12, color: mutedText }}>
                  Статус: {a.status} · Ставок: {a.bids_count ?? 0}
                </div>
                <div style={{ marginTop: 4, display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => openAuctionDetail(a.id)}
                    style={{ padding: '4px 8px', fontSize: 11 }}
                  >
                    Детали
                  </button>
                  {a.status === 'active' && (
                    <button
                      type="button"
                      onClick={() => finishAuction(a.id)}
                      style={{ padding: '4px 8px', fontSize: 11 }}
                    >
                      Завершить
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'completed' && (
        <div style={{ marginTop: 8 }}>
          <h5 style={{ marginBottom: 8 }}>Завершённые заявки</h5>
          {adminCompletedAuctions.length === 0 && <p style={{ fontSize: 13, color: mutedText }}>Пока нет завершённых заявок.</p>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {adminCompletedAuctions.map((a) => (
              <div key={a.id} style={{ padding: 10, borderRadius: 8, border: `1px solid ${borderColor}`, background: subCardBg }}>
                <strong>{a.title}</strong>
                <div style={{ fontSize: 12, color: mutedText, marginTop: 2 }}>
                  Заказчик: {a.first_name} {a.last_name}
                </div>
                <div style={{ fontSize: 12, color: mutedText }}>
                  Работы: {new Date(a.date_time).toLocaleString('ru-RU')}
                </div>
                <div style={{ fontSize: 12, color: mutedText }}>
                  Статус: {a.status} · Ставок: {a.bids_count ?? 0}
                </div>
                <div style={{ marginTop: 4, display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => openAuctionDetail(a.id)}
                    style={{ padding: '4px 8px', fontSize: 11 }}
                  >
                    Детали
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!window.confirm('Удалить эту заявку?')) return;
                      try {
                        await axios.delete(`${API_BASE}/admin/auctions/${a.id}`, authConfig);
                        await loadAdminAuctions();
                      } catch {
                        onError('Не удалось удалить заявку.');
                      }
                    }}
                    style={{ padding: '4px 8px', fontSize: 11 }}
                  >
                    Удалить
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {blockModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}>
          <div style={{ background: '#fff', padding: 24, borderRadius: 12, maxWidth: 360, width: '90%' }}>
            <h5 style={{ marginTop: 0 }}>{blockModal.blocked ? 'Заблокировать пользователя' : 'Разблокировать'}</h5>
            {blockModal.blocked && (
              <>
                <label style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>Причина (необязательно)</label>
                <input value={blockModal.reason} onChange={(e) => setBlockModal((m) => m ? { ...m, reason: e.target.value } : null)} placeholder="Причина блокировки" style={{ width: '100%', padding: 8, marginBottom: 12, boxSizing: 'border-box' }} />
                <label style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>Разблокировать после (оставьте пустым для навсегда)</label>
                <input type="datetime-local" value={blockModal.until} onChange={(e) => setBlockModal((m) => m ? { ...m, until: e.target.value } : null)} style={{ width: '100%', padding: 8, marginBottom: 12, boxSizing: 'border-box' }} />
              </>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setBlockModal(null)}>Отмена</button>
              <button type="button" onClick={submitBlock} disabled={blockSending}>{blockModal.blocked ? 'Заблокировать' : 'Разблокировать'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const App: React.FC = () => {
  const [webAppUser, setWebAppUser] = React.useState<MaxUser | null>(getMaxUser());
  const [role, setRole] = React.useState<Role | null>(null);
  const [backendUser, setBackendUser] = React.useState<BackendUser | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [workDate, setWorkDate] = React.useState('');
  const [workTime, setWorkTime] = React.useState('');
  const [auctionEndDate, setAuctionEndDate] = React.useState('');
  const [auctionEndTime, setAuctionEndTime] = React.useState('');
  const [street, setStreet] = React.useState('');
  const [house, setHouse] = React.useState('');
  const [flat, setFlat] = React.useState('');
  const [myAuctions, setMyAuctions] = React.useState<Auction[]>([]);
  const [activeAuctions, setActiveAuctions] = React.useState<AuctionWithCustomer[]>([]);
  const [preferredAuctionId, setPreferredAuctionId] = React.useState<number | null>(null);

  const [datePicker, setDatePicker] = React.useState<'work' | 'auction' | null>(null);
  const [timePicker, setTimePicker] = React.useState<'work' | 'auction' | null>(null);
  const [tempDate, setTempDate] = React.useState('');
  const [tempTime, setTempTime] = React.useState('');
  const [calendarMonth, setCalendarMonth] = React.useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  });

  const timeOptions = React.useMemo(() => {
    const opts: string[] = [];
    for (let h = 0; h < 24; h++) {
      opts.push(`${String(h).padStart(2, '0')}:00`);
      opts.push(`${String(h).padStart(2, '0')}:30`);
    }
    return opts;
  }, []);

  React.useEffect(() => {
    window.WebApp?.ready();
    const syncUser = () => setWebAppUser(getMaxUser());
    syncUser();
    const t = setInterval(syncUser, 300);
    const stop = setTimeout(() => clearInterval(t), 3000);
    return () => { clearInterval(t); clearTimeout(stop); };
  }, []);

  React.useEffect(() => {
    const sp = getStartParam();
    if (sp && sp.startsWith('auction_')) {
      const idStr = sp.split('auction_')[1];
      const id = Number(idStr);
      if (Number.isFinite(id) && id > 0) {
        setPreferredAuctionId(id);
      }
    }
  }, []);

  const handleAuth = async (selectedRole: Role) => {
    const user = getMaxUser() ?? webAppUser;
    if (!user) {
      setError('Нет данных пользователя из MAX. Откройте миниприложение из MAX.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await axios.post<{ user: BackendUser }>(`${API_BASE}/auth/max`, {
        max_user_id: user.id,
        first_name: user.first_name,
        last_name: user.last_name,
        username: user.username,
        role: selectedRole
      });
      setBackendUser(res.data.user);
      setRole(selectedRole);
      if (selectedRole === 'customer') {
        await loadMyAuctions(res.data.user.id);
      } else if (selectedRole === 'loader') {
        await loadActiveAuctions();
      }
    } catch (e) {
      setError('Ошибка авторизации. Проверьте подключение к серверу.');
    } finally {
      setLoading(false);
    }
  };

  const loadMyAuctions = async (userId: number) => {
    try {
      const res = await axios.get<{ auctions: Auction[] }>(`${API_BASE}/auctions/my`, {
        params: { user_id: userId }
      });
      setMyAuctions(res.data.auctions);
    } catch (e) {
      console.error('Failed to load my auctions:', e);
    }
  };

  const loadActiveAuctions = async () => {
    try {
      const res = await axios.get<{ auctions: AuctionWithCustomer[] }>(`${API_BASE}/auctions/active`);
      let auctions = res.data.auctions;
      if (preferredAuctionId) {
        auctions = [...auctions].sort((a, b) => {
          if (a.id === preferredAuctionId) return -1;
          if (b.id === preferredAuctionId) return 1;
          return 0;
        });
      }
      setActiveAuctions(auctions);
    } catch (e) {
      console.error('Failed to load active auctions:', e);
    }
  };

  const handlePlaceBid = async (auctionId: number) => {
    if (!backendUser) {
      setError('Сначала авторизуйтесь');
      return;
    }

    const input = document.getElementById(`bid-${auctionId}`) as HTMLInputElement;
    const amount = Number(input?.value);
    
    if (!amount || amount <= 0) {
      setError('Введите корректную сумму ставки');
      return;
    }

    setLoading(true);
    try {
      await axios.post(`${API_BASE}/bids`, {
        auction_id: auctionId,
        loader_id: backendUser.id,
        amount
      });
      
      // Обновляем список активных аукционов
      await loadActiveAuctions();
      
      // Очищаем поле ввода
      if (input) input.value = '';
      
      setError('Ставка успешно сделана!');
    } catch (e: any) {
      setError(e.response?.data?.error || 'Не удалось сделать ставку');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateAuction = async () => {
    if (!backendUser) return;
    if (!title || !workDate || !workTime || !auctionEndDate || !auctionEndTime) {
      setError('Заполните название, адрес, дату и время работ и окончания поиска.');
      return;
    }
    const workStart = new Date(`${workDate}T${workTime}:00`).getTime();
    const searchEnd = new Date(`${auctionEndDate}T${auctionEndTime}:00`).getTime();
    if (searchEnd >= workStart) {
      setError('Окончание поиска должно быть раньше начала работ.');
      return;
    }
    const diffMinutes = (workStart - searchEnd) / (60 * 1000);
    if (diffMinutes < 90) {
      setError('Между окончанием поиска и началом работ должно быть не менее 90 минут (время на дорогу грузчику).');
      return;
    }
    const dateTimeISO = new Date(`${workDate}T${workTime}:00`).toISOString();
    const auctionEndsAtISO = new Date(`${auctionEndDate}T${auctionEndTime}:00`).toISOString();

    setLoading(true);
    setError(null);
    try {
      await axios.post(`${API_BASE}/auctions`, {
        user_id: backendUser.id,
        title,
        description,
        street,
        house,
        flat,
        cargo_params: null,
        date_time: dateTimeISO,
        auction_ends_at: auctionEndsAtISO
      });
      setTitle('');
      setDescription('');
      setStreet('');
      setHouse('');
      setFlat('');
      setWorkDate('');
      setWorkTime('');
      setAuctionEndDate('');
      setAuctionEndTime('');
      await loadMyAuctions(backendUser.id);
    } catch {
      setError('Не удалось создать заявку.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 16, fontFamily: 'system-ui, sans-serif' }}>
      <h2>Поиск грузчиков</h2>
      <p style={{ fontSize: 10, color: '#888' }}>сборка с отладкой v2</p>
      {webAppUser && (
        <p>
          Пользователь: {webAppUser.first_name} {webAppUser.last_name}
        </p>
      )}
      {error && <p style={{ color: 'red', marginTop: 8 }}>{error}</p>}
      {!backendUser && (
        <div style={{ marginTop: 12, padding: 8, background: '#fff3cd', border: '1px solid #ffc107', fontSize: 11, wordBreak: 'break-all' }}>
          <strong>Отладка MAX (скопируй и отправь разработчику):</strong>
          <pre style={{ margin: '4px 0', whiteSpace: 'pre-wrap' }}>
            {`href: ${typeof location !== 'undefined' ? location.href : 'n/a'}
WebApp: ${window.WebApp ? 'yes' : 'no'}
initData: ${window.WebApp?.initData ? String(window.WebApp.initData).slice(0, 500) + (window.WebApp.initData.length > 500 ? '...' : '') : 'empty'}
initDataUnsafe: ${JSON.stringify(window.WebApp?.initDataUnsafe ?? null)}
search: ${typeof location !== 'undefined' ? location.search : 'n/a'}
hash: ${typeof location !== 'undefined' ? location.hash : 'n/a'}`}
          </pre>
        </div>
      )}
      {!backendUser && (
        <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Button disabled={loading} onClick={() => handleAuth('customer')}>
            Я заказчик
          </Button>
          <Button disabled={loading} onClick={() => handleAuth('loader')}>
            Я грузчик
          </Button>
          <button
            type="button"
            onClick={() => handleAuth('admin')}
            disabled={loading}
            style={{ padding: 10, borderRadius: 8, border: '1px solid #999', background: '#f5f5f5', color: '#666', fontSize: 13 }}
          >
            Вход для администратора
          </button>
        </div>
      )}
      {backendUser && role === 'admin' && (
        <AdminPanel auth={{ type: 'max', backendUser }} onError={setError} />
      )}
      {backendUser && role && role !== 'admin' && (
        <div style={{ marginTop: 24 }}>
          {/* Личный кабинет */}
          <div style={{ padding: 16, borderRadius: 12, border: '1px solid #e0e0e0', background: '#fafafa', marginBottom: 24 }}>
            <h4 style={{ marginTop: 0, marginBottom: 12 }}>Личный кабинет</h4>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <span style={{ fontWeight: 600, fontSize: 16 }}>
                {backendUser.first_name} {backendUser.last_name}
              </span>
              <span style={{ fontSize: 12, color: '#666' }}>
                {role === 'customer' ? 'Заказчик' : 'Грузчик'}
              </span>
              {backendUser.rating_avg != null ? (
                <span style={{ fontSize: 13 }}>
                  ★ {backendUser.rating_avg} {backendUser.rating_count != null && backendUser.rating_count > 0 && `(${backendUser.rating_count} оценок)`}
                </span>
              ) : (
                <span style={{ fontSize: 12, color: '#888' }}>Пока нет оценок</span>
              )}
              {backendUser.created_at && (
                <span style={{ fontSize: 11, color: '#888' }}>На сервисе с {formatCreatedAt(backendUser.created_at)}</span>
              )}
            </div>

            <h5 style={{ marginBottom: 8, fontSize: 14 }}>Активные заказы</h5>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
              {role === 'customer' && myAuctions.filter((a) => ['active', 'paid'].includes(a.status)).length === 0 && (
                <p style={{ margin: 0, fontSize: 13, color: '#666' }}>Нет активных заявок</p>
              )}
              {role === 'customer' && myAuctions.filter((a) => ['active', 'paid'].includes(a.status)).map((a) => (
                <div key={a.id} style={{ padding: 10, borderRadius: 8, border: '1px solid #ddd', background: '#fff' }}>
                  <strong>{a.title}</strong>
                  <div style={{ fontSize: 12, color: '#666' }}>статус: {a.status}, работы: {new Date(a.date_time).toLocaleString('ru-RU')}</div>
                  {a.payment_status === 'waiting_payment' && (
                    <div style={{ fontSize: 11, color: '#d48806', marginTop: 4 }}>Торги завершены, ожидается оплата</div>
                  )}
                  {a.status === 'paid' && (
                    <div style={{ fontSize: 11, color: '#389e0d', marginTop: 4 }}>
                      Оплачено{a.loader_marked_done && !a.customer_confirmed_done ? ', грузчик отметил выполнение — подтвердите после работ' : ''}
                    </div>
                  )}
                  {a.status === 'active' && (
                    <button
                      type="button"
                      onClick={async () => {
                        if (!backendUser) return;
                        if (!window.confirm('Удалить эту заявку?')) return;
                        setLoading(true);
                        try {
                          await axios.delete(`${API_BASE}/auctions/${a.id}`, {
                            data: { user_id: backendUser.id }
                          });
                          await loadMyAuctions(backendUser.id);
                        } catch {
                          setError('Не удалось удалить заявку.');
                        } finally {
                          setLoading(false);
                        }
                      }}
                      style={{ marginTop: 6, padding: '4px 8px', fontSize: 12 }}
                    >
                      Удалить
                    </button>
                  )}
                  {a.payment_status === 'waiting_payment' && (
                    <button
                      type="button"
                      onClick={async () => {
                        if (!backendUser) return;
                        setLoading(true);
                        try {
                          await axios.post(`${API_BASE}/auctions/${a.id}/pay`, { user_id: backendUser.id });
                          await loadMyAuctions(backendUser.id);
                        } catch {
                          setError('Не удалось выполнить оплату (тест).');
                        } finally {
                          setLoading(false);
                        }
                      }}
                      style={{ marginTop: 6, marginLeft: 8, padding: '4px 8px', fontSize: 12 }}
                    >
                      Оплатить (тест)
                    </button>
                  )}
                  {a.status === 'paid' && a.loader_marked_done && !a.customer_confirmed_done && (
                    <button
                      type="button"
                      onClick={async () => {
                        if (!backendUser) return;
                        if (!window.confirm('Подтвердить, что работы выполнены?')) return;
                        setLoading(true);
                        try {
                          await axios.post(`${API_BASE}/auctions/${a.id}/confirm-complete`, { user_id: backendUser.id });
                          await loadMyAuctions(backendUser.id);
                        } catch {
                          setError('Не удалось подтвердить выполнение работ.');
                        } finally {
                          setLoading(false);
                        }
                      }}
                      style={{ marginTop: 6, marginLeft: 8, padding: '4px 8px', fontSize: 12 }}
                    >
                      Подтвердить выполнение
                    </button>
                  )}
                </div>
              ))}
              {role === 'loader' && <p style={{ margin: 0, fontSize: 13, color: '#666' }}>Здесь будут ваши активные заказы</p>}
            </div>

            <h5 style={{ marginBottom: 8, fontSize: 14 }}>История</h5>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {role === 'customer' && myAuctions.filter((a) => !['active', 'paid'].includes(a.status)).length === 0 && (
                <p style={{ margin: 0, fontSize: 13, color: '#666' }}>Пока нет завершённых заявок</p>
              )}
              {role === 'customer' && myAuctions.filter((a) => !['active', 'paid'].includes(a.status)).map((a) => (
                <div key={a.id} style={{ padding: 10, borderRadius: 8, border: '1px solid #eee', background: '#fff' }}>
                  <strong>{a.title}</strong>
                  <div style={{ fontSize: 12, color: '#666' }}>статус: {a.status}, работы: {new Date(a.date_time).toLocaleString('ru-RU')}</div>
                </div>
              ))}
              {role === 'loader' && <p style={{ margin: 0, fontSize: 13, color: '#666' }}>Здесь будет история ваших заказов</p>}
            </div>
          </div>

          {role === 'customer' && (
          <>
          <h4>Создать заявку</h4>
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input
              placeholder="Краткое описание груза"
              value={title}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
              style={{ padding: 8, borderRadius: 8, border: '1px solid #ccc' }}
            />
            <input
              placeholder="Подробности (необязательно)"
              value={description}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDescription(e.target.value)}
              style={{ padding: 8, borderRadius: 8, border: '1px solid #ccc' }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 12, color: '#555' }}>Адрес (для уведомлений грузчикам видна только улица)</label>
              <input
                placeholder="Улица"
                value={street}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setStreet(e.target.value)}
                style={{ padding: 8, borderRadius: 8, border: '1px solid #ccc' }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  placeholder="Дом"
                  value={house}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setHouse(e.target.value)}
                  style={{ flex: 1, padding: 8, borderRadius: 8, border: '1px solid #ccc' }}
                />
                <input
                  placeholder="Квартира (необязательно)"
                  value={flat}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFlat(e.target.value)}
                  style={{ flex: 1, padding: 8, borderRadius: 8, border: '1px solid #ccc' }}
                />
              </div>
            </div>
            <button
              type="button"
              disabled={loading}
              onClick={async () => {
                if (!backendUser) return;
                const now = new Date();
                const work = new Date(now.getTime() + 2 * 60 * 60 * 1000); // через 2 часа
                const searchEnd = new Date(now.getTime() + 30 * 60 * 1000); // через 30 минут
                setLoading(true);
                setError(null);
                try {
                  await axios.post(`${API_BASE}/auctions`, {
                    user_id: backendUser.id,
                    title: 'Тестовая заявка',
                    description: 'Тест для проверки уведомлений и ставок',
                    cargo_params: null,
                    date_time: work.toISOString(),
                    auction_ends_at: searchEnd.toISOString()
                  });
                  await loadMyAuctions(backendUser.id);
                } catch {
                  setError('Не удалось создать тестовую заявку.');
                } finally {
                  setLoading(false);
                }
              }}
              style={{ padding: 8, borderRadius: 8, border: '1px solid #ccc', background: '#f5f5f5', fontSize: 12 }}
            >
              Создать тестовую заявку
            </button>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 12, color: '#555' }}>Дата начала работ</label>
              <button
                type="button"
                onClick={() => {
                  setDatePicker('work');
                  setTempDate(workDate || todayYYYYMMDD());
                  const d = workDate ? new Date(workDate + 'T12:00:00') : new Date();
                  setCalendarMonth({ year: d.getFullYear(), month: d.getMonth() + 1 });
                }}
                style={{ padding: 10, borderRadius: 8, border: '1px solid #ccc', textAlign: 'left', background: '#fff' }}
              >
                {workDate ? formatDateDisplay(workDate) : 'Выберите дату'}
              </button>
              {datePicker === 'work' && (
                <div style={{ marginTop: 4, padding: 12, border: '1px solid #ccc', borderRadius: 12, background: '#f9f9f9' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <button type="button" onClick={() => setCalendarMonth((m) => (m.month === 1 ? { year: m.year - 1, month: 12 } : { year: m.year, month: m.month - 1 }))} style={{ padding: '4px 8px' }}>‹</button>
                    <span style={{ fontWeight: 600 }}>{calendarMonth.month}/{calendarMonth.year}</span>
                    <button type="button" onClick={() => setCalendarMonth((m) => (m.month === 12 ? { year: m.year + 1, month: 1 } : { year: m.year, month: m.month + 1 }))} style={{ padding: '4px 8px' }}>›</button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 12 }}>
                    {['Вс','Пн','Вт','Ср','Чт','Пт','Сб'].map((w) => <div key={w} style={{ textAlign: 'center', fontSize: 11, color: '#666' }}>{w}</div>)}
                    {getCalendarDays(calendarMonth.year, calendarMonth.month).map((cell) => (
                      <button
                        key={cell.date}
                        type="button"
                        disabled={cell.isPast}
                        onClick={() => cell.isCurrentMonth && !cell.isPast && setTempDate(cell.date)}
                        style={{
                          padding: 6,
                          borderRadius: 6,
                          border: tempDate === cell.date ? '2px solid #1976d2' : '1px solid #ddd',
                          background: cell.isPast ? '#eee' : tempDate === cell.date ? '#e3f2fd' : '#fff',
                          color: cell.isPast ? '#999' : cell.isCurrentMonth ? '#333' : '#999',
                          cursor: cell.isPast ? 'not-allowed' : 'pointer'
                        }}
                      >
                        {cell.day}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button type="button" onClick={() => setDatePicker(null)} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #ccc' }}>Отмена</button>
                    <button type="button" onClick={() => { setWorkDate(tempDate); setDatePicker(null); }} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #1976d2', background: '#1976d2', color: '#fff' }}>ОК</button>
                  </div>
                </div>
              )}
            </div>
            {workDate && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 12, color: '#555' }}>Время начала работ (кратно 30 мин)</label>
              <button
                type="button"
                onClick={() => { setTimePicker('work'); const allowed = getTimeOptionsForDate(timeOptions, workDate); setTempTime(allowed.includes(workTime) ? workTime : (allowed[0] ?? '')); }}
                style={{ padding: 10, borderRadius: 8, border: '1px solid #ccc', textAlign: 'left', background: '#fff' }}
              >
                {workTime || 'Выберите время'}
              </button>
              {timePicker === 'work' && (
                <div style={{ marginTop: 4, padding: 12, border: '1px solid #ccc', borderRadius: 12, background: '#f9f9f9', maxHeight: 280, overflow: 'auto' }}>
                  <div style={{ maxHeight: 200, overflowY: 'auto', marginBottom: 12 }}>
                    {getTimeOptionsForDate(timeOptions, workDate).length === 0 ? (
                      <p style={{ fontSize: 12, color: '#666' }}>На эту дату нет доступного времени</p>
                    ) : (
                      getTimeOptionsForDate(timeOptions, workDate).map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setTempTime(t)}
                          style={{
                            display: 'block',
                            width: '100%',
                            padding: 10,
                            textAlign: 'center',
                            border: tempTime === t ? '2px solid #1976d2' : '1px solid #eee',
                            borderRadius: 8,
                            background: tempTime === t ? '#e3f2fd' : '#fff',
                            marginBottom: 4,
                            cursor: 'pointer'
                          }}
                        >
                          {t}
                        </button>
                      ))
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button type="button" onClick={() => setTimePicker(null)} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #ccc' }}>Отмена</button>
                    <button type="button" onClick={() => { setWorkTime(tempTime); setTimePicker(null); }} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #1976d2', background: '#1976d2', color: '#fff' }}>ОК</button>
                  </div>
                </div>
              )}
            </div>
            )}
            {workTime && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 12, color: '#555' }}>Дата окончания поиска</label>
              <button
                type="button"
                onClick={() => {
                  setDatePicker('auction');
                  setTempDate(auctionEndDate || todayYYYYMMDD());
                  const d = auctionEndDate ? new Date(auctionEndDate + 'T12:00:00') : new Date();
                  setCalendarMonth({ year: d.getFullYear(), month: d.getMonth() + 1 });
                }}
                style={{ padding: 10, borderRadius: 8, border: '1px solid #ccc', textAlign: 'left', background: '#fff' }}
              >
                {auctionEndDate ? formatDateDisplay(auctionEndDate) : 'Выберите дату'}
              </button>
              {datePicker === 'auction' && (
                <div style={{ marginTop: 4, padding: 12, border: '1px solid #ccc', borderRadius: 12, background: '#f9f9f9' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <button type="button" onClick={() => setCalendarMonth((m) => (m.month === 1 ? { year: m.year - 1, month: 12 } : { year: m.year, month: m.month - 1 }))} style={{ padding: '4px 8px' }}>‹</button>
                    <span style={{ fontWeight: 600 }}>{calendarMonth.month}/{calendarMonth.year}</span>
                    <button type="button" onClick={() => setCalendarMonth((m) => (m.month === 12 ? { year: m.year + 1, month: 1 } : { year: m.year, month: m.month + 1 }))} style={{ padding: '4px 8px' }}>›</button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 12 }}>
                    {['Вс','Пн','Вт','Ср','Чт','Пт','Сб'].map((w) => <div key={w} style={{ textAlign: 'center', fontSize: 11, color: '#666' }}>{w}</div>)}
                    {getCalendarDays(calendarMonth.year, calendarMonth.month, todayYYYYMMDD()).map((cell) => (
                      <button
                        key={cell.date}
                        type="button"
                        disabled={cell.isPast}
                        onClick={() => cell.isCurrentMonth && !cell.isPast && setTempDate(cell.date)}
                        style={{
                          padding: 6,
                          borderRadius: 6,
                          border: tempDate === cell.date ? '2px solid #1976d2' : '1px solid #ddd',
                          background: cell.isPast ? '#eee' : tempDate === cell.date ? '#e3f2fd' : '#fff',
                          color: cell.isPast ? '#999' : cell.isCurrentMonth ? '#333' : '#999',
                          cursor: cell.isPast ? 'not-allowed' : 'pointer'
                        }}
                      >
                        {cell.day}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button type="button" onClick={() => setDatePicker(null)} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #ccc' }}>Отмена</button>
                    <button type="button" onClick={() => { setAuctionEndDate(tempDate); setDatePicker(null); }} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #1976d2', background: '#1976d2', color: '#fff' }}>ОК</button>
                  </div>
                </div>
              )}
            </div>
            )}
            {auctionEndDate && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 12, color: '#555' }}>Время окончания поиска (кратно 30 мин)</label>
              <button
                type="button"
                onClick={() => {
                  setTimePicker('auction');
                  const allowed = getTimeOptionsForSearchEnd(timeOptions, auctionEndDate, workDate, workTime);
                  setTempTime(allowed.includes(auctionEndTime) ? auctionEndTime : (allowed[0] ?? ''));
                }}
                style={{ padding: 10, borderRadius: 8, border: '1px solid #ccc', textAlign: 'left', background: '#fff' }}
              >
                {auctionEndTime || 'Выберите время'}
              </button>
              {timePicker === 'auction' && (
                <div style={{ marginTop: 4, padding: 12, border: '1px solid #ccc', borderRadius: 12, background: '#f9f9f9', maxHeight: 280, overflow: 'auto' }}>
                  <div style={{ maxHeight: 200, overflowY: 'auto', marginBottom: 12 }}>
                    {getTimeOptionsForSearchEnd(timeOptions, auctionEndDate, workDate, workTime).length === 0 ? (
                      <p style={{ fontSize: 12, color: '#666' }}>Нет доступного времени (нужно не менее 90 мин до начала работ)</p>
                    ) : (
                      getTimeOptionsForSearchEnd(timeOptions, auctionEndDate, workDate, workTime).map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setTempTime(t)}
                          style={{
                            display: 'block',
                            width: '100%',
                            padding: 10,
                            textAlign: 'center',
                            border: tempTime === t ? '2px solid #1976d2' : '1px solid #eee',
                            borderRadius: 8,
                            background: tempTime === t ? '#e3f2fd' : '#fff',
                            marginBottom: 4,
                            cursor: 'pointer'
                          }}
                        >
                          {t}
                        </button>
                      ))
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button type="button" onClick={() => setTimePicker(null)} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #ccc' }}>Отмена</button>
                    <button type="button" onClick={() => { setAuctionEndTime(tempTime); setTimePicker(null); }} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #1976d2', background: '#1976d2', color: '#fff' }}>ОК</button>
                  </div>
                </div>
              )}
            </div>
            )}
            <Button disabled={loading} onClick={handleCreateAuction}>
              Разместить заявку
            </Button>
          </div>
          </>)}
          {role === 'loader' && (
            <div style={{ marginBottom: 16 }}>
              <h4 style={{ margin: '0 0 8px 0', fontSize: 16 }}>🔥 Активные заявки</h4>
              <p style={{ margin: '0 0 12px 0', fontSize: 13, color: '#666' }}>
                Сделайте ставку на заявки, которые вам интересны
              </p>
              {activeAuctions.length === 0 ? (
                <p style={{ margin: 0, fontSize: 13, color: '#666' }}>Активных заявок пока нет</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {activeAuctions.map((auction: AuctionWithCustomer) => (
                    <div key={auction.id} style={{ 
                      border: '1px solid #ddd', 
                      borderRadius: 8, 
                      padding: 12,
                      background: '#fafafa'
                    }}>
                      <div style={{ marginBottom: 8 }}>
                        <strong style={{ fontSize: 14 }}>{auction.title}</strong>
                        {auction.description && (
                          <p style={{ margin: '4px 0', fontSize: 13, color: '#666' }}>
                            {auction.description}
                          </p>
                        )}
                      </div>
                      
                      <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>
                        <div>👤 {auction.first_name} {auction.last_name}</div>
                        <div>⏰ Работы: {new Date(auction.date_time).toLocaleString('ru-RU')}</div>
                        <div>⏳ Торги до: {new Date(auction.auction_ends_at).toLocaleString('ru-RU')}</div>
                        <div>📊 Ставок: {auction.bids_count || 0}</div>
                      </div>
                      
                      {new Date(auction.auction_ends_at) > new Date() ? (
                        <div>
                          <input
                            type="number"
                            placeholder="Ваша ставка (₽)"
                            style={{ 
                              width: '100%', 
                              padding: '8px', 
                              border: '1px solid #ddd', 
                              borderRadius: 4,
                              marginBottom: 8,
                              fontSize: 14
                            }}
                            id={`bid-${auction.id}`}
                          />
                          <Button
                            onClick={() => handlePlaceBid(auction.id)}
                            disabled={!backendUser}
                          >
                            Сделать ставку
                          </Button>
                        </div>
                      ) : (
                        <div style={{ 
                          padding: 8, 
                          background: '#fff3cd', 
                          borderRadius: 4, 
                          fontSize: 12,
                          color: '#856404'
                        }}>
                          ⏰ Торги завершены
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const ADMIN_TOKEN_KEY = 'admin_token';

const AdminWebEntry: React.FC = () => {
  const [token, setToken] = React.useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(ADMIN_TOKEN_KEY);
  });
  const [login, setLogin] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [serverConfigured, setServerConfigured] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    axios.get<{ configured: boolean }>(`${API_BASE}/admin/auth/status`).then((r) => setServerConfigured(r.data.configured)).catch(() => setServerConfigured(false));
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await axios.post<{ token: string }>(`${API_BASE}/admin/auth`, { login, password });
      const t = res.data.token;
      window.localStorage.setItem(ADMIN_TOKEN_KEY, t);
      setToken(t);
    } catch (err: unknown) {
      const ax = err as { response?: { status?: number; data?: { error?: string } }; message?: string };
      if (ax.response?.status === 401) setError('Неверный логин или пароль.');
      else if (ax.response?.data?.error === 'admin_login_not_configured') setError('На сервере не заданы ADMIN_LOGIN и ADMIN_PASSWORD. Добавьте их в .env на сервере и перезапустите бэкенд.');
      else if (!ax.response) setError('Не удалось подключиться к серверу. Проверьте, что открыт сайт с того же домена (mintday.ru), где работает API.');
      else setError('Ошибка входа. Код: ' + (ax.response?.status || '') + '.');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    window.localStorage.removeItem(ADMIN_TOKEN_KEY);
    setToken(null);
  };

  if (!token) {
    return (
      <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif', maxWidth: 360, margin: '40px auto' }}>
        <h2 style={{ marginTop: 0 }}>Вход в админ-панель</h2>
        <p style={{ color: '#666', fontSize: 14 }}>Поиск грузчиков — mintday.ru</p>
        {serverConfigured === false && (
          <p style={{ color: '#c00', marginBottom: 16, fontSize: 13 }}>
            Сервер не настроен: на бэкенде не заданы ADMIN_LOGIN и ADMIN_PASSWORD (файл .env на сервере или переменные окружения). Запрос к API может не доходить до сервера.
          </p>
        )}
        {error && <p style={{ color: 'red', marginBottom: 16 }}>{error}</p>}
        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input
            type="text"
            placeholder="Логин"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            required
            style={{ padding: 10, borderRadius: 8, border: '1px solid #ccc' }}
          />
          <input
            type="password"
            placeholder="Пароль"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={{ padding: 10, borderRadius: 8, border: '1px solid #ccc' }}
          />
          <button type="submit" disabled={loading} style={{ padding: 12, borderRadius: 8, border: '1px solid #1976d2', background: '#1976d2', color: '#fff' }}>
            {loading ? 'Вход...' : 'Войти'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div style={{ padding: 16, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <button type="button" onClick={handleLogout} style={{ padding: '6px 12px', fontSize: 12, color: '#666' }}>Выйти</button>
      </div>
      <AdminPanel auth={{ type: 'token', token }} onError={setError} />
      {error && <p style={{ color: 'red', marginTop: 16 }}>{error}</p>}
    </div>
  );
};

function isAdminPath(): boolean {
  if (typeof window === 'undefined') return false;
  const p = window.location.pathname;
  return p === '/admin' || p.endsWith('/admin');
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {isAdminPath() ? (
      <AdminWebEntry />
    ) : (
      <MaxUI>
        <App />
      </MaxUI>
    )}
  </React.StrictMode>
);

