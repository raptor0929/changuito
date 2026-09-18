import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}


export const networks = {
  testnet: {
    networkPassphrase: "Test SDF Network ; September 2015",
    contractId: "CBCUESHDKRXAH4YAHOKJFRFEOIYBTU2LYJ4LCOFIGMYGNHBCPACXQ557",
  }
} as const

export const Errors = {
  1: {message:"AlreadyInitialized"},
  2: {message:"NotInitialized"},
  3: {message:"OrderExists"},
  4: {message:"OrderNotFound"},
  /**
   * The order is no longer Open: already settled, or already refunded.
   */
  5: {message:"OrderClosed"},
  /**
   * Neither the resolver nor, after the deadline, the buyer.
   */
  6: {message:"NotAuthorized"},
  7: {message:"InvalidAmount"},
  8: {message:"InvalidTimeout"},
  /**
   * `settle` was given a basket that is not the one the buyer approved.
   */
  9: {message:"BasketMismatch"}
}


export interface Order {
  /**
 * In the token's own units. USDC on Stellar has 7 decimals.
 */
amount: i128;
  /**
 * Hash of the exact basket the buyer approved.
 */
basket_hash: Buffer;
  buyer: string;
  /**
 * Unix seconds after which the buyer may refund themselves.
 */
deadline: u64;
  opened_at: u64;
  /**
 * Hash of the store's order, set by `settle`. Zero until then.
 */
receipt_hash: Buffer;
  status: Status;
}


export interface Config {
  /**
 * Settles and refunds on the happy paths. The app's backend.
 */
resolver: string;
  /**
 * The SEP-41 token this escrow holds. Fixed at deploy.
 */
token: string;
  /**
 * Where a settled basket's USDC lands.
 */
treasury: string;
}

export enum Status {
  Open = 0,
  Settled = 1,
  Refunded = 2,
}




