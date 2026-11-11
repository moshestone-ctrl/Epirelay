import { Badge, Button, Card, Screen, T } from '@/components/ui';
import { APP_NAME, EMERGENCY_NUMBER } from '@/lib/config';
import { callEmergency } from '@/lib/location';

export default function Safety() {
  return (
    <Screen>
      <Card tone="danger">
        <T kind="heading">If someone is having a severe allergic reaction</T>
        <T>1. Call {EMERGENCY_NUMBER}. Say “anaphylaxis”.</T>
        <T>2. Use epinephrine right away — don’t wait to see if it gets worse. Follow the instructions on the device.</T>
        <T>3. Lie the person flat with legs raised. If breathing is hard, let them sit up. If vomiting, lay them on their side.</T>
        <T>4. If there’s no improvement after 5–15 minutes and a second dose is available, it may be given as the device instructions describe.</T>
        <T>5. Go to the emergency room even if they feel better — symptoms can return hours later.</T>
        <Button kind="danger" title={`Call ${EMERGENCY_NUMBER}`} onPress={callEmergency} />
        <T kind="small">
          General information, not medical advice. Follow the person’s own emergency care plan if they have one.
        </T>
      </Card>

      <Card>
        <T kind="heading">How {APP_NAME} works</T>
        <T>• Your SOS alerts available carriers within about 2 miles. You can widen it to about 5 miles.</T>
        <T>• Responders see only your distance until they commit to coming; then they see where you are.</T>
        <T>• Responders hand over the device. The person who needs it — or someone with them — uses it.</T>
        <T>• Up to 3 responders can come at once, in case a second dose is needed.</T>
        <T>• Nobody can see where carriers are. The app only shows how many are nearby.</T>
      </Card>

      <Card tone="warn">
        <Badge text="DRAFT — LAWYER REVIEW NEEDED" tone="warn" />
        <T kind="heading">Legal</T>
        <T>
          [Placeholder. Before launch, replace this section with text from a lawyer licensed in your launch states:
          a plain-English summary of Good Samaritan protections and prescription-sharing rules for each state, the
          Terms of Use, the Privacy Policy, and any participant waiver.]
        </T>
      </Card>
    </Screen>
  );
}
