/**
 * `qr.js` ships no types. It is four hundred lines of matrix arithmetic from
 * 2012 and has not changed since, so this is the whole surface rather than a
 * subset — there is nothing else on the object worth reaching for.
 *
 * It arrives in this repo as a dependency of `@pollar/react`, which draws its
 * own login QR with it. We declare it in `package.json` anyway: a build that
 * breaks because somebody else's package dropped a transitive dep is a bad way
 * to find out we were relying on one.
 */
declare module 'qr.js' {
  interface QRCode {
    /** `modules[row][col]` — true is a dark module. Square, so `length` is the side. */
    readonly modules: boolean[][];
    readonly moduleCount: number;
  }

  interface Options {
    /** 1–40, or -1 to pick the smallest version the data fits. */
    typeNumber?: number;
    /** From `ErrorCorrectLevel`. NOT a percentage. */
    errorCorrectLevel?: number;
  }

  interface Encoder {
    (data: string, opt?: Options): QRCode;
    readonly ErrorCorrectLevel: { L: 1; M: 0; Q: 3; H: 2 };
  }

  const qr: Encoder;
  export default qr;
}
