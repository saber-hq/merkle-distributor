import invariant from "tiny-invariant";

export const toBytes32Array = (b: Buffer): number[] => {
  invariant(b.length <= 32, `invalid length ${b.length}`);
  const buf = new Uint8Array(Buffer.alloc(32));
  b.copy(buf, 32 - b.length);

  return Array.from(buf);
};
