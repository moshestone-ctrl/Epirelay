import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Button, Card, Field, Screen, T } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { space, useTheme } from '@/lib/theme';

export default function Feedback() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase
      .from('feedback')
      .insert({ alert_id: id, rating, comment: comment.trim() || null });
    setBusy(false);
    if (err && !err.message.includes('duplicate')) setError(err.message);
    else router.replace('/');
  };

  return (
    <Screen>
      <T kind="title">Thank you</T>
      <T kind="muted">Your feedback helps make the network faster and safer. It’s only seen by our team.</T>

      <Card>
        <T kind="label">How did it go?</T>
        <View style={{ flexDirection: 'row', gap: space.sm, justifyContent: 'center', paddingVertical: space.sm }}>
          {[1, 2, 3, 4, 5].map((n) => (
            <Pressable
              key={n}
              accessibilityRole="radio"
              accessibilityLabel={`${n} star${n > 1 ? 's' : ''}`}
              accessibilityState={{ selected: rating === n }}
              onPress={() => setRating(n)}
              hitSlop={8}>
              <Text style={{ fontSize: 40, color: n <= rating ? '#F5B301' : t.border }}>★</Text>
            </Pressable>
          ))}
        </View>
        <Field
          label="Anything we should know? (optional)"
          value={comment}
          onChangeText={setComment}
          multiline
          maxLength={1000}
          placeholder="What worked, what didn’t"
        />
      </Card>

      {error && (
        <Card tone="danger">
          <T>{error}</T>
        </Card>
      )}
      <Button title="Send feedback" onPress={submit} disabled={rating === 0} loading={busy} />
      <Button kind="ghost" title="Skip" onPress={() => router.replace('/')} />

      <Card>
        <T kind="small">
          After a severe reaction, please follow up with your doctor and replace any epinephrine that was used.
        </T>
      </Card>
    </Screen>
  );
}
