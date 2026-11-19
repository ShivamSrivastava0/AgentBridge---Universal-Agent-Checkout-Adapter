import { env } from '../config/env.js';
import type { AppContext } from '../context.js';
import type { Agent } from '../domain/types.js';
import { logger } from '../lib/logger.js';
import { upsertAgent } from '../services/agents.js';
import { createMandate } from '../services/mandates.js';
import { approveByUser, placeOrder, settleOrder } from '../services/orders.js';

type SeedProduct = [sku: string, name: string, brand: string, category: string, unit: string, rupees: number, stock: number, tags: string[]];

/** Demo catalog: a neighbourhood household-essentials store ("Northstar Essentials"). */
export const SEED_PRODUCTS: SeedProduct[] = [
  // staples
  ['STP-ATTA-5', 'Whole Wheat Atta', 'Aashirvaad', 'staples', '5 kg', 285, 120, ['veg', 'contains:gluten']],
  ['STP-RICE-5', 'Basmati Rice', 'India Gate', 'staples', '5 kg', 649, 80, ['veg', 'vegan']],
  ['STP-DAL-TOOR', 'Toor Dal', 'Tata Sampann', 'staples', '1 kg', 179, 150, ['veg', 'vegan']],
  ['STP-DAL-MOONG', 'Moong Dal', 'Tata Sampann', 'staples', '1 kg', 165, 110, ['veg', 'vegan']],
  ['STP-OIL-SUN', 'Sunflower Oil', 'Fortune', 'staples', '1 L', 155, 140, ['veg', 'vegan']],
  ['STP-SUGAR', 'Sugar', 'Madhur', 'staples', '1 kg', 52, 200, ['veg', 'vegan', 'high_sugar']],
  ['STP-SALT', 'Iodised Salt', 'Tata', 'staples', '1 kg', 28, 300, ['veg', 'vegan']],
  ['STP-POHA', 'Thick Poha', 'Rajdhani', 'staples', '500 g', 48, 90, ['veg', 'vegan']],
  ['STP-OATS', 'Rolled Oats', 'Saffola', 'staples', '1 kg', 199, 70, ['veg', 'vegan', 'contains:gluten']],
  // dairy
  ['DRY-MILK-1', 'Toned Milk', 'Amul', 'dairy', '1 L', 68, 200, ['veg', 'contains:dairy']],
  ['DRY-CURD', 'Fresh Curd', 'Mother Dairy', 'dairy', '400 g', 45, 120, ['veg', 'contains:dairy']],
  ['DRY-PANEER', 'Malai Paneer', 'Amul', 'dairy', '200 g', 95, 60, ['veg', 'contains:dairy']],
  ['DRY-BUTTER', 'Salted Butter', 'Amul', 'dairy', '100 g', 58, 90, ['veg', 'contains:dairy']],
  ['DRY-EGGS', 'Farm Eggs', 'Eggoz', 'dairy', '12 pcs', 110, 75, ['contains:egg']],
  ['DRY-SOYMILK', 'Unsweetened Soy Milk', 'Sofit', 'dairy', '1 L', 135, 40, ['veg', 'vegan', 'contains:soy', 'sugar_free']],
  // produce
  ['PRD-ONION', 'Onions', 'Fresh', 'produce', '1 kg', 40, 250, ['veg', 'vegan']],
  ['PRD-TOMATO', 'Tomatoes', 'Fresh', 'produce', '1 kg', 36, 220, ['veg', 'vegan']],
  ['PRD-POTATO', 'Potatoes', 'Fresh', 'produce', '1 kg', 32, 260, ['veg', 'vegan']],
  ['PRD-BANANA', 'Bananas', 'Fresh', 'produce', '12 pcs', 60, 90, ['veg', 'vegan']],
  ['PRD-APPLE', 'Shimla Apples', 'Fresh', 'produce', '1 kg', 180, 60, ['veg', 'vegan']],
  ['PRD-SPINACH', 'Spinach', 'Fresh', 'produce', '250 g', 25, 50, ['veg', 'vegan']],
  // snacks
  ['SNK-PEANUT', 'Roasted Peanuts', 'Haldiram’s', 'snacks', '200 g', 60, 100, ['veg', 'vegan', 'contains:peanuts']],
  ['SNK-PBUTTER', 'Crunchy Peanut Butter', 'Pintola', 'snacks', '350 g', 229, 45, ['veg', 'vegan', 'contains:peanuts']],
  ['SNK-ALMOND', 'California Almonds', 'Happilo', 'snacks', '200 g', 245, 55, ['veg', 'vegan', 'contains:tree_nuts']],
  ['SNK-MARIE', 'Marie Biscuits', 'Britannia', 'snacks', '250 g', 35, 160, ['veg', 'contains:gluten', 'contains:dairy']],
  ['SNK-CHIPS', 'Classic Salted Chips', 'Lay’s', 'snacks', '90 g', 20, 180, ['veg', 'vegan']],
  ['SNK-DARKCHOC', 'Dark Chocolate 70%', 'Amul', 'snacks', '150 g', 125, 65, ['veg', 'contains:dairy']],
  // beverages
  ['BEV-TEA', 'Premium Tea', 'Tata Tea Gold', 'beverages', '500 g', 285, 85, ['veg', 'vegan', 'caffeine']],
  ['BEV-COFFEE', 'Instant Coffee', 'Nescafé', 'beverages', '100 g', 345, 60, ['veg', 'vegan', 'caffeine']],
  ['BEV-JUICE', 'Mixed Fruit Juice', 'Real', 'beverages', '1 L', 120, 70, ['veg', 'vegan', 'high_sugar']],
  ['BEV-COLA', 'Cola', 'Coca-Cola', 'beverages', '2 L', 95, 90, ['veg', 'vegan', 'high_sugar', 'caffeine']],
  // personal care
  ['PC-TOOTHPASTE', 'Toothpaste', 'Colgate', 'personal_care', '200 g', 110, 100, []],
  ['PC-SOAP', 'Bathing Soap (4 pack)', 'Dove', 'personal_care', '4 × 100 g', 220, 80, []],
  ['PC-SHAMPOO', 'Anti-dandruff Shampoo', 'Head & Shoulders', 'personal_care', '340 ml', 365, 50, []],
  ['PC-HANDWASH', 'Hand Wash Refill', 'Dettol', 'personal_care', '750 ml', 99, 90, []],
  // household
  ['HH-DETERGENT', 'Detergent Powder', 'Surf Excel', 'household', '1 kg', 145, 110, []],
  ['HH-DISHWASH', 'Dishwash Liquid', 'Vim', 'household', '750 ml', 135, 95, []],
  ['HH-FLOOR', 'Floor Cleaner', 'Lizol', 'household', '975 ml', 199, 70, []],
  ['HH-TISSUE', 'Kitchen Towels (2 rolls)', 'Origami', 'household', '2 rolls', 120, 85, []],
  ['HH-GARBAGE', 'Garbage Bags (30 pcs)', 'Ezee', 'household', '30 pcs', 90, 120, []],
  // health (OTC)
  ['HLT-PARA', 'Paracetamol 500 mg', 'Crocin', 'health', '15 tablets', 30, 200, ['otc_medicine']],
  ['HLT-ORS', 'ORS Sachets (10)', 'Electral', 'health', '10 × 21.8 g', 220, 80, ['otc_medicine']],
  ['HLT-VITC', 'Vitamin C 500 mg', 'Limcee', 'health', '15 tablets', 25, 150, ['supplement']],
  ['HLT-BANDAGE', 'Adhesive Bandages', 'Band-Aid', 'health', '20 strips', 60, 100, []],
  // baby
  ['BBY-DIAPER', 'Baby Diapers (M, 56)', 'Pampers', 'baby', '56 pcs', 899, 40, []],
  ['BBY-WIPES', 'Baby Wipes (72)', 'Himalaya', 'baby', '72 pcs', 199, 60, []],
  // footwear & apparel: taste-driven; agents should only shortlist
  ['FW-RUN-BLK', 'Running Shoes (Black)', 'Campus', 'footwear', 'pair', 2299, 25, ['subjective']],
  ['FW-RUN-WHT', 'Running Shoes (White)', 'Asics', 'footwear', 'pair', 4799, 18, ['subjective']],
  ['FW-SLIDES', 'Everyday Slides', 'Crocs', 'footwear', 'pair', 1995, 30, ['subjective']],
  ['APP-TSHIRT', 'Cotton T-shirt', 'Jockey', 'apparel', '1 pc', 599, 60, ['subjective']],
  ['APP-SOCKS', 'Ankle Socks (3 pairs)', 'Puma', 'apparel', '3 pairs', 449, 70, ['subjective']],
  // electronics: high-value, triggers merchant review above the risk threshold
  ['ELC-EARBUDS', 'Wireless Earbuds', 'boAt', 'electronics', '1 pc', 1999, 30, ['subjective']],
  ['ELC-AIRFRYER', 'Air Fryer 4.2 L', 'Philips', 'electronics', '1 pc', 7499, 12, []],
];

