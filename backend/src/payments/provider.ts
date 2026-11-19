import { createHmac } from 'node:crypto';
import Razorpay from 'razorpay';
import { AppError } from '../lib/errors.js';
import { newId, safeEqual } from '../lib/ids.js';
import { logger } from '../lib/logger.js';

export interface PaymentProvider {
  readonly mode: 'simulated' | 'razorpay';
  /** Public key id for the browser checkout widget (Razorpay only). */
  readonly publicKeyId: string | null;
  /**
   * Whether an order approved by a standing mandate can be captured without the
   * user present. Real Razorpay needs a tokenised recurring mandate for that, so
   * in razorpay mode such orders wait for the user at the payment link instead.
   */
  readonly canAutoCapture: boolean;
  createPayment(order: { id: string; total_paise: number; currency: string }): Promise<{ ref: string }>;
  verifyCheckoutSignature(p: { orderRef: string; paymentId: string; signature: string }): boolean;
  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean;
}

export class SimulatedPayments implements PaymentProvider {
  readonly mode = 'simulated' as const;
  readonly publicKeyId = null;
  readonly canAutoCapture = true;
  async createPayment() {
    return { ref: newId('sim_order') };
  }
  verifyCheckoutSignature() {
    return false;
  }
  verifyWebhookSignature() {
    return false;
  }
}

export class RazorpayPayments implements PaymentProvider {
  readonly mode = 'razorpay' as const;
  readonly canAutoCapture = false;
  private readonly client: Razorpay;

  constructor(
    readonly publicKeyId: string,
    private readonly keySecret: string,
    private readonly webhookSecret: string | undefined,
  ) {
    this.client = new Razorpay({ key_id: publicKeyId, key_secret: keySecret });
  }

  async createPayment(order: { id: string; total_paise: number; currency: string }) {
    try {
      const rp = await this.client.orders.create({
        amount: order.total_paise,
        currency: order.currency,
        receipt: order.id,
        notes: { agentbridge_order_id: order.id },
      });
      return { ref: rp.id };
    } catch (err) {
      logger.error({ err, orderId: order.id }, 'razorpay: order creation failed');
      throw new AppError('payment_error', 'Could not create Razorpay order');
    }
  }

  /** https://razorpay.com/docs/payments/server-integration/nodejs/payment-gateway/build-integration/#verify-payment-signature */
  verifyCheckoutSignature({ orderRef, paymentId, signature }: { orderRef: string; paymentId: string; signature: string }) {
    const expected = createHmac('sha256', this.keySecret).update(`${orderRef}|${paymentId}`).digest('hex');
    return safeEqual(expected, signature);
  }

  verifyWebhookSignature(rawBody: Buffer, signature: string) {
    if (!this.webhookSecret) return false;
    const expected = createHmac('sha256', this.webhookSecret).update(rawBody).digest('hex');
    return safeEqual(expected, signature);
  }
}
