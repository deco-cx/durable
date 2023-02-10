export const valueOrNull = (v: string | undefined): string => {
  return `${v ? "'" + v + "'" : "NULL"}`;
};

export const isoDate = (dt: Date | string): string => {
  return new Date(dt).toISOString();
};
