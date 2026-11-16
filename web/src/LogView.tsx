import { useEffect, useState } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { HStack } from '@astryxdesign/core/HStack';
import { Stack } from '@astryxdesign/core/Stack';
import { Table, pixel, proportional } from '@astryxdesign/core/Table';
import type { TableColumn } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { api, fmtDate, fmtRm } from './api';
import { CopyId } from './CopyId';
import type { LogEntry } from './types';

type LogRow = LogEntry & Record<string, unknown>;

const columns: TableColumn<LogRow>[] = [
  {
    key: 'orderSn',
    header: 'Order ID',
    width: pixel(180),
    renderCell: (r: LogRow) => <CopyId text={String(r.orderSn)} size="sm" />,
  },
  {
    key: 'shop',
    header: 'Shop',
    width: proportional(1),
    renderCell: (r: LogRow) => <Text type="inherit">{String(r.shopName)}</Text>,
  },
  {
    key: 'transNo',
    header: 'OBM transaction',
    width: pixel(150),
    renderCell: (r: LogRow) => <span className="mono">{String(r.transNo)}</span>,
  },
  {
    key: 'total',
    header: 'Total',
    width: pixel(100),
    align: 'end',
    renderCell: (r: LogRow) => <Text type="inherit">{fmtRm(Number(r.total))}</Text>,
  },
  {
    key: 'at',
    header: 'Synced at',
    width: proportional(1),
    renderCell: (r: LogRow) => <Text type="inherit">{fmtDate(String(r.at))}</Text>,
  },
];

export function LogView() {
  const [log, setLog] = useState<LogEntry[]>([]);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const r = await api.log();
      setLog(r.log);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load log');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <Stack gap={3} align="stretch">
      <HStack gap={3} align="center" justify="between">
        <Text type="supporting" color="secondary">
          Orders synced to OBM by this tool (newest first).
        </Text>
        <Button label="Refresh" variant="secondary" size="sm" onClick={() => void load()} />
      </HStack>
      {error && <Badge variant="error" label={error} />}
      <Card elevation="low">
        {log.length === 0 ? (
          <Text color="secondary">Nothing synced yet.</Text>
        ) : (
          <Table
            data={log as LogRow[]}
            columns={columns}
            idKey={(r) => String(r.orderSn) + String(r.at)}
            density="balanced"
            hasHover
            dividers="rows"
          />
        )}
      </Card>
    </Stack>
  );
}
