import { useState } from 'react';
import { Alert, View } from 'react-native';

import { api, errorMessage } from '@/lib/api';
import { space } from '@/lib/theme';

import { Button, Card, T } from './ui';

const REASONS = [
  { value: 'fake', label: 'It was fake or a prank' },
  { value: 'no_one_there', label: 'Nobody was there' },
  { value: 'abusive', label: 'Abusive or threatening' },
] as const;

/** Lets a responder flag an SOS. Reports go to the EpiRelay team (admin notebook in Supabase). */
export function ReportPanel({ alertId }: { alertId: string }) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  if (sent) {
    return <T kind="small" style={{ textAlign: 'center' }}>Thanks — the EpiRelay team will review this alert.</T>;
  }
  if (!open) {
    return <Button kind="ghost" title="Report a problem with this alert" onPress={() => setOpen(true)} />;
  }

  const send = async (reason: (typeof REASONS)[number]['value']) => {
    setBusy(reason);
    try {
      const r = await api.reportAlert(alertId, reason);
      if (r.ok) setSent(true);
      else Alert.alert('Could not send report', 'Only people who were alerted can report an SOS.');
    } catch (e) {
      Alert.alert('Could not send report', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <T kind="label">What went wrong?</T>
      <View style={{ gap: space.sm }}>
        {REASONS.map((r) => (
          <Button key={r.value} kind="secondary" title={r.label} loading={busy === r.value} onPress={() => send(r.value)} />
        ))}
        <Button kind="ghost" title="Cancel" onPress={() => setOpen(false)} />
      </View>
    </Card>
  );
}
