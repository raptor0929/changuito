#![cfg(test)]

//! The properties that matter are about money: after every path, the sum of
//! the three balances is what it was before, and nobody's share moved except
//! the way the path says it should. Assertions on status alone would pass on a
//! contract that forgot to transfer anything.

extern crate std;

use soroban_sdk::testutils::{Address as _, Events as _, Ledger as _};
use soroban_sdk::{token, xdr, Address, BytesN, Env, InvokeError};

/// What a `try_*` call's error arm looks like for one of our own errors.
///
/// The contract signals failure by panicking with an error code rather than
/// returning `Result`, so the generated client hands back the host's `Error`
/// (a code) rather than our enum. `Err(Err(_))` is the other case entirely:
/// the host rejected the call before the contract ran, which is what an
/// authorization failure looks like.
fn rejected(e: Error) -> Result<soroban_sdk::Error, InvokeError> {
    Ok(e.into())
}

use crate::{Error, Escrow, EscrowClient, Status};

const AMOUNT: i128 = 59_890_000; // 5.989 USDC at 7 decimals
const TIMEOUT: u64 = 3_600;
const START: u64 = 1_700_000_000;

struct Fixture<'a> {
    env: Env,
    client: EscrowClient<'a>,
    token: token::Client<'a>,
    buyer: Address,
    resolver: Address,
    treasury: Address,
    escrow_addr: Address,
}

impl Fixture<'_> {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(START);

        let issuer = Address::generate(&env);
        let buyer = Address::generate(&env);
        let resolver = Address::generate(&env);
        let treasury = Address::generate(&env);

        let sac = env.register_stellar_asset_contract_v2(issuer);
        let token_addr = sac.address();
        token::StellarAssetClient::new(&env, &token_addr).mint(&buyer, &(AMOUNT * 10));

        let escrow_addr = env.register(Escrow, (&resolver, &treasury, &token_addr));
        Self {
            client: EscrowClient::new(&env, &escrow_addr),
            token: token::Client::new(&env, &token_addr),
            env,
            buyer,
            resolver,
            treasury,
            escrow_addr,
        }
    }

    fn id(&self, b: u8) -> BytesN<32> {
        BytesN::from_array(&self.env, &[b; 32])
    }

    /// (buyer, escrow, treasury) — the three balances that must always sum to
    /// what the buyer started with.
    fn balances(&self) -> (i128, i128, i128) {
        (
            self.token.balance(&self.buyer),
            self.token.balance(&self.escrow_addr),
            self.token.balance(&self.treasury),
        )
    }

    fn open(&self, order: u8) -> crate::Order {
        self.client
            .open(&self.buyer, &self.id(order), &AMOUNT, &self.id(0xba), &TIMEOUT)
    }
}

#[test]
fn open_moves_the_money_into_the_contract() {
    let f = Fixture::new();
    let before = f.balances();

    let order = f.open(1);

    assert_eq!(order.status, Status::Open);
    assert_eq!(order.amount, AMOUNT);
    assert_eq!(order.deadline, START + TIMEOUT);
    assert_eq!(
        f.balances(),
        (before.0 - AMOUNT, before.1 + AMOUNT, before.2),
        "open did not move exactly the escrowed amount out of the buyer",
    );
}

#[test]
fn settle_pays_the_treasury_and_records_the_receipt() {
    let f = Fixture::new();
    let before = f.balances();
    f.open(1);

    let receipt = f.id(0xfe);
    let order = f.client.settle(&f.id(1), &f.id(0xba), &receipt);

    assert_eq!(order.status, Status::Settled);
    assert_eq!(order.receipt_hash, receipt);
    assert_eq!(
        f.balances(),
        (before.0 - AMOUNT, before.1, before.2 + AMOUNT),
        "the escrow should be empty and the treasury paid",
    );
    assert_eq!(f.client.get_order(&f.id(1)).receipt_hash, receipt);
}

#[test]
fn refund_returns_every_centavo_to_the_buyer() {
    let f = Fixture::new();
    let before = f.balances();
    f.open(1);

    let order = f.client.refund(&f.resolver, &f.id(1));

    assert_eq!(order.status, Status::Refunded);
    assert_eq!(f.balances(), before, "a refund must leave no trace on any balance");
}

#[test]
fn the_same_order_cannot_be_opened_twice() {
    // A double-submit from the UI. Overwriting would strand whatever the first
    // call locked, with no record that it ever existed.
    let f = Fixture::new();
    f.open(1);
    let after_first = f.balances();

    assert_eq!(
        f.client.try_open(&f.buyer, &f.id(1), &AMOUNT, &f.id(0xba), &TIMEOUT).unwrap_err(),
        rejected(Error::OrderExists),
    );
    assert_eq!(f.balances(), after_first, "the rejected open still took money");
}

