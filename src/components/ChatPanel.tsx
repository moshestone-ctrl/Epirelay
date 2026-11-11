import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useAuth } from '@/lib/auth';
import { useRealtime } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';
import { radius, space, useTheme } from '@/lib/theme';
import type { Message } from '@/lib/types';

import { Card, T } from './ui';

/** Two-way messages between the person in need and responders on their way. */
export function ChatPanel({
  alertId,
  canSend,
  nameFor,
  placeholder = 'Type a message',
}: {
  alertId: string;
  canSend: boolean;
  nameFor: (senderId: string) => string;
  placeholder?: string;
}) {
  const t = useTheme();
  const { session } = useAuth();
  const me = session?.user.id;
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMessages = useCallback(async () => {
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('alert_id', alertId)
      .order('created_at', { ascending: true })
      .limit(200);
    return (data as Message[] | null) ?? null;
  }, [alertId]);

  const load = useCallback(async () => {
    const data = await fetchMessages();
    if (data) setMessages(data);
  }, [fetchMessages]);

  useEffect(() => {
    let ignore = false;
    fetchMessages().then((data) => {
      if (data && !ignore) setMessages(data);
    });
    return () => {
      ignore = true;
    };
  }, [fetchMessages]);
  useRealtime(`chat-${alertId}`, [{ table: 'messages', filter: `alert_id=eq.${alertId}`, event: 'INSERT' }], load);

  const send = async () => {
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    setError(null);
    const { error: err } = await supabase.from('messages').insert({ alert_id: alertId, body });
    setSending(false);
    if (err) setError('Message not sent. ' + err.message);
    else {
      setDraft('');
      load();
    }
  };

  return (
    <Card>
      <T kind="label">Messages</T>
      {messages.length === 0 ? (
        <T kind="small">No messages yet.</T>
      ) : (
        messages.map((m) => {
          const mine = m.sender_id === me;
          return (
            <View
              key={m.id}
              style={[
                styles.bubble,
                mine ? { alignSelf: 'flex-end', backgroundColor: t.accent } : { alignSelf: 'flex-start', backgroundColor: t.cardAlt },
              ]}>
              {!mine && <Text style={[styles.sender, { color: t.muted }]}>{nameFor(m.sender_id)}</Text>}
              <Text style={{ color: mine ? t.onAccent : t.text, fontSize: 16 }}>{m.body}</Text>
            </View>
          );
        })
      )}
      {canSend && (
        <View style={styles.row}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={placeholder}
            placeholderTextColor={t.muted}
            maxLength={1000}
            style={[styles.input, { borderColor: t.border, color: t.text, backgroundColor: t.input }]}
            onSubmitEditing={send}
            returnKeyType="send"
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send message"
            onPress={send}
            disabled={sending || !draft.trim()}
            style={[styles.send, { backgroundColor: t.accent, opacity: sending || !draft.trim() ? 0.5 : 1 }]}>
            <Text style={{ color: t.onAccent, fontWeight: '700' }}>Send</Text>
          </Pressable>
        </View>
      )}
      {error ? <T kind="small" style={{ color: t.danger }}>{error}</T> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  bubble: { maxWidth: '85%', borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 8 },
  sender: { fontSize: 12, fontWeight: '600', marginBottom: 2 },
  row: { flexDirection: 'row', gap: space.sm, marginTop: space.xs },
  input: { flex: 1, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  send: { borderRadius: radius.sm, paddingHorizontal: 16, justifyContent: 'center' },
});