export interface Client {
  /**
   * Construct and simulate a open transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Lock `amount` of the escrow's token against `order_id`.
   * 
   * The buyer authorizes this call, which is also what authorizes the
   * transfer out of their balance: `require_auth` here and `transfer` below
   * are covered by the same signature.
   */
  open: ({buyer, order_id, amount, basket_hash, timeout_secs}: {buyer: string, order_id: Buffer, amount: i128, basket_hash: Buffer, timeout_secs: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Order>>

  /**
   * Construct and simulate a config transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  config: (options?: MethodOptions) => Promise<AssembledTransaction<Config>>

  /**
   * Construct and simulate a refund transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Return the money to the buyer.
   * 
   * The resolver may do this at any time — that is the normal path when a
   * basket fails. The buyer may do it themselves once `deadline` has passed,
   * which is what makes this an escrow rather than a deposit.
   * 
   * `caller` is explicit because the two cases authorize different addresses,
   * and `require_auth` has to be called on the one that actually signed.
   */
  refund: ({caller, order_id}: {caller: string, order_id: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Order>>

  /**
   * Construct and simulate a settle transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Release the money to the treasury, recording which basket and which
   * store order it paid for.
   * 
   * `basket_hash` is passed back rather than read from storage so that a
   * resolver settling the wrong order fails loudly instead of quietly
   * paying for a basket the buyer never saw.
   */
  settle: ({order_id, basket_hash, receipt_hash}: {order_id: Buffer, basket_hash: Buffer, receipt_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Order>>

  /**
   * Construct and simulate a get_order transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_order: ({order_id}: {order_id: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Order>>

  /**
   * Construct and simulate a find_order transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * `get_order` panics on an unknown id; this is for callers that are asking
   * whether an order exists at all, such as a UI polling after a submit.
   * Not named `try_get_order`: the generated client reserves that prefix for
   * its own non-panicking wrapper of `get_order`.
   */
  find_order: ({order_id}: {order_id: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Option<Order>>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {resolver, treasury, token}: {resolver: string, treasury: string, token: string},
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy({resolver, treasury, token}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAAAAAOVMb2NrIGBhbW91bnRgIG9mIHRoZSBlc2Nyb3cncyB0b2tlbiBhZ2FpbnN0IGBvcmRlcl9pZGAuCgpUaGUgYnV5ZXIgYXV0aG9yaXplcyB0aGlzIGNhbGwsIHdoaWNoIGlzIGFsc28gd2hhdCBhdXRob3JpemVzIHRoZQp0cmFuc2ZlciBvdXQgb2YgdGhlaXIgYmFsYW5jZTogYHJlcXVpcmVfYXV0aGAgaGVyZSBhbmQgYHRyYW5zZmVyYCBiZWxvdwphcmUgY292ZXJlZCBieSB0aGUgc2FtZSBzaWduYXR1cmUuAAAAAAAABG9wZW4AAAAFAAAAAAAAAAVidXllcgAAAAAAABMAAAAAAAAACG9yZGVyX2lkAAAD7gAAACAAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAALYmFza2V0X2hhc2gAAAAD7gAAACAAAAAAAAAADHRpbWVvdXRfc2VjcwAAAAYAAAABAAAH0AAAAAVPcmRlcgAAAA==",
        "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAACQAAAAAAAAASQWxyZWFkeUluaXRpYWxpemVkAAAAAAABAAAAAAAAAA5Ob3RJbml0aWFsaXplZAAAAAAAAgAAAAAAAAALT3JkZXJFeGlzdHMAAAAAAwAAAAAAAAANT3JkZXJOb3RGb3VuZAAAAAAAAAQAAABCVGhlIG9yZGVyIGlzIG5vIGxvbmdlciBPcGVuOiBhbHJlYWR5IHNldHRsZWQsIG9yIGFscmVhZHkgcmVmdW5kZWQuAAAAAAALT3JkZXJDbG9zZWQAAAAABQAAADhOZWl0aGVyIHRoZSByZXNvbHZlciBub3IsIGFmdGVyIHRoZSBkZWFkbGluZSwgdGhlIGJ1eWVyLgAAAA1Ob3RBdXRob3JpemVkAAAAAAAABgAAAAAAAAANSW52YWxpZEFtb3VudAAAAAAAAAcAAAAAAAAADkludmFsaWRUaW1lb3V0AAAAAAAIAAAAQ2BzZXR0bGVgIHdhcyBnaXZlbiBhIGJhc2tldCB0aGF0IGlzIG5vdCB0aGUgb25lIHRoZSBidXllciBhcHByb3ZlZC4AAAAADkJhc2tldE1pc21hdGNoAAAAAAAJ",
        "AAAAAQAAAAAAAAAAAAAABU9yZGVyAAAAAAAABwAAADlJbiB0aGUgdG9rZW4ncyBvd24gdW5pdHMuIFVTREMgb24gU3RlbGxhciBoYXMgNyBkZWNpbWFscy4AAAAAAAAGYW1vdW50AAAAAAALAAAALEhhc2ggb2YgdGhlIGV4YWN0IGJhc2tldCB0aGUgYnV5ZXIgYXBwcm92ZWQuAAAAC2Jhc2tldF9oYXNoAAAAA+4AAAAgAAAAAAAAAAVidXllcgAAAAAAABMAAAA5VW5peCBzZWNvbmRzIGFmdGVyIHdoaWNoIHRoZSBidXllciBtYXkgcmVmdW5kIHRoZW1zZWx2ZXMuAAAAAAAACGRlYWRsaW5lAAAABgAAAAAAAAAJb3BlbmVkX2F0AAAAAAAABgAAADxIYXNoIG9mIHRoZSBzdG9yZSdzIG9yZGVyLCBzZXQgYnkgYHNldHRsZWAuIFplcm8gdW50aWwgdGhlbi4AAAAMcmVjZWlwdF9oYXNoAAAD7gAAACAAAAAAAAAABnN0YXR1cwAAAAAH0AAAAAZTdGF0dXMAAA==",
        "AAAAAAAAAAAAAAAGY29uZmlnAAAAAAAAAAAAAQAAB9AAAAAGQ29uZmlnAAA=",
        "AAAAAAAAAXpSZXR1cm4gdGhlIG1vbmV5IHRvIHRoZSBidXllci4KClRoZSByZXNvbHZlciBtYXkgZG8gdGhpcyBhdCBhbnkgdGltZSDigJQgdGhhdCBpcyB0aGUgbm9ybWFsIHBhdGggd2hlbiBhCmJhc2tldCBmYWlscy4gVGhlIGJ1eWVyIG1heSBkbyBpdCB0aGVtc2VsdmVzIG9uY2UgYGRlYWRsaW5lYCBoYXMgcGFzc2VkLAp3aGljaCBpcyB3aGF0IG1ha2VzIHRoaXMgYW4gZXNjcm93IHJhdGhlciB0aGFuIGEgZGVwb3NpdC4KCmBjYWxsZXJgIGlzIGV4cGxpY2l0IGJlY2F1c2UgdGhlIHR3byBjYXNlcyBhdXRob3JpemUgZGlmZmVyZW50IGFkZHJlc3NlcywKYW5kIGByZXF1aXJlX2F1dGhgIGhhcyB0byBiZSBjYWxsZWQgb24gdGhlIG9uZSB0aGF0IGFjdHVhbGx5IHNpZ25lZC4AAAAAAAZyZWZ1bmQAAAAAAAIAAAAAAAAABmNhbGxlcgAAAAAAEwAAAAAAAAAIb3JkZXJfaWQAAAPuAAAAIAAAAAEAAAfQAAAABU9yZGVyAAAA",
        "AAAAAAAAAQ1SZWxlYXNlIHRoZSBtb25leSB0byB0aGUgdHJlYXN1cnksIHJlY29yZGluZyB3aGljaCBiYXNrZXQgYW5kIHdoaWNoCnN0b3JlIG9yZGVyIGl0IHBhaWQgZm9yLgoKYGJhc2tldF9oYXNoYCBpcyBwYXNzZWQgYmFjayByYXRoZXIgdGhhbiByZWFkIGZyb20gc3RvcmFnZSBzbyB0aGF0IGEKcmVzb2x2ZXIgc2V0dGxpbmcgdGhlIHdyb25nIG9yZGVyIGZhaWxzIGxvdWRseSBpbnN0ZWFkIG9mIHF1aWV0bHkKcGF5aW5nIGZvciBhIGJhc2tldCB0aGUgYnV5ZXIgbmV2ZXIgc2F3LgAAAAAAAAZzZXR0bGUAAAAAAAMAAAAAAAAACG9yZGVyX2lkAAAD7gAAACAAAAAAAAAAC2Jhc2tldF9oYXNoAAAAA+4AAAAgAAAAAAAAAAxyZWNlaXB0X2hhc2gAAAPuAAAAIAAAAAEAAAfQAAAABU9yZGVyAAAA",
        "AAAAAQAAAAAAAAAAAAAABkNvbmZpZwAAAAAAAwAAADpTZXR0bGVzIGFuZCByZWZ1bmRzIG9uIHRoZSBoYXBweSBwYXRocy4gVGhlIGFwcCdzIGJhY2tlbmQuAAAAAAAIcmVzb2x2ZXIAAAATAAAANFRoZSBTRVAtNDEgdG9rZW4gdGhpcyBlc2Nyb3cgaG9sZHMuIEZpeGVkIGF0IGRlcGxveS4AAAAFdG9rZW4AAAAAAAATAAAAJFdoZXJlIGEgc2V0dGxlZCBiYXNrZXQncyBVU0RDIGxhbmRzLgAAAAh0cmVhc3VyeQAAABM=",
        "AAAAAwAAAAAAAAAAAAAABlN0YXR1cwAAAAAAAwAAAAAAAAAET3BlbgAAAAAAAAAAAAAAB1NldHRsZWQAAAAAAQAAAAAAAAAIUmVmdW5kZWQAAAAC",
        "AAAABQAAAAAAAAAAAAAABk9wZW5lZAAAAAAAAQAAAAZvcGVuZWQAAAAAAAUAAAAAAAAACG9yZGVyX2lkAAAD7gAAACAAAAABAAAAAAAAAAVidXllcgAAAAAAABMAAAABAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAAAAAAAtiYXNrZXRfaGFzaAAAAAPuAAAAIAAAAAAAAAAAAAAACGRlYWRsaW5lAAAABgAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAAB1NldHRsZWQAAAAAAQAAAAdzZXR0bGVkAAAAAAQAAAAAAAAACG9yZGVyX2lkAAAD7gAAACAAAAABAAAAAAAAAAVidXllcgAAAAAAABMAAAABAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAAAAAAAxyZWNlaXB0X2hhc2gAAAPuAAAAIAAAAAAAAAAC",
        "AAAAAAAAAAAAAAAJZ2V0X29yZGVyAAAAAAAAAQAAAAAAAAAIb3JkZXJfaWQAAAPuAAAAIAAAAAEAAAfQAAAABU9yZGVyAAAA",
        "AAAABQAAAAAAAAAAAAAACFJlZnVuZGVkAAAAAQAAAAhyZWZ1bmRlZAAAAAQAAAAAAAAACG9yZGVyX2lkAAAD7gAAACAAAAABAAAAAAAAAAVidXllcgAAAAAAABMAAAABAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAtVRydWUgd2hlbiB0aGUgYnV5ZXIgdG9vayB0aGUgbW9uZXkgYmFjayB0aGVtc2VsdmVzIGFmdGVyIHRoZSBkZWFkbGluZSwKcmF0aGVyIHRoYW4gdGhlIHJlc29sdmVyIHJlbGVhc2luZyBpdC4gV29ydGggZGlzdGluZ3Vpc2hpbmcgaW4gYW4gYXVkaXQ6Cml0IG1lYW5zIHRoZSBiYWNrZW5kIG5ldmVyIGNhbWUgYmFjay4AAAAAAAAMc2VsZl9zZXJ2aWNlAAAAAQAAAAAAAAAC",
        "AAAAAAAAAQRgZ2V0X29yZGVyYCBwYW5pY3Mgb24gYW4gdW5rbm93biBpZDsgdGhpcyBpcyBmb3IgY2FsbGVycyB0aGF0IGFyZSBhc2tpbmcKd2hldGhlciBhbiBvcmRlciBleGlzdHMgYXQgYWxsLCBzdWNoIGFzIGEgVUkgcG9sbGluZyBhZnRlciBhIHN1Ym1pdC4KTm90IG5hbWVkIGB0cnlfZ2V0X29yZGVyYDogdGhlIGdlbmVyYXRlZCBjbGllbnQgcmVzZXJ2ZXMgdGhhdCBwcmVmaXggZm9yCml0cyBvd24gbm9uLXBhbmlja2luZyB3cmFwcGVyIG9mIGBnZXRfb3JkZXJgLgAAAApmaW5kX29yZGVyAAAAAAABAAAAAAAAAAhvcmRlcl9pZAAAA+4AAAAgAAAAAQAAA+gAAAfQAAAABU9yZGVyAAAA",
        "AAAAAAAAAJJTZXQgb25jZSwgYXQgZGVwbG95LiBUaGUgdG9rZW4gY2Fubm90IGJlIGNoYW5nZWQgYWZ0ZXJ3YXJkcyDigJQgYW4gZXNjcm93CnRoYXQgY2FuIGJlIHBvaW50ZWQgYXQgYSBkaWZmZXJlbnQgYXNzZXQgd2hpbGUgaG9sZGluZyBmdW5kcyBpcyBub3Qgb25lLgAAAAAADV9fY29uc3RydWN0b3IAAAAAAAADAAAAAAAAAAhyZXNvbHZlcgAAABMAAAAAAAAACHRyZWFzdXJ5AAAAEwAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAA==" ]),
      options
    )
  }
  public readonly fromJSON = {
    open: this.txFromJSON<Order>,
        config: this.txFromJSON<Config>,
        refund: this.txFromJSON<Order>,
        settle: this.txFromJSON<Order>,
        get_order: this.txFromJSON<Order>,
        find_order: this.txFromJSON<Option<Order>>
  }
}