export const DEMO_SUBJECT = 'household_demo';

export const DEMO_AGENTS: { id: string; name: string; platform: string; protocol: Agent['protocol']; key: () => string }[] = [
  { id: 'agt_claude', name: 'Claude', platform: 'Anthropic', protocol: 'mcp', key: () => env.DEMO_AGENT_KEY_CLAUDE },
  { id: 'agt_chatgpt', name: 'ChatGPT', platform: 'OpenAI', protocol: 'acp', key: () => env.DEMO_AGENT_KEY_CHATGPT },
  { id: 'agt_gemini', name: 'Gemini', platform: 'Google', protocol: 'ap2', key: () => env.DEMO_AGENT_KEY_GEMINI },
];

/** The default household mandate: repeat essentials auto, health/baby confirm, taste-driven shortlist. */
export const DEMO_CATEGORY_RULES = {
  staples: 'auto',
  dairy: 'auto',
  produce: 'auto',
  household: 'auto',
  personal_care: 'auto',
  beverages: 'auto',
  snacks: 'auto',
  health: 'confirm',
  baby: 'confirm',
  footwear: 'shortlist',
  apparel: 'shortlist',
  electronics: 'confirm',
} as const;

export async function seedCatalog(ctx: AppContext) {
  await ctx.db.query(
    `INSERT INTO merchants (id, name, currency) VALUES ($1, 'Northstar Essentials', 'INR') ON CONFLICT (id) DO NOTHING`,
    [ctx.merchantId],
  );
  for (const [sku, name, brand, category, unit, rupees, stock, tags] of SEED_PRODUCTS) {
    await ctx.db.query(
      `INSERT INTO products (id, merchant_id, sku, name, brand, description, category, unit, price_paise, stock, tags)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (id) DO NOTHING`,
      [
        `prd_${sku.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
        ctx.merchantId,
        sku,
        name,
        brand,
        `${brand} ${name}, ${unit}.`,
        category,
        unit,
        Math.round(rupees * 100),
        stock,
        tags,
      ],
    );
  }
  for (const a of DEMO_AGENTS) {
    await upsertAgent(ctx.db, { id: a.id, name: a.name, platform: a.platform, protocol: a.protocol, apiKey: a.key() });
  }
}

/**
 * Seeds the demo: catalog, agents, a household mandate, and a purchase history
 * (so "repeat items" exist and auto-buy has something to recognise).
 * Runs only on an empty database.
 */
export async function seedDemo(ctx: AppContext) {
  const [{ n }] = (await ctx.db.query<{ n: number }>('SELECT count(*)::int AS n FROM products')) as [{ n: number }];
  await seedCatalog(ctx);
  if (n > 0) return;

  const claude: Agent = { id: 'agt_claude', name: 'Claude', platform: 'Anthropic', protocol: 'mcp', status: 'active' };

  // Past orders the household approved and paid: these become its "usuals".
  const history: { product_id: string; quantity: number }[][] = [
    [
      { product_id: 'prd_stp_atta_5', quantity: 1 },
      { product_id: 'prd_dry_milk_1', quantity: 4 },
      { product_id: 'prd_prd_onion', quantity: 2 },
      { product_id: 'prd_prd_tomato', quantity: 1 },
      { product_id: 'prd_bev_tea', quantity: 1 },
    ],
    [
      { product_id: 'prd_stp_dal_toor', quantity: 1 },
      { product_id: 'prd_stp_rice_5', quantity: 1 },
      { product_id: 'prd_dry_curd', quantity: 2 },
      { product_id: 'prd_hh_detergent', quantity: 1 },
      { product_id: 'prd_pc_toothpaste', quantity: 1 },
    ],
    [
      { product_id: 'prd_dry_milk_1', quantity: 4 },
      { product_id: 'prd_prd_banana', quantity: 1 },
      { product_id: 'prd_hh_dishwash', quantity: 1 },
      { product_id: 'prd_stp_oil_sun', quantity: 1 },
    ],
  ];
  let daysAgo = 21;
  for (const items of history) {
    const { order } = await placeOrder(ctx, { agent: claude, protocol: 'mcp', items, buyerRef: DEMO_SUBJECT });
    await approveByUser(ctx, order.id);
    await settleOrder(ctx, order.id, { provider: 'simulated', paymentId: `sim_pay_seed_${daysAgo}` }, 'user');
    // Backdate so the history looks real and does not trip the velocity rule.
    await ctx.db.query(`UPDATE orders SET created_at = now() - make_interval(days => $2), paid_at = now() - make_interval(days => $2) WHERE id = $1`, [
      order.id,
      daysAgo,
    ]);
    await ctx.db.query(`UPDATE order_events SET created_at = now() - make_interval(days => $2) WHERE order_id = $1`, [order.id, daysAgo]);
    daysAgo -= 7;
  }

  await createMandate(ctx, {
    label: 'Weekly household restock',
    subject: DEMO_SUBJECT,
    agent_id: null,
    max_order_paise: 300_000, // ₹3,000 per order
    budget_paise: 1_200_000, // ₹12,000 per mandate
    category_rules: DEMO_CATEGORY_RULES,
    default_level: 'confirm',
    blocked_tags: ['contains:peanuts'],
    escalate_new_items: true,
    expires_in_days: 30,
  });
  logger.info('seed: demo catalog, agents, history and mandate created');
}
