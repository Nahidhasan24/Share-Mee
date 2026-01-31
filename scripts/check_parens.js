const fs = require("fs");
const s = fs.readFileSync("src/app/room/[roomId]/page.tsx", "utf8");
const lines = s.split("\n");
let cum = 0;
for (let i = 0; i < lines.length; i++) {
  const ln = lines[i];
  for (const ch of ln) {
    if (ch === "(") cum++;
    if (ch === ")") cum--;
  }
  if (cum !== 0) console.log(i + 1, cum, ln);
}
console.log("final cum", cum);
