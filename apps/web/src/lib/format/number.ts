// Figures in CAD with en-CA formatting (SPEC 17). Render them with the `figures` class.

const cad = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
  maximumFractionDigits: 0,
});
const integer = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 0 });

/** 2450 → "$2,450" */
export function formatCad(amount: number): string {
  return cad.format(amount);
}

/** 1520 → "1,520" */
export function formatCount(count: number): string {
  return integer.format(count);
}