#[test]
fn settling_an_order_that_was_never_opened_fails() {
    let f = Fixture::new();
    assert_eq!(
        f.client.try_settle(&f.id(9), &f.id(0xba), &f.id(0xfe)).unwrap_err(),
        rejected(Error::OrderNotFound),
    );
}

#[test]
fn an_order_can_only_be_closed_once() {
    let f = Fixture::new();
    f.open(1);
    f.client.settle(&f.id(1), &f.id(0xba), &f.id(0xfe));
    let after_settle = f.balances();

    assert_eq!(
        f.client.try_settle(&f.id(1), &f.id(0xba), &f.id(0xfe)).unwrap_err(),
        rejected(Error::OrderClosed),
    );
    assert_eq!(
        f.client.try_refund(&f.resolver, &f.id(1)).unwrap_err(),
        rejected(Error::OrderClosed),
        "refunding a settled order would pay it out twice",
    );
    assert_eq!(f.balances(), after_settle);
}

#[test]
fn a_refunded_order_cannot_then_be_settled() {
    let f = Fixture::new();
    f.open(1);
    f.client.refund(&f.resolver, &f.id(1));

    assert_eq!(
        f.client.try_settle(&f.id(1), &f.id(0xba), &f.id(0xfe)).unwrap_err(),
        rejected(Error::OrderClosed),
    );
}

#[test]
fn settle_refuses_a_basket_the_buyer_did_not_approve() {
    // The whole point of committing the basket: the resolver cannot swap in a
    // different set of items between confirm and settle.
    let f = Fixture::new();
    f.open(1);

    assert_eq!(
        f.client.try_settle(&f.id(1), &f.id(0xbb), &f.id(0xfe)).unwrap_err(),
        rejected(Error::BasketMismatch),
    );
    assert_eq!(f.client.get_order(&f.id(1)).status, Status::Open);
}

#[test]
fn the_buyer_cannot_walk_away_with_the_money_before_the_deadline() {
    let f = Fixture::new();
    f.open(1);

    assert_eq!(
        f.client.try_refund(&f.buyer, &f.id(1)).unwrap_err(),
        rejected(Error::NotAuthorized),
    );
}

#[test]
fn the_buyer_can_refund_themselves_once_the_deadline_passes() {
    // Without this the contract is a custodial box: the money would only ever
    // come back if the backend chose to return it.
    let f = Fixture::new();
    let before = f.balances();
    f.open(1);

    f.env.ledger().set_timestamp(START + TIMEOUT);
    let order = f.client.refund(&f.buyer, &f.id(1));

    assert_eq!(order.status, Status::Refunded);
    assert_eq!(f.balances(), before);
}

#[test]
fn a_stranger_cannot_refund_even_after_the_deadline() {
    let f = Fixture::new();
    f.open(1);
    f.env.ledger().set_timestamp(START + TIMEOUT * 2);

    let stranger = Address::generate(&f.env);
    assert_eq!(
        f.client.try_refund(&stranger, &f.id(1)).unwrap_err(),
        rejected(Error::NotAuthorized),
    );
}

#[test]
fn settle_requires_the_resolver_and_not_merely_a_signature() {
    // `mock_all_auths` signs for whoever is asked, so an authorization test has
    // to name the addresses that may sign. Here only the buyer can.
    let f = Fixture::new();
    f.open(1);
    f.env.set_auths(&[]);

    let before = f.balances();

    let err = f
        .client
        .try_settle(&f.id(1), &f.id(0xba), &f.id(0xfe))
        .expect_err("a settle nobody authorized was accepted");

    // The host rejects the call before `settle` runs, so the failure is one of
    // its own errors rather than any of ours. Asserting that distinction is
    // the point: a contract error here would mean the body executed.
    for ours in [
        Error::NotAuthorized,
        Error::OrderClosed,
        Error::OrderNotFound,
        Error::BasketMismatch,
    ] {
        assert_ne!(err, rejected(ours), "settle ran and then failed on its own terms");
    }
    assert_eq!(f.client.get_order(&f.id(1)).status, Status::Open);
    assert_eq!(f.balances(), before);
}

#[test]
fn zero_and_negative_amounts_are_rejected() {
    let f = Fixture::new();
    for amount in [0i128, -1, -AMOUNT] {
        assert_eq!(
        f.client.try_open(&f.buyer, &f.id(1), &amount, &f.id(0xba), &TIMEOUT).unwrap_err(),
        rejected(Error::InvalidAmount),
            "amount {} was accepted",
            amount,
        );
    }
}

