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

type Role = 'customer' | 'loader';

interface BackendUser {
  id: number;
  max_user_id: number;
  role: Role;
  first_name?: string;
  last_name?: string;
  username?: string;
}

interface Auction {
  id: number;
  title: string;
  description: string | null;
  date_time: string;
  auction_ends_at: string;
  status: string;
}

const API_BASE = '/api';

type MaxUser = { id: number; first_name?: string; last_name?: string; username?: string };

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
  const [myAuctions, setMyAuctions] = React.useState<Auction[]>([]);

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
    } catch {
      setError('Не удалось загрузить ваши заявки.');
    }
  };

  const handleCreateAuction = async () => {
    if (!backendUser) return;
    if (!title || !workDate || !workTime || !auctionEndDate || !auctionEndTime) {
      setError('Заполните название, дату и время работ и окончания поиска.');
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
        cargo_params: null,
        date_time: dateTimeISO,
        auction_ends_at: auctionEndsAtISO
      });
      setTitle('');
      setDescription('');
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
            Я заказчик тест
          </Button>
          <Button disabled={loading} onClick={() => handleAuth('loader')}>
            Я грузчик
          </Button>
        </div>
      )}
      {backendUser && role === 'customer' && (
        <div style={{ marginTop: 24 }}>
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

          <h4 style={{ marginTop: 24 }}>Мои заявки</h4>
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {myAuctions.map((a) => (
              <div
                key={a.id}
                style={{
                  padding: 12,
                  borderRadius: 8,
                  border: '1px solid #ddd',
                  background: '#fafafa'
                }}
              >
                <strong>{a.title}</strong>
                <div>
                  статус: {a.status}, работы: {a.date_time}
                </div>
              </div>
            ))}
            {myAuctions.length === 0 && <p>Пока нет созданных заявок.</p>}
          </div>
        </div>
      )}
      {backendUser && role === 'loader' && (
        <p style={{ marginTop: 24 }}>
          Экран грузчика пока не реализован. Здесь будет список заявок и ставки.
        </p>
      )}
    </div>
  );
};

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <MaxUI>
      <App />
    </MaxUI>
  </React.StrictMode>
);

