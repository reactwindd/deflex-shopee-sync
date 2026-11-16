import { useEffect, useState } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { Dialog } from '@astryxdesign/core/Dialog';
import { Divider } from '@astryxdesign/core/Divider';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Stack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { api } from './api';
import type { AppConfig, Customer } from './types';

interface Props {
  onConfigChanged: () => void;
}

function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

export function SettingsView({ onConfigChanged }: Props) {
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const load = async () => {
    try {
      const [c, cu] = await Promise.all([api.config(), api.customers()]);
      setCfg(c);
      setCustomers(cu.customers);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load settings');
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nextSlot = cfg ? cfg.shops.findIndex((s) => !s.hasTokens) : -1;
  const authorized = cfg ? cfg.shops.map((s, i) => ({ s, i })).filter((x) => x.s.hasTokens) : [];

  const authorizeNew = async () => {
    if (!cfg) return;
    setError('');
    setInfo('');
    try {
      const r = await api.authLink(nextSlot);
      window.open(r.authUrl, '_blank', 'noopener');
      setInfo('Authorization page opened — complete the Shopee login there.');
      for (let i = 0; i < 40; i++) {
        await new Promise((res) => setTimeout(res, 3000));
        const c = await api.config();
        if (c.shops[nextSlot] && c.shops[nextSlot].hasTokens) {
          setCfg(c);
          setInfo('Authorized successfully ✓');
          onConfigChanged();
          return;
        }
      }
      setInfo('Timed out waiting for authorization — close the tab and try again.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Authorize failed');
    }
  };

  const saveCustomer = async (idx: number, customerPkey: number) => {
    if (!cfg) return;
    setCfg({ ...cfg, shops: cfg.shops.map((s, j) => (j === idx ? { ...s, customerPkey } : s)) });
    try {
      await api.saveConfig({ shops: cfg.shops.map((s, j) => (j === idx ? { customerPkey } : {})) });
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    }
  };

  if (!cfg) {
    return <Text>Loading settings…</Text>;
  }

  return (
    <Stack gap={4} align="stretch">
      <HStack gap={3} align="center" justify="between">
        <Heading level={3}>Shopee authorization</Heading>
        <IconButton
          label="Advanced settings"
          icon={<GearIcon />}
          variant="ghost"
          tooltip="Advanced settings"
          onClick={() => setShowAdvanced(true)}
        />
      </HStack>

      {/* big authorize button */}
      <Card elevation="low">
        <Stack gap={2} align="center">
          <Button
            label="Authorize New Account"
            variant="primary"
            size="lg"
            isLoading={busy}
            isDisabled={nextSlot === -1}
            clickAction={authorizeNew}
          />
          <Text type="supporting" color="secondary">
            {nextSlot === -1
              ? 'All accounts are authorized.'
              : `Next: authorizes “${cfg.shops[nextSlot].name}” (currently not connected).`}
          </Text>
          {info && <Text type="supporting">{info}</Text>}
          {error && <Badge variant="error" label={error} />}
        </Stack>
      </Card>

      {/* authorized accounts list */}
      {authorized.length === 0 ? (
        <Text color="secondary">No accounts authorized yet — click the button above to connect your first Shopee account.</Text>
      ) : (
        authorized.map(({ s, i }) => (
          <Card key={i} elevation="low">
            <HStack gap={4} wrap="wrap" align="center" justify="between">
              <Stack gap={1} align="start">
                <HStack gap={2} align="center">
                  <Heading level={4}>{s.name}</Heading>
                  <Badge variant="success" label="Authorized" />
                </HStack>
                <Text type="supporting" color="secondary">
                  Shop ID {s.shopId || '—'}
                </Text>
              </Stack>
              <div className="select-field">
                <Text type="label" as="label">
                  Sales go to OBM customer
                </Text>
                <select
                  value={String(s.customerPkey)}
                  onChange={(e) => void saveCustomer(i, Number(e.target.value))}
                >
                  {customers.map((c) => (
                    <option key={c.pkey} value={String(c.pkey)}>
                      {c.name} ({c.pkey})
                    </option>
                  ))}
                </select>
              </div>
            </HStack>
          </Card>
        ))
      )}

      <AdvancedModal
        open={showAdvanced}
        onClose={() => setShowAdvanced(false)}
        initial={cfg}
        onSaved={() => {
          setShowAdvanced(false);
          void load();
          onConfigChanged();
        }}
        onError={(m) => setError(m)}
      />
    </Stack>
  );
}

function AdvancedModal({
  open,
  onClose,
  initial,
  onSaved,
  onError,
}: {
  open: boolean;
  onClose: () => void;
  initial: AppConfig;
  onSaved: () => void;
  onError: (m: string) => void;
}) {
  const [cfg, setCfg] = useState<AppConfig>(initial);
  const [partnerKey, setPartnerKey] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [tokens, setTokens] = useState<Record<number, { access: string; refresh: string }>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setCfg(initial);
      setPartnerKey('');
      setAdminPassword('');
      setTokens({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const save = async () => {
    setBusy(true);
    try {
      await api.saveConfig({
        partnerId: cfg.partnerId,
        partnerKey,
        adminPassword,
        daysBack: Number(cfg.daysBack) || 7,
        sellerCenterUrl: cfg.sellerCenterUrl,
        shops: cfg.shops.map((s, i) => ({
          shopId: s.shopId,
          customerPkey: s.customerPkey,
          active: s.active,
          accessToken: (tokens[i] && tokens[i].access) || '',
          refreshToken: (tokens[i] && tokens[i].refresh) || '',
        })),
      });
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog isOpen={open} onOpenChange={(v) => !v && onClose()} width={640} purpose="form">
      <Stack gap={3} align="stretch" className="advanced-modal">
        <HStack gap={3} align="center" justify="between">
          <Heading level={4}>Advanced settings</Heading>
          <IconButton label="Close" icon={<CloseIcon />} variant="ghost" onClick={onClose} />
        </HStack>
        <Divider />

        <Text type="label">Shopee API credentials</Text>
        <div className="form-grid">
          <TextInput label="Partner ID" value={cfg.partnerId} onChange={(v) => setCfg({ ...cfg, partnerId: v })} width="100%" />
          <TextInput
            label="Partner key"
            type="password"
            value={partnerKey}
            onChange={(v) => setPartnerKey(v)}
            placeholder={initial.partnerKeyMasked || 'Not set'}
            width="100%"
          />
          <TextInput
            label="Lookback (days)"
            value={String(cfg.daysBack)}
            onChange={(v) => setCfg({ ...cfg, daysBack: Number(v) || 7 })}
            width="100%"
          />
          <TextInput
            label="Seller Centre URL (for reference)"
            value={cfg.sellerCenterUrl}
            onChange={(v) => setCfg({ ...cfg, sellerCenterUrl: v })}
            width="100%"
          />
        </div>

        <Divider />
        <Text type="label">Shops (access tokens are stored in config.json on the server)</Text>
        {cfg.shops.map((s, i) => (
          <Card key={i} elevation="none" className="inner-card">
            <Stack gap={3} align="stretch">
              <Text weight="semibold">{s.name}</Text>
              <div className="form-grid-3">
                <TextInput
                  label="Shop ID"
                  value={s.shopId}
                  onChange={(v) => setCfg({ ...cfg, shops: cfg.shops.map((x, j) => (j === i ? { ...x, shopId: v } : x)) })}
                  width="100%"
                />
                <TextInput
                  label="Access token"
                  type="password"
                  value={tokens[i] ? tokens[i].access : ''}
                  onChange={(v) => setTokens({ ...tokens, [i]: { access: v, refresh: tokens[i] ? tokens[i].refresh : '' } })}
                  placeholder={s.accessTokenMasked || '—'}
                  width="100%"
                />
                <TextInput
                  label="Refresh token"
                  type="password"
                  value={tokens[i] ? tokens[i].refresh : ''}
                  onChange={(v) => setTokens({ ...tokens, [i]: { refresh: v, access: tokens[i] ? tokens[i].access : '' } })}
                  placeholder={s.refreshTokenMasked || '—'}
                  width="100%"
                />
              </div>
              <CheckboxInput
                label="Active (included in fetch/sync)"
                value={s.active}
                onChange={(v) => setCfg({ ...cfg, shops: cfg.shops.map((x, j) => (j === i ? { ...x, active: v } : x)) })}
              />
            </Stack>
          </Card>
        ))}

        <Divider />
        <TextInput
          label="Admin password"
          type="password"
          value={adminPassword}
          onChange={(v) => setAdminPassword(v)}
          width="100%"
          description="Stored in config.json next to the Shopee tokens. Leave blank to keep the current password."
        />

        <HStack gap={2} align="center" justify="end">
          <Button label="Cancel" variant="ghost" onClick={onClose} />
          <Button label="Save" variant="primary" isLoading={busy} clickAction={save} />
        </HStack>
      </Stack>
    </Dialog>
  );
}