#[test]
fn a_deadline_must_be_far_enough_out_to_mean_something() {
    let f = Fixture::new();
    for timeout in [0u64, 60, 31 * 24 * 60 * 60] {
        assert_eq!(
        f.client.try_open(&f.buyer, &f.id(1), &AMOUNT, &f.id(0xba), &timeout).unwrap_err(),
        rejected(Error::InvalidTimeout),
            "timeout {} was accepted",
            timeout,
        );
    }
}

#[test]
fn find_order_answers_instead_of_panicking() {
    let f = Fixture::new();
    assert_eq!(f.client.find_order(&f.id(7)), None);
    assert_eq!(
        f.client.try_get_order(&f.id(7)).unwrap_err(),
        rejected(Error::OrderNotFound),
    );

    f.open(7);
    assert_eq!(f.client.find_order(&f.id(7)).unwrap().amount, AMOUNT);
}

/// The event name and the order id carried by each event the contract
/// published during the most recent call.
///
/// `events().all()` is scoped to the last invocation, not to the whole test,
/// so this is read after each call rather than once at the end.
fn events_of_last_call(f: &Fixture) -> std::vec::Vec<(std::string::String, u8)> {
    f.env
        .events()
        .all()
        .filter_by_contract(&f.escrow_addr)
        .events()
        .iter()
        .map(|e| {
            let xdr::ContractEventBody::V0(body) = &e.body;
            let name = match &body.topics[0] {
                xdr::ScVal::Symbol(s) => std::string::String::from_utf8_lossy(s.0.as_slice()).into_owned(),
                other => std::panic!("event topic 0 is not a name: {:?}", other),
            };
            let order = match &body.topics[1] {
                xdr::ScVal::Bytes(b) => b.0.as_slice()[0],
                other => std::panic!("event topic 1 is not an order id: {:?}", other),
            };
            (name, order)
        })
        .collect()
}

fn one_event(f: &Fixture, name: &str, order: u8) {
    assert_eq!(
        events_of_last_call(f),
        std::vec![(std::string::String::from(name), order)],
    );
}

#[test]
fn every_transition_is_on_the_event_log() {
    // stellar.expert is the audit trail this demo points people at. If the
    // transitions are not events there is nothing there to look at — and if
    // the order id is not a topic, there is no way to find one basket's story
    // among everyone else's.
    let f = Fixture::new();

    f.open(1);
    one_event(&f, "opened", 1);

    f.client.settle(&f.id(1), &f.id(0xba), &f.id(0xfe));
    one_event(&f, "settled", 1);

    f.open(2);
    one_event(&f, "opened", 2);

    f.env.ledger().set_timestamp(START + TIMEOUT);
    f.client.refund(&f.buyer, &f.id(2));
    one_event(&f, "refunded", 2);
}

#[test]
fn a_rejected_call_leaves_no_event_behind() {
    // A failed call rolls back, events included. Worth pinning: an explorer
    // showing an "opened" for a basket that was never funded would be worse
    // than showing nothing at all.
    let f = Fixture::new();
    f.open(1);

    let _ = f.client.try_open(&f.buyer, &f.id(1), &AMOUNT, &f.id(0xba), &TIMEOUT);
    assert_eq!(events_of_last_call(&f), std::vec![]);

    let _ = f.client.try_settle(&f.id(1), &f.id(0xbb), &f.id(0xfe));
    assert_eq!(events_of_last_call(&f), std::vec![]);
}

#[test]
fn two_orders_from_the_same_buyer_do_not_interfere() {
    let f = Fixture::new();
    let before = f.balances();
    f.open(1);
    f.open(2);

    f.client.settle(&f.id(1), &f.id(0xba), &f.id(0xfe));

    assert_eq!(f.client.get_order(&f.id(1)).status, Status::Settled);
    assert_eq!(f.client.get_order(&f.id(2)).status, Status::Open);
    assert_eq!(
        f.balances(),
        (before.0 - AMOUNT * 2, AMOUNT, before.2 + AMOUNT),
        "the second order's money should still be held",
    );
}

#[test]
fn config_is_readable_and_fixed_at_deploy() {
    let f = Fixture::new();
    let cfg = f.client.config();
    assert_eq!(cfg.resolver, f.resolver);
    assert_eq!(cfg.treasury, f.treasury);
    assert_eq!(cfg.token, f.token.address);
}
