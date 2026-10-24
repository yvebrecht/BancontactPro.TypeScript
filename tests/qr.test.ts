import { describe, expect, it } from 'vitest';
import { BancontactEnvironment as E, QrCodeImageFormat as F, QrCodeImageSize as S, qr } from '../src/index.js';

// Worked examples published verbatim on https://docs.bancontactpro.com/guides/general/payloadurlupdate
const PPID = '5c18cbd1296e9a26d3278518';

describe('qr', () => {
  it('builds the fixed-amount payload exactly as published', () => {
    const url = qr.buildFixedAmountPaymentUrl(E.Production, PPID, {
      amountCents: 1000,
      description: 'Receipt Payment',
      reference: 'sd89sd91?sd9',
    });
    expect(url).toBe(`https://pay.bancontact.net/t/1/${PPID}?D=Receipt%20Payment&A=1000&R=sd89sd91%3Fsd9`);
  });

  it('double-encodes the payload in the image URL', () => {
    const payload = qr.buildFixedAmountPaymentUrl(E.Production, PPID, {
      amountCents: 1000,
      description: 'Receipt Payment',
      reference: 'sd89sd91?sd9',
    });
    expect(qr.buildQrCodeImageUrl(E.Production, payload, F.Png, S.XL)).toBe(
      'https://qrcodegenerator.api.bancontact.net/qrcode?f=PNG&s=XL&c=' +
        'https%3A%2F%2Fpay.bancontact.net%2Ft%2F1%2F5c18cbd1296e9a26d3278518%3FD%3DReceipt%2520Payment' +
        '%26A%3D1000%26R%3Dsd89sd91%253Fsd9',
    );
  });

  it('builds the static QR location link', () => {
    const payload = qr.buildStaticQrLocationUrl(E.Production, '5bb37284e35e2b29e363df22', 'POS00001');
    expect(payload).toBe('https://pay.bancontact.net/l/1/5bb37284e35e2b29e363df22/POS00001');
    expect(qr.buildQrCodeImageUrl(E.Production, payload, F.Png, S.XL).endsWith('c=https%3A%2F%2Fpay.bancontact.net%2Fl%2F1%2F5bb37284e35e2b29e363df22%2FPOS00001')).toBe(true);
  });

  it('omits s for SVG and when no size is given', () => {
    expect(qr.buildQrCodeImageUrl(E.Production, 'https://x', F.Svg, S.L)).not.toContain('s=');
    expect(qr.buildQrCodeImageUrl(E.Production, 'https://x')).not.toContain('s=');
  });

  it('encodes characters encodeURIComponent would spare', () => {
    expect(qr.buildFixedAmountPaymentUrl(E.Production, PPID, { description: "a'b(c)*!" })).toContain('D=a%27b%28c%29%2A%21');
  });

  it('rejects a non-positive or fractional amount', () => {
    expect(() => qr.buildFixedAmountPaymentUrl(E.Production, PPID, { amountCents: 0 })).toThrow(RangeError);
    expect(() => qr.buildFixedAmountPaymentUrl(E.Production, PPID, { amountCents: 1.5 })).toThrow(RangeError);
  });

  it('uses the preprod hosts', () => {
    expect(qr.buildStaticQrLocationUrl(E.Preprod, 'p', 'POS1')).toMatch(/^https:\/\/pay\.acc\.bancontact\.net\//);
    expect(qr.buildQrCodeImageUrl(E.Preprod, 'https://x')).toMatch(/^https:\/\/qrcodegenerator\.api\.preprod\.bancontact\.net\//);
  });
});
