import { useMemo, useState } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { Divider } from '@astryxdesign/core/Divider';
import { HStack } from '@astryxdesign/core/HStack';
import { SegmentedControl } from '@astryxdesign/core/SegmentedControl';
import { SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Spinner } from '@astryxdesign/core/Spinner';
import { Stack } from '@astryxdesign/core/Stack';
import { Table, pixel, proportional } from '@astryxdesign/core/Table';
import type { TableColumn } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { api, fmtDate, fmtRm, imgSrc } from './api';
import { CopyId } from './CopyId';
import type { PreviewItem, PreviewOrder, ShopConfig, SyncResult } from './types';

type LineRow = PreviewItem & Record<string, unknown>;

interface Props {
  shops: ShopConfig[];
  onOpenSettings: () => void;
}

export function OrdersView({ shops, onOpenSettings }: Props) {
  const [shopIdx, setShopIdx] = useState(0);
  const [orders, setOrders] = useState<PreviewOrder[]>([]);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const [results, setResults] = useState<SyncResult[] | null>(null);
  const [allSyncedDismissed, setAllSyncedDismissed] = useState(false);

  const shop = shops[shopIdx];
  const selected = orders.filter((o) => o.selected && !o.alreadySynced);
  const readyCount = orders.filter((o) => !o.alreadySynced && o.ok).length;
  const allSynced = orders.length > 0 && orders.every((o) => o.alreadySynced);

  const fetchOrders = async () => {
    setBusy(true);
    setError('');
    setResults(null);
    setAllSyncedDismissed(false);
    try {
      const r = await api.preview(shopIdx);
      setOrders(r.orders.map((o) => ({ ...o, selected: false })));
      setFetchedAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fetch failed');
    } finally {
      setBusy(false);
    }
  };

  const selectAllReady = () => {
    setOrders((prev) => prev.map((o) => ({ ...o, selected: !o.alreadySynced && o.ok })));
  };

  const doSync = async () => {
    setSyncing(true);
    setError('');
    setResults(null);
    try {
      const r = await api.sync(shopIdx, selected.map((o) => o.orderSn));
      setResults(r.results);
      const p = await api.preview(shopIdx); // refresh "already synced" flags
      setOrders(p.orders.map((o) => ({ ...o, selected: false })));
      setFetchedAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Stack gap={4} align="stretch">
      {/* shop + action bar */}
      <HStack gap={3} wrap="wrap" align="center" justify="between">
        <HStack gap={3} wrap="wrap" align="center">
          <SegmentedControl
            value={String(shopIdx)}
            onChange={(v) => {
              setShopIdx(Number(v));
              setOrders([]);
              setFetchedAt(null);
              setResults(null);
            }}
            label="Shop"
          >
            {shops.map((s, i) => (
              <SegmentedControlItem key={i} value={String(i)} label={s.name} />
            ))}
          </SegmentedControl>
          {shop && !shop.active && <Badge variant="warning" label="Inactive — enable in Settings" />}
          {shop && !shop.hasTokens && <Badge variant="error" label="Not connected — Settings → Connect" />}
        </HStack>
        <HStack gap={2} align="center">
          <Button label="Select all ready" variant="ghost" size="sm" isDisabled={readyCount === 0} onClick={selectAllReady} />
          <Button label="Fetch Shopee orders" isLoading={busy} onClick={fetchOrders} />
          <Button
            label={`Sync ${selected.length} selected`}
            variant="primary"
            isDisabled={selected.length === 0}
            isLoading={syncing}
            clickAction={doSync}
          />
        </HStack>
      </HStack>

      {error && <Badge variant="error" label={error} />}

      {/* all-caught-up popup (nothing to sync) */}
      {allSynced && !allSyncedDismissed && (
        <Banner
          status="success"
          title="Everything is synced and up to date"
          description={`All ${orders.length} fetched orders are already in OBM — there is nothing to sync.`}
          isDismissable
          onDismiss={() => setAllSyncedDismissed(true)}
        />
      )}

      {/* fetch summary */}
      {fetchedAt && (
        <HStack gap={3} align="center">
          <Text type="supporting" color="secondary">
            Fetched {orders.length} orders at {fetchedAt.toLocaleTimeString()}.{' '}
            {orders.filter((o) => !o.alreadySynced).length} not yet in OBM ·{' '}
            {orders.filter((o) => !o.alreadySynced && !o.ok).length} with SKU issues.
          </Text>
          {busy && <Spinner size="sm" label="" />}
        </HStack>
      )}

      {/* sync results */}
      {results && (
        <Card elevation="low" className="results-card">
          <Stack gap={2} align="start">
            <Text weight="semibold">Sync results</Text>
            {results.map((r) => (
              <HStack key={r.orderSn} gap={2} wrap="wrap" align="center">
                <Badge
                  variant={
                    r.status === 'created' ? 'success' : r.status === 'error' ? 'error' : r.status === 'skipped' ? 'warning' : 'info'
                  }
                  label={r.status === 'created' ? 'CREATED' : r.status === 'exists' ? 'ALREADY EXISTS' : r.status.toUpperCase()}
                />
                <CopyId text={r.orderSn} size="sm" />
                {r.transNo && <span className="mono">{r.transNo}</span>}
                {r.total !== undefined && <Text type="supporting">{fmtRm(r.total)}</Text>}
                {r.message && <Text type="supporting" color="secondary">{r.message}</Text>}
              </HStack>
            ))}
          </Stack>
        </Card>
      )}

      {/* orders */}
      {orders.length === 0 && !busy && (
        <Card elevation="low">
          <Stack gap={2} align="start">
            <Text>
              {shop && (!shop.active || !shop.hasTokens)
                ? 'This shop is not ready — check Settings to activate and connect it.'
                : 'No orders fetched yet. Click “Fetch Shopee orders” to pull PROCESSED orders.'}
            </Text>
            {shop && (!shop.active || !shop.hasTokens) && (
              <Button label="Open settings" variant="secondary" size="sm" onClick={onOpenSettings} />
            )}
          </Stack>
        </Card>
      )}

      {orders.map((o) => (
        <OrderCard
          key={o.orderSn}
          order={o}
          onToggle={(checked) =>
            setOrders((prev) => prev.map((x) => (x.orderSn === o.orderSn ? { ...x, selected: checked } : x)))
          }
        />
      ))}
    </Stack>
  );
}

function buildColumns(orderSn: string): TableColumn<LineRow>[] {
  return [
    {
      key: 'image',
      header: '',
      width: pixel(64),
      renderCell: (it: LineRow) => (
        <img className="line-img" src={it.imageUrl ? imgSrc(it.imageUrl) : undefined} alt="" loading="lazy" />
      ),
    },
    {
      key: 'product',
      header: 'Product',
      width: proportional(3),
      renderCell: (it: LineRow) => (
        <Stack gap={0} align="start">
          <Text type="inherit" maxLines={2}>
            {it.name}
            {it.variant ? <span className="variant-chip">{it.variant}</span> : null}
          </Text>
          <Text type="supporting" size="2xs" color={it.match ? 'secondary' : 'placeholder'}>
            {it.match ? `OBM: ${it.productName}` : 'OBM: SKU not found'}
          </Text>
        </Stack>
      ),
    },
    {
      key: 'sku',
      header: 'SKU',
      width: pixel(110),
      renderCell: (it: LineRow) => <span className="mono">{it.sku}</span>,
    },
    {
      key: 'orderId',
      header: 'Order ID',
      width: pixel(160),
      renderCell: () => <CopyId text={orderSn} size="sm" />,
    },
    {
      key: 'qty',
      header: 'Qty',
      width: pixel(56),
      align: 'end',
      renderCell: (it: LineRow) => <Text type="inherit">{it.qty}</Text>,
    },
    {
      key: 'price',
      header: 'Unit price',
      width: pixel(96),
      align: 'end',
      renderCell: (it: LineRow) => <Text type="inherit">{fmtRm(it.price)}</Text>,
    },
    {
      key: 'total',
      header: 'Total',
      width: pixel(104),
      align: 'end',
      renderCell: (it: LineRow) => (
        <Text type="inherit" weight="semibold">
          {fmtRm(it.qty * it.price)}
        </Text>
      ),
    },
  ];
}

function OrderCard({ order, onToggle }: { order: PreviewOrder; onToggle: (checked: boolean) => void }) {
  const columns = useMemo(() => buildColumns(order.orderSn), [order.orderSn]);
  const selectable = !order.alreadySynced && order.ok;
  const hasSkuIssue = !order.alreadySynced && !order.ok;

  const rows: LineRow[] = order.items as LineRow[];

  return (
    <Card elevation="low" className="order-card">
      <Stack gap={3} align="stretch">
        <HStack gap={3} wrap="wrap" align="center" justify="between">
          <HStack gap={2} align="center">
            {!order.alreadySynced && (
              <CheckboxInput
                label={order.orderSn}
                isLabelHidden
                value={Boolean(order.selected)}
                isDisabled={!selectable}
                onChange={onToggle}
                disabledMessage={order.ok ? undefined : 'Fix SKU mismatch first'}
              />
            )}
            <CopyId text={order.orderSn} />
            {hasSkuIssue && <Badge variant="error" label="SKU issue" />}
          </HStack>
          <HStack gap={3} align="center">
            <Text type="supporting" color="secondary">
              {order.buyerName ? `${order.buyerName} · ` : ''}
              {fmtDate(order.payTime)}
            </Text>
            <Text weight="semibold" type="large">
              {fmtRm(order.total)}
            </Text>
          </HStack>
        </HStack>
        <Divider />
        <Table data={rows} columns={columns} idKey={(r) => r.sku} density="compact" hasHover dividers="rows" />
      </Stack>
    </Card>
  );
}
