import fsSync from "node:fs";

export function writeStdout(text) {
  fsSync.writeFileSync(1, text);
}

export function writeStderr(text) {
  fsSync.writeFileSync(2, text);
}

