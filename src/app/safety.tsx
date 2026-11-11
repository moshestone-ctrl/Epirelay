import { Badge, Button, Card, Screen, T } from '@/components/ui';
import { APP_NAME, CHECKIN_MINUTES, EMERGENCY_NUMBER } from '@/lib/config';
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
        <T>
          • The person who sent the SOS sees a responder on the map only once they’re within about ¼ mile — never
          where they set off from — and only their first name.
        </T>
      </Card>

      <Card>
        <T kind="heading">Your safety as a responder</T>
        <T>• Only go if you feel safe. You can always say no.</T>
        <T>• You never have to go inside. Hand the device over at the door, or ask to meet somewhere you can be seen.</T>
        <T>
          • Before you decide, you’ll see whether the person’s phone number is verified, how long they’ve been a member,
          and whether their earlier SOS alerts ended with help arriving.
        </T>
        <T>
          • While you’re helping, we check on you every {CHECKIN_MINUTES} minutes. If you don’t answer, we text your
          emergency contact where you are.
        </T>
        <T>
          • If anything feels wrong, leave and tap “I feel unsafe”. We stop your response, text your emergency contact
          right away, and put the sender’s account on hold while we review it.
        </T>
      </Card>

      <Card>
        <T kind="heading">Stopping fake and abusive alerts</T>
        <T>• Everyone must be 18 or older.</T>
        <T>• Phone numbers are verified by text message.</T>
        <T>• New accounts can send practice alerts only for their first 24 hours.</T>
        <T>• An account is put on hold automatically after a report of abuse, or after reports from two different people.</T>
        <T>• Sending too many alerts in a short time is blocked.</T>
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
