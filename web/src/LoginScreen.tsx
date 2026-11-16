import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
import { Stack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { api, ApiError } from './api';

export function LoginScreen({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await api.login(password);
      localStorage.setItem('shopee-sync-token', r.token);
      onLoggedIn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <Card elevation="low" className="login-card">
        <Stack gap={3} align="start">
          <Heading level={2}>Shopee → OBM Sync</Heading>
          <Text color="secondary" type="supporting">
            Enter the admin password to manage Shopee order sync.
          </Text>
          <TextInput
            label="Password"
            type="password"
            value={password}
            onChange={(v) => setPassword(v)}
            placeholder="Admin password"
            width="100%"
            hasAutoFocus
            status={error ? { type: 'error', message: error } : undefined}
          />
          <Button
            label="Sign in"
            variant="primary"
            width="100%"
            isLoading={busy}
            clickAction={submit}
            type="submit"
          />
        </Stack>
      </Card>
    </div>
  );
}
