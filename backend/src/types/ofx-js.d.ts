declare module 'ofx-js' {
  export function parse(content: string): Record<string, unknown>;
  export function serialize(header: Record<string, unknown>, body: Record<string, unknown>): string;
}
