import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { PublishCommand, SubscribeCommand } from '@aws-sdk/client-sns';
import { config } from '../src/config.js';
import { createApp } from '../src/app.js';
import { bookingEmail, createSnsNotifier, setNotifier } from '../src/services/notify.js';
import { createSlot, createUser, dbUp, ensureFacility, istIso, pool, tracker, uniq } from './helpers.js';

const TOPIC = 'arn:aws:sns:us-east-1:123456789012:parkit-bookings';

// A fake SNS client that records the commands it is sent.
function fakeClient({ fail = false } = {}) {
  const sent = [];
  return {
    sent,
    async send(cmd) {
      sent.push(cmd);
      if (fail) throw new Error('AccessDenied');
      return {};
    },
  };
}

const row = {
  booking_code: 'PK-7KQ2XM',
  customer_name: 'Asha',
  customer_email: 'asha@example.com',
  slot_code: 'A-01',
  slot_vehicle_type: 'car',
  vehicle_number: 'DL3CAB1234',
  starts_at: '2026-12-01T04:30:00.000Z',
  ends_at: '2026-12-01T06:30:00.000Z',
  amount: '80.00',
};

describe('SNS notifier (unit)', () => {
  it('subscribes an email with a filter policy on that email', async () => {
    const client = fakeClient();
    await createSnsNotifier({ client, topicArn: TOPIC }).subscribe('asha@example.com');
    expect(client.sent).toHaveLength(1);
    const cmd = client.sent[0];
    expect(cmd).toBeInstanceOf(SubscribeCommand);
    expect(cmd.input).toMatchObject({ TopicArn: TOPIC, Protocol: 'email', Endpoint: 'asha@example.com' });
    expect(JSON.parse(cmd.input.Attributes.FilterPolicy)).toEqual({ email: ['asha@example.com'] });
  });

  it('publishes with the email as a message attribute', async () => {
    const client = fakeClient();
    await createSnsNotifier({ client, topicArn: TOPIC }).publish({ email: 'a@b.co', subject: 'S', message: 'M' });
    const cmd = client.sent[0];
    expect(cmd).toBeInstanceOf(PublishCommand);
    expect(cmd.input).toMatchObject({
      TopicArn: TOPIC,
      Subject: 'S',
      Message: 'M',
      MessageAttributes: { email: { DataType: 'String', StringValue: 'a@b.co' } },
    });
  });

  it('does nothing without a topic', async () => {
    const client = fakeClient();
    const n = createSnsNotifier({ client, topicArn: '' });
    expect(n.enabled).toBe(false);
    await n.subscribe('a@b.co');
    await n.publish({ email: 'a@b.co', subject: 'S', message: 'M' });
    expect(client.sent).toHaveLength(0);
  });

  it('builds an ASCII subject and a message with IST times', () => {
    const { subject, message } = bookingEmail('confirmed', row);
    expect(subject).toBe('ParkIt booking PK-7KQ2XM confirmed');
    expect(subject).toMatch(/^[\x20-\x7e]{1,99}$/);
    expect(message).toContain('Booking code: PK-7KQ2XM');
    expect(message).toContain('Slot: A-01 (car)');
    expect(message).toContain('10:00'); // 04:30 UTC = 10:00 IST
    expect(message).toContain('Rs 80.00');
    expect(bookingEmail('cancelled', row).subject).toBe('ParkIt booking PK-7KQ2XM cancelled');
  });
});

describe.skipIf(!dbUp)('booking emails through the API', () => {
  const app = createApp();
  const originalDir = config.uploadsDir;
  const originalFacility = config.facilityId;
  let tmp;
  let facilityId;
  let client;
  let errorSpy;

  // The emails are sent after the response; wait for the fake to receive them.
  const sentOf = async (Type, n = 1) => {
    await vi.waitFor(() => expect(client.sent.filter((c) => c instanceof Type).length).toBeGreaterThanOrEqual(n));
    return client.sent.filter((c) => c instanceof Type);
  };
  const as = (u) => ({ Authorization: `Bearer ${u.token}` });
  const plate = () => `V${randomBytes(4).toString('hex').toUpperCase()}`;

  beforeAll(async () => {
    await ensureFacility();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parkit-notify-'));
    config.uploadsDir = tmp;
    const { rows } = await pool.query(
      `INSERT INTO facilities (name, opens_at, closes_at) VALUES ('Test ' || $1::text, '00:00', '23:30') RETURNING id`,
      [randomBytes(4).toString('hex')],
    );
    facilityId = rows[0].id;
    config.facilityId = facilityId;
  });

  afterEach(() => {
    setNotifier(undefined);
    errorSpy?.mockRestore();
  });

  afterAll(async () => {
    await tracker.cleanup();
    await pool.query('DELETE FROM facilities WHERE id = $1', [facilityId]);
    config.uploadsDir = originalDir;
    config.facilityId = originalFacility;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const useFake = (opts) => {
    client = fakeClient(opts);
    setNotifier(createSnsNotifier({ client, topicArn: TOPIC }));
  };

  it('GET /api/config reports whether emails are on', async () => {
    setNotifier(createSnsNotifier({ client: fakeClient(), topicArn: '' }));
    expect((await request(app).get('/api/config')).body).toEqual({ email_notifications: false });
    useFake();
    expect((await request(app).get('/api/config')).body).toEqual({ email_notifications: true });
  });

  it('subscribes a newly registered customer', async () => {
    useFake();
    const email = `n-${uniq()}@example.com`;
    const res = await request(app).post('/api/auth/register').send({ name: 'N', email, password: 'password123' });
    expect(res.status).toBe(201);
    tracker.userIds.push(res.body.user.id);
    const [cmd] = await sentOf(SubscribeCommand);
    expect(cmd.input.Endpoint).toBe(email);
  });

  it('emails the customer when a booking is confirmed and when it is cancelled', async () => {
    useFake();
    await createSlot({ facilityId });
    const customer = await createUser();
    const created = await request(app)
      .post('/api/bookings')
      .set(as(customer))
      .send({ vehicle_type: 'car', starts_at: istIso(5, '10:00'), hours: 2, vehicle_number: plate() });
    expect(created.status).toBe(201);
    const [confirmed] = await sentOf(PublishCommand);
    expect(confirmed.input.Subject).toBe(`ParkIt booking ${created.body.booking_code} confirmed`);
    expect(confirmed.input.MessageAttributes.email.StringValue).toBe(customer.user.email);

    const cancelled = await request(app).post(`/api/bookings/${created.body.booking_code}/cancel`).set(as(customer));
    expect(cancelled.status).toBe(200);
    const sent = await sentOf(PublishCommand, 2);
    expect(sent[1].input.Subject).toBe(`ParkIt booking ${created.body.booking_code} cancelled`);
  });

  it('still books when SNS fails, and logs the failure', async () => {
    useFake({ fail: true });
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await createSlot({ facilityId });
    const customer = await createUser();
    const res = await request(app)
      .post('/api/bookings')
      .set(as(customer))
      .send({ vehicle_type: 'car', starts_at: istIso(6, '10:00'), hours: 1, vehicle_number: plate() });
    expect(res.status).toBe(201);
    await vi.waitFor(() => expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('SNS publish failed')));
  });
});
