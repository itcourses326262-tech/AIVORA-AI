import type { Transporter } from 'nodemailer';
import { describe, expect, it, vi } from 'vitest';
import { registerUser } from '@/server/auth/users';
import { parseEmail } from '@/server/auth/validation';
import {
  createSmtpTransport,
  flushEmails,
  isSingleAddress,
  setEmailTransportOverride,
} from '@/server/email';
import { freshDb } from '../../helpers/db';
import { GOOD_PASSWORD, passwordFixture, stubEnv, trustTestState } from '../auth/trust-support';

freshDb();
passwordFixture();
trustTestState();

/** Every printable ASCII character, as the local part's first, middle and last character. */
const PRINTABLE = Array.from({ length: 0x7e - 0x21 + 1 }, (_, i) => String.fromCharCode(0x21 + i));

function accepted(email: string): boolean {
  try {
    parseEmail(email);
    return true;
  } catch {
    return false;
  }
}

describe('what sign-up accepts can be mailed', () => {
  it('every character the sign-up validation allows in a local part passes the transport guard', () => {
    const rejected: string[] = [];
    let accepts = 0;
    for (const char of PRINTABLE) {
      for (const email of [
        `a${char}b@example.com`,
        `${char}ab@example.com`,
        `ab${char}@example.com`,
      ]) {
        if (!accepted(email)) continue;
        accepts += 1;
        if (!isSingleAddress(email)) rejected.push(email);
      }
    }
    expect(rejected).toEqual([]);
    // The sweep means something only if sign-up accepts a good number of these.
    expect(accepts).toBeGreaterThan(10);
    expect(accepted("o'brien@example.com")).toBe(true);
  });

  it.each(["o'brien@example.com", "o'neil+promo@example.com", "d'arcy.o'hara@example.co.uk"])(
    'accepts %s',
    (address) => expect(isSingleAddress(address)).toBe(true),
  );

  it.each([
    ["a@exam'ple.com", 'an apostrophe in the host name'],
    ["a'@@example.com", 'a second @'],
    ["o'brien@example.com, evil@example.com", 'a list'],
    ["o'brien@example.com\r\nBcc: evil@example.com", 'header injection'],
    ['"o\'brien"@example.com', 'a quoted local part'],
  ])('still refuses %s (%s)', (address) => expect(isSingleAddress(address)).toBe(false));

  it('delivers the confirmation email of an apostrophe address through the SMTP transport', async () => {
    stubEnv({
      SMTP_URL: 'smtp://mail.example.com:587',
      EMAIL_FROM: 'AIVORE <no-reply@example.com>',
    });
    const sendMail = vi.fn(async () => ({ accepted: [], rejected: [] }));
    setEmailTransportOverride(
      createSmtpTransport(
        { host: 'mail.example.com', port: 587, secure: false, requireTLS: false },
        {
          createTransporter: async () => ({ sendMail }) as unknown as Pick<Transporter, 'sendMail'>,
        },
      ),
    );

    await registerUser({
      email: "O'Brien@Example.com",
      password: GOOD_PASSWORD,
      name: 'Brien',
      locale: 'en',
    });
    await flushEmails();

    expect(sendMail).toHaveBeenCalledTimes(1);
    const sent = (sendMail.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(sent).toMatchObject({ to: "o'brien@example.com" });
    expect(String(sent.subject)).toMatch(/Confirm your email/);
  });
});
