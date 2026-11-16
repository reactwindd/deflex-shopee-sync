import { useEffect, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { SegmentedControl } from '@astryxdesign/core/SegmentedControl';
import { SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Stack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { api, clearToken, getToken } from './api';
import { LoginScreen } from './LoginScreen';
import { LogView } from './LogView';
import { OrdersView } from './OrdersView';
import { SettingsView } from './SettingsView';
import type { AppConfig } from './types';

type View = 'orders' | 'settings' | 'log';

export default function App() {
  const [authed, setAuthed] = useState(Boolean(getToken()));
  const [view, setView] = useState<View>('orders');
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [error, setError] = useState('');

  const loadConfig = async () => {
    try {
      setCfg(await api.config());
      setError('');
    } catch (e) {
      if (e instanceof Error && (e as { status?: number }).status === 401) {
        clearToken();
        setAuthed(false);
      } else {
        setError(e instanceof Error ? e.message : 'Failed to load config');
      }
    }
  };

  useEffect(() => {
    if (authed) void loadConfig();
  }, [authed]);

  if (!authed) {
    return (
      <LoginScreen
        onLoggedIn={() => {
          setAuthed(true);
          setView('orders');
        }}
      />
    );
  }

  const logout = async () => {
    try {
      await api.logout();
    } catch {
      /* ignore */
    }
    clearToken();
    setAuthed(false);
  };

  return (
    <div className="app-shell">
      <Stack gap={4} align="stretch">
        <HStack gap={3} align="center" justify="between" wrap="wrap">
          <HStack gap={3} align="center">
            <Heading level={2}>Shopee → OBM</Heading>
            <SegmentedControl value={view} onChange={(v) => setView(v as View)} label="View">
              <SegmentedControlItem value="orders" label="Orders" />
              <SegmentedControlItem value="settings" label="Settings" />
              <SegmentedControlItem value="log" label="Log" />
            </SegmentedControl>
          </HStack>
          <HStack gap={2} align="center">
            {error && <Text type="supporting" color="secondary">{error}</Text>}
            <Button label="Log out" variant="ghost" size="sm" onClick={() => void logout()} />
          </HStack>
        </HStack>

        <div style={{ display: view === 'orders' ? 'block' : 'none' }}>
          {cfg ? (
            <OrdersView shops={cfg.shops} onOpenSettings={() => setView('settings')} />
          ) : (
            <Text>Loading…</Text>
          )}
        </div>
        <div style={{ display: view === 'settings' ? 'block' : 'none' }}>
          <SettingsView onConfigChanged={() => void loadConfig()} />
        </div>
        <div style={{ display: view === 'log' ? 'block' : 'none' }}>
          <LogView />
        </div>
      </Stack>
    </div>
  );
}
