const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });

/** All money is stored as integer paise. Never use floats for money. */
export function formatPaise(paise: number): string {
  return inr.format(paise / 100);
}

export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100);
}
