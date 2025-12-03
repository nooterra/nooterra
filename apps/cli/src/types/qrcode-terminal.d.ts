declare module 'qrcode-terminal' {
  function generate(text: string, opts?: { small?: boolean }, cb?: (code: string) => void): void;
  function setErrorLevel(level: 'L' | 'M' | 'Q' | 'H'): void;
  export { generate, setErrorLevel };
}
