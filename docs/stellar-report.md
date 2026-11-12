# Stellar report

A short account of the testnet checkout for someone who does not need to read the code. Links open on Stellar Expert, the public record of the network.

## What the shopper uses

The shopper signs in with Freighter through the Pollar wallet. Changuito pays the network fee through OpenZeppelin Channels, so the shopper does not spend XLM to pay. A new account's reserve is meant to be paid by Changuito, not by the shopper. That reserve path is in the code and has not been used for a real account yet.

The escrow that holds the payment is
[CA4BDF4U65OHCO6AB4KRJWBRZ4BJBZURDFNFKJDEZAKQRCUNJZFLN72S](https://stellar.expert/explorer/testnet/contract/CA4BDF4U65OHCO6AB4KRJWBRZ4BJBZURDFNFKJDEZAKQRCUNJZFLN72S).

The token it holds is the test USDC
[CAOPLEE4NVOVEBYRO7NHG5K4FEML5O5C5AATYBK4FCDLYRAJFZWBNN3E](https://stellar.expert/explorer/testnet/contract/CAOPLEE4NVOVEBYRO7NHG5K4FEML5O5C5AATYBK4FCDLYRAJFZWBNN3E).
It is not Circle's USDC.

## What is already on the network

One payment was opened through Channels on 10 November 2026:

[89c9e801eed9f430d04a789ae26870d1c780a1ca7b2ddd881c3510319314821d](https://stellar.expert/explorer/testnet/tx/89c9e801eed9f430d04a789ae26870d1c780a1ca7b2ddd881c3510319314821d)

11.44 test USDC moved from the shopper to the escrow. The fee was paid by the Channels account `GCNJB6V5YIODDSSCWXZ2VOKMRPRVZ2V723RRQS6STXE6NWTGVOJY35CN`. The shopper `GCX2V5B45V34KPXT3ZLRRKU2WVGN6UIJPX6ZAUITINFFGM5Y7S2VXRUV` still has 10000 XLM. That order is past its deadline and must not be opened again.

## Still to record

These are the pieces the report cannot claim yet. Three videos were requested on 12 November 2026, one for each of the first three.

| Piece | What has to be on the video or the link |
|---|---|
| Release | A new Día cart, the store confirms, and the test USDC moves from the escrow to the treasury |
| Refund | A failed or expired order, and the test USDC returns to the shopper |
| Wrong cart | A release for a different cart is rejected before it is sent. The video shows the error |
| Sponsored accounts | Three new accounts, each sponsored by Changuito, each with a USDC trustline, 0 XLM of its own, and one escrow payment |

After each of the first three, the shopper's XLM balance stays 10000.

## Code

The checkout changes are in [tote-hq/stellar](https://github.com/tote-hq/stellar):

- [#116](https://github.com/tote-hq/stellar/pull/116) pays the open fee through Channels
- [#119](https://github.com/tote-hq/stellar/pull/119) lets Freighter sign the authorization
- [#121](https://github.com/tote-hq/stellar/pull/121) recovers an open the server could not read
- [#123](https://github.com/tote-hq/stellar/pull/123) sends release and refund through Channels
- [#125](https://github.com/tote-hq/stellar/pull/125) can sponsor a new account and its USDC trustline
- [#126](https://github.com/tote-hq/stellar/pull/126) releases a confirmed order and refunds a failed or expired one
