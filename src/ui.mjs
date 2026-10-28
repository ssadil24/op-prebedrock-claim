const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);

export const bold = paint("1");
export const green = paint("32");
export const yellow = paint("33");
export const red = paint("31");
export const dim = paint("2");

export const heading = (s) => console.log(`\n${bold(s)}\n${"-".repeat(s.length)}`);
export const ok = (s) => console.log(`${green("✔")} ${s}`);
export const warn = (s) => console.log(`${yellow("!")} ${s}`);
export const bad = (s) => console.log(`${red("✘")} ${s}`);
export const line = (s = "") => console.log(s);

export const utc = (seconds) =>
  new Date(Number(seconds) * 1000).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
