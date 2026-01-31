const fs = require("fs");
const s = fs.readFileSync("src/app/room/[roomId]/page.tsx", "utf8");
const pairs = { "(": ")", "{": "}", "[": "]" };
const stack = [];
for (let i = 0; i < s.length; i++) {
  const ch = s[i];
  if (ch in pairs) stack.push({ ch, i });
  else if (ch === ")" || ch === "}" || ch === "]") {
    if (stack.length && pairs[stack[stack.length - 1].ch] === ch) stack.pop();
    else {
      console.log("mismatch close", ch, "at", i);
      break;
    }
  }
}
console.log("unclosed count", stack.length);
stack.forEach((it, idx) => {
  const context = s.slice(
    Math.max(0, it.i - 40),
    Math.min(s.length, it.i + 40),
  );
  console.log(idx, it.ch, it.i, "\n", context, "\n----");
});
