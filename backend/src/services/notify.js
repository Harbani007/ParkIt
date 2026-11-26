// Booking emails through Amazon SNS (D21). Optional: with no SNS_TOPIC_ARN nothing is sent.
//
// One topic for the facility. Each customer's email is subscribed with a filter policy on their own
// address, and every message carries an `email` attribute, so SNS delivers a booking email only to
// that customer. An owner subscription without a filter receives every message.
//
// Sending is best effort and happens after the HTTP response: an SNS failure is logged and never
// fails a registration or a booking. Credentials come from the EC2 instance role, never from keys.
import { SNSClient, PublishCommand, SubscribeCommand } from '@aws-sdk/client-sns';
import { config } from '../config.js';

export function createSnsNotifier({ client, topicArn = config.snsTopicArn, region = config.awsRegion } = {}) {
  let sns = client;
  const send = (command) => {
    sns ??= new SNSClient({ region });
    return sns.send(command);
  };
  return {
    enabled: Boolean(topicArn),
    async subscribe(email) {
      if (!topicArn) return;
      await send(
        new SubscribeCommand({
          TopicArn: topicArn,
          Protocol: 'email',
          Endpoint: email,
          Attributes: { FilterPolicy: JSON.stringify({ email: [email] }) },
        }),
      );
    },
    async publish({ email, subject, message }) {
      if (!topicArn) return;
      await send(
        new PublishCommand({
          TopicArn: topicArn,
          Subject: subject,
          Message: message,
          MessageAttributes: { email: { DataType: 'String', StringValue: email } },
        }),
      );
    },
  };
}

let notifier;
export function getNotifier() {
  notifier ??= createSnsNotifier();
  return notifier;
}
/** Test seam: replace the notifier (pass undefined to go back to the configured one). */
export function setNotifier(next) {
  notifier = next;
}

const IST_FORMAT = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const ist = (t) => `${IST_FORMAT.format(new Date(t))} IST`;

/** Subject and text of a booking email. kind: 'confirmed' | 'cancelled'. */
export function bookingEmail(kind, row) {
  const lines = [
    `Hello ${row.customer_name},`,
    '',
    kind === 'confirmed'
      ? 'Your ParkIt booking is confirmed.'
      : 'Your ParkIt booking has been cancelled and your payment refunded (simulated payment).',
    '',
    `Booking code: ${row.booking_code}`,
    `Slot: ${row.slot_code} (${row.slot_vehicle_type})`,
    `Vehicle: ${row.vehicle_number}`,
    `From: ${ist(row.starts_at)}`,
    `To: ${ist(row.ends_at)}`,
    `Amount: Rs ${row.amount}`,
    '',
    kind === 'confirmed'
      ? 'Show the booking code or the QR code in the app at the gate. Check-in opens 15 minutes before the start.'
      : 'You can book another slot at any time.',
    '',
    'ParkIt',
  ];
  // SNS email subjects must be ASCII, single line and under 100 characters.
  const subject = `ParkIt booking ${row.booking_code} ${kind}`;
  return { subject, message: lines.join('\n') };
}

const logFailure = (what) => (err) => console.error(`SNS ${what} failed: ${err.message}`);

/** Fire and forget: subscribe a new customer's email. Returns the promise (tests await it). */
export function subscribeCustomer(email) {
  return Promise.resolve()
    .then(() => getNotifier().subscribe(email))
    .catch(logFailure('subscribe'));
}

/** Fire and forget: email the booking's customer. `row` is a joined booking row. */
export function sendBookingEmail(kind, row) {
  return Promise.resolve()
    .then(() => getNotifier().publish({ email: row.customer_email, ...bookingEmail(kind, row) }))
    .catch(logFailure('publish'));
}
