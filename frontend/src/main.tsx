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

const App: React.FC = () => {
  type MaxUser = { id: number; first_name?: string; last_name?: string; username?: string };
  const [webAppUser, setWebAppUser] = React.useState<MaxUser | null>(window.WebApp?.initDataUnsafe?.user ?? null);
  const [role, setRole] = React.useState<Role | null>(null);
  const [backendUser, setBackendUser] = React.useState<BackendUser | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [dateTime, setDateTime] = React.useState('');
  const [auctionEndsAt, setAuctionEndsAt] = React.useState('');
  const [myAuctions, setMyAuctions] = React.useState<Auction[]>([]);

  React.useEffect(() => {
    window.WebApp?.ready();
    const syncUser = () => setWebAppUser(window.WebApp?.initDataUnsafe?.user ?? null);
    syncUser();
    const t = setInterval(syncUser, 300);
    const stop = setTimeout(() => clearInterval(t), 3000);
    return () => { clearInterval(t); clearTimeout(stop); };
  }, []);

  const handleAuth = async (selectedRole: Role) => {
    const user = window.WebApp?.initDataUnsafe?.user ?? webAppUser;
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
    if (!title || !dateTime || !auctionEndsAt) {
      setError('Заполните название, дату/время и время окончания аукциона.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await axios.post(`${API_BASE}/auctions`, {
        user_id: backendUser.id,
        title,
        description,
        cargo_params: null,
        date_time: dateTime,
        auction_ends_at: auctionEndsAt
      });
      setTitle('');
      setDescription('');
      setDateTime('');
      setAuctionEndsAt('');
      await loadMyAuctions(backendUser.id);
    } catch {
      setError('Не удалось создать заявку.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 16, fontFamily: 'system-ui, sans-serif' }}>
      <h2>Аукцион Грузчиков</h2>
      {webAppUser && (
        <p>
          Пользователь: {webAppUser.first_name} {webAppUser.last_name}
        </p>
      )}
      {error && <p style={{ color: 'red', marginTop: 8 }}>{error}</p>}
      {!backendUser && (
        <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Button disabled={loading} onClick={() => handleAuth('customer')}>
            Я заказчик
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
            <input
              placeholder="Дата и время работ (ISO: 2026-03-15T10:00:00Z)"
              value={dateTime}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDateTime(e.target.value)}
              style={{ padding: 8, borderRadius: 8, border: '1px solid #ccc' }}
            />
            <input
              placeholder="Окончание аукциона (ISO)"
              value={auctionEndsAt}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAuctionEndsAt(e.target.value)}
              style={{ padding: 8, borderRadius: 8, border: '1px solid #ccc' }}
            />
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
          Экран грузчика пока не реализован. Здесь будет список доступных аукционов и ставки.
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